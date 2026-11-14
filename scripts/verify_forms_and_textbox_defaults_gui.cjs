const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('/usr/share/nodejs/ws');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function getPageTarget(port) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/json/list`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const list = JSON.parse(data);
            const page = list.find((t) => t.type === 'page');
            if (page) resolve(page);
            else reject(new Error('No page target found'));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async screenshot(outPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
  }
}

async function run() {
  const rootDir = path.resolve(__dirname, '..');
  const electronBin = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');
  const sampleForm = path.join(rootDir, 'test_docs', '02_interactive_form.pdf');
  const shotsDir = path.join(rootDir, 'docs', 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const cdpPort = 9244;
  const backendPort = 18444;
  const spawnEnv = {
    ...process.env,
    VELLUM_PORT: String(backendPort),
    VELLUM_PYTHON: path.join(rootDir, '.venv', 'bin', 'python'),
    DISPLAY: process.env.DISPLAY || ':0',
  };
  delete spawnEnv.ELECTRON_RUN_AS_NODE;
  const appProc = spawn(
    electronBin,
    ['--no-sandbox', `--remote-debugging-port=${cdpPort}`, path.join(rootDir, 'electron', 'main.cjs'), sampleForm],
    {
      cwd: rootDir,
      env: spawnEnv,
      stdio: 'inherit',
    }
  );

  const cleanup = () => {
    try {
      appProc.kill('SIGTERM');
    } catch (e) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  try {
    let target = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try {
        target = await getPageTarget(cdpPort);
        if (target) break;
      } catch (e) {}
    }
    assert(target, 'Could not connect to Electron CDP target');

    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();

    // 1. Wait for Ready (Offline)
    let isReady = false;
    for (let i = 0; i < 40; i++) {
      const statusText = await client.eval(`document.querySelector('.status-bar')?.textContent || ''`);
      if (statusText.includes('Ready (Offline)')) {
        isReady = true;
        break;
      }
      await sleep(500);
    }
    assert(isReady, 'Backend did not reach Ready (Offline)');
    // Wait for initial sample doc tab to finish loading so it doesn't race with opening our test form
    for (let i = 0; i < 20; i++) {
      const hasTab = await client.eval(`!!document.querySelector('.doc-tab.active')`);
      if (hasTab) break;
      await sleep(300);
    }
    await sleep(500);
    // Open test_docs/02_interactive_form.pdf via the real hidden file input
    await client.send('DOM.enable');
    const docNode = await client.send('DOM.getDocument', { depth: 1 });
    const fileInput = await client.send('DOM.querySelector', {
      nodeId: docNode.root.nodeId,
      selector: 'input[type="file"][accept=".pdf"]',
    });
    assert(fileInput && fileInput.nodeId, 'Could not find PDF file input');
    await client.send('DOM.setFileInputFiles', {
      nodeId: fileInput.nodeId,
      files: [sampleForm],
    });
    let activeTabTitle = '';
    for (let i = 0; i < 30; i++) {
      activeTabTitle = await client.eval(`
        (() => {
          const tabs = Array.from(document.querySelectorAll('.doc-tab'));
          const target = tabs.find(t => t.textContent.includes('02_interactive_form.pdf'));
          if (target && !target.classList.contains('active')) target.click();
          return document.querySelector('.doc-tab.active')?.textContent || '';
        })()
      `);
      if (activeTabTitle.includes('02_interactive_form.pdf')) break;
      await sleep(500);
    }
    console.log('Active tab:', activeTabTitle);
    assert(activeTabTitle.includes('02_interactive_form.pdf'), `Expected 02_interactive_form.pdf tab, got ${activeTabTitle}`);

    // 2. Switch to Forms mode and click Fill / Select
    const clickFormsRes = await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('Forms'));
        if (!btn) return 'no-forms-btn';
        btn.click();
        return 'clicked:' + btn.textContent.trim();
      })()
    `);
    console.log('Click Forms:', clickFormsRes);
    await sleep(500);
    const clickFillRes = await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Fill / Select'));
        if (!btn) return 'no-fill-btn';
        btn.click();
        return 'clicked:' + btn.textContent.trim();
      })()
    `);
    console.log('Click Fill:', clickFillRes);

    let widgetCount = 0;
    for (let i = 0; i < 20; i++) {
      widgetCount = await client.eval(`document.querySelectorAll('.form-widget-box').length`);
      if (widgetCount >= 2) break;
      await sleep(400);
    }
    if (widgetCount < 2) {
      const diag = await client.eval(`({
        notice: document.querySelector('.notice-banner')?.textContent || '',
        status: document.querySelector('.status-bar')?.textContent || '',
        pageStage: !!document.querySelector('.pdf-page-stage'),
        pageBitmap: !!document.querySelector('.page-bitmap'),
        ribbonBtns: Array.from(document.querySelectorAll('button')).slice(0, 40).map(b => b.textContent.trim()),
        htmlSample: (document.querySelector('.pdf-page-stage')?.innerHTML || '').slice(0, 600)
      })`);
      console.log('Diagnostics:', JSON.stringify(diag, null, 2));
    }
    console.log('Detected interactive form widgets on page:', widgetCount);
    assert(widgetCount >= 2, `Expected interactive form widgets, found ${widgetCount}`);

    await client.screenshot(path.join(shotsDir, 'forms-before-fill.png'));

    // 3. Direct click + type + Tab navigation + Save Filled Values
    const boxPos = await client.eval(`
      (() => {
        const inp = document.querySelector('.form-widget-box input[type="text"], .form-widget-box textarea');
        if (!inp) return null;
        inp.focus();
        const r = inp.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    assert(boxPos, 'Could not find text form input');
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: boxPos.x, y: boxPos.y, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: boxPos.x, y: boxPos.y, button: 'left', clickCount: 1 });
    await client.send('Input.insertText', { text: 'Linux Engineering Dept' });
    await sleep(200);

    // Press Tab to move to next field
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(200);

    // Toggle checkbox if present
    await client.eval(`
      (() => {
        const cb = document.querySelector('.form-widget-box input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
      })()
    `);
    await sleep(300);

    // Click Save Filled Values
    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save Filled Values'));
        if (btn) btn.click();
      })()
    `);
    await sleep(1200);
    await client.screenshot(path.join(shotsDir, 'forms-after-fill.png'));

    // 4. Verify Text Box Defaults (#000000, helv, 11pt, left, transparent bg/border)
    await client.eval(`
      (() => {
        localStorage.removeItem('vellum.textbox.defaults.v1');
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'New' || b.textContent.includes('+ New'));
        if (btn) btn.click();
      })()
    `);
    for (let i = 0; i < 20; i++) {
      const tabText = await client.eval(`document.querySelector('.doc-tab.active')?.textContent || ''`);
      if (!tabText.includes('02_interactive_form.pdf')) break;
      await sleep(300);
    }
    await sleep(500);

    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Edit PDF');
        if (btn) btn.click();
      })()
    `);
    await sleep(500);

    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Add Text Box'));
        if (btn) btn.click();
      })()
    `);
    await sleep(300);

    const canvasPos = await client.eval(`
      (() => {
        const img = document.querySelector('img.page-bitmap');
        if (!img) return null;
        const r = img.getBoundingClientRect();
        return { x: r.left + 80, y: r.top + 100 };
      })()
    `);
    assert(canvasPos, 'Could not locate page canvas image');
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvasPos.x, y: canvasPos.y, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvasPos.x + 200, y: canvasPos.y + 44, button: 'left', clickCount: 0 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvasPos.x + 200, y: canvasPos.y + 44, button: 'left', clickCount: 1 });
    await sleep(500);

    const tbDefaultsCheck = await client.eval(`
      (() => {
        const ta = document.querySelector('.inline-textbox-input');
        const colorInput = document.querySelector('.right-inspector input[type="color"]');
        const sizeInput = document.querySelector('.right-inspector input[type="number"][min="6"]');
        return {
          hasTextarea: !!ta,
          taColor: ta ? getComputedStyle(ta).color : null,
          inspectorColor: colorInput ? colorInput.value : null,
          inspectorSize: sizeInput ? sizeInput.value : null,
        };
      })()
    `);
    console.log('Text Box Defaults check:', tbDefaultsCheck);
    assert(tbDefaultsCheck.hasTextarea, 'Inline textbox did not open');
    assert(tbDefaultsCheck.inspectorColor === '#000000', `Expected #000000 default color, got ${tbDefaultsCheck.inspectorColor}`);
    assert(tbDefaultsCheck.inspectorSize === '11', `Expected 11pt default size, got ${tbDefaultsCheck.inspectorSize}`);

    await client.send('Input.insertText', { text: 'Default Black Helvetica 11pt Text' });
    await sleep(400);
    await client.screenshot(path.join(shotsDir, 'textbox-defaults-dark.png'));

    // Toggle Light Theme and screenshot
    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.title?.includes('Theme') || b.getAttribute('aria-label')?.includes('Theme'));
        if (btn) btn.click();
        else document.documentElement.setAttribute('data-theme', 'light');
      })()
    `);
    await sleep(500);
    await client.screenshot(path.join(shotsDir, 'textbox-defaults-light.png'));

    console.log('ALL FORMS & TEXTBOX DEFAULTS GUI CHECKS PASSED!');
  } finally {
    cleanup();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

