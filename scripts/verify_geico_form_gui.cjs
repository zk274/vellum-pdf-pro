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
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async screenshot(outPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  const rootDir = path.resolve(__dirname, '..');
  const electronBin = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');
  const shotsDir = path.join(rootDir, 'docs', 'screenshots');
  const outDir = path.join(rootDir, 'tests', 'output');
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const geicoPdf = path.join(rootDir, 'tests', 'fixtures', 'PROVIDER APP REQ FORM (2).pdf');
  assert(fs.existsSync(geicoPdf), `Missing GEICO fixture: ${geicoPdf}`);

  const cdpPort = 9246;
  const backendPort = 18446;
  const spawnEnv = {
    ...process.env,
    VELLUM_PORT: String(backendPort),
    VELLUM_PYTHON: path.join(rootDir, '.venv', 'bin', 'python'),
    DISPLAY: process.env.DISPLAY || ':0',
  };
  delete spawnEnv.ELECTRON_RUN_AS_NODE;

  const appProc = spawn(
    electronBin,
    ['--no-sandbox', `--remote-debugging-port=${cdpPort}`, path.join(rootDir, 'electron', 'main.cjs')],
    { cwd: rootDir, env: spawnEnv, stdio: 'inherit' }
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

    // 1. Wait for Ready (Offline) + startup tab
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
    for (let i = 0; i < 20; i++) {
      if (await client.eval(`!!document.querySelector('.doc-tab.active')`)) break;
      await sleep(300);
    }
    await sleep(500);

    // 2. Open GEICO PDF via file input
    await client.send('DOM.enable');
    const docNode = await client.send('DOM.getDocument', { depth: 1 });
    const fileInput = await client.send('DOM.querySelector', {
      nodeId: docNode.root.nodeId,
      selector: 'input[type="file"][accept=".pdf"]',
    });
    assert(fileInput && fileInput.nodeId, 'Could not find PDF file input');
    await client.send('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [geicoPdf] });

    let activeTab = '';
    for (let i = 0; i < 30; i++) {
      activeTab = await client.eval(`
        (() => {
          const tabs = Array.from(document.querySelectorAll('.doc-tab'));
          const t = tabs.find(el => el.textContent.includes('PROVIDER APP REQ FORM'));
          if (t && !t.classList.contains('active')) t.click();
          return document.querySelector('.doc-tab.active')?.textContent || '';
        })()
      `);
      if (activeTab.includes('PROVIDER APP REQ FORM')) break;
      await sleep(400);
    }
    assert(activeTab.includes('PROVIDER APP REQ FORM'), `Expected GEICO tab, got ${activeTab}`);
    await sleep(800);
    await client.screenshot(path.join(shotsDir, 'geico-original.png'));

    // 3. Switch to Forms -> Detect Fields
    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Forms');
        if (btn) btn.click();
      })()
    `);
    await sleep(400);
    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Detect Fields'));
        if (btn) btn.click();
      })()
    `);

    let candCount = 0;
    for (let i = 0; i < 20; i++) {
      candCount = await client.eval(`document.querySelectorAll('.form-candidate-box').length`);
      if (candCount >= 30) break;
      await sleep(300);
    }
    console.log('Detected GEICO form candidate overlays:', candCount);
    assert(candCount === 34, `Expected 34 GEICO candidate overlays, found ${candCount}`);
    await client.screenshot(path.join(shotsDir, 'geico-detected-candidates.png'));

    // 4. Click Accept All -> convert all 34 candidates into interactive AcroForm widgets
    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Accept All');
        if (btn) btn.click();
      })()
    `);

    let widgetCount = 0;
    for (let i = 0; i < 40; i++) {
      widgetCount = await client.eval(`document.querySelectorAll('.form-widget-box').length`);
      if (widgetCount === 34) break;
      await sleep(400);
    }
    console.log('Converted interactive GEICO AcroForm widgets:', widgetCount);
    assert(widgetCount === 34, `Expected 34 interactive widgets, found ${widgetCount}`);
    await client.screenshot(path.join(shotsDir, 'geico-accepted-fields.png'));

    // 5. Fill interactive fields directly via DOM/keyboard + Save Filled Values
    const fillMap = [
      'Example Coastal Roadside LLC',
      '123 Example Street, Unit 4B, Coastal City, VA 23451',
      '123 Example Street, Unit 4B, Coastal City, VA 23451',
      '555-0100',
      'example@example.com',
      'Test User',
      'Example County and surrounding service areas (within 50 miles)',
      '1',
      'Example Dispatch System',
      '456 Harbor Blvd, North Bay, VA 23452\n789 Industrial Pkwy, South Port, VA 23453',
    ];
    for (let i = 0; i < fillMap.length; i++) {
      const pos = await client.eval(`
        (() => {
          const boxes = Array.from(document.querySelectorAll('.form-widget-box input[type="text"], .form-widget-box textarea'));
          const el = boxes[${i}];
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.left + 20, y: r.top + r.height / 2 };
        })()
      `);
      assert(pos, `Missing text input index ${i}`);
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await client.send('Input.insertText', { text: fillMap[i] });
      await sleep(80);
    }

    // Check several vehicle service checkboxes
    await client.eval(`
      (() => {
        const cbs = Array.from(document.querySelectorAll('.form-widget-box input[type="checkbox"]'));
        [0, 1, 2, 5, 9, 20, 23].forEach(idx => {
          if (cbs[idx] && !cbs[idx].checked) cbs[idx].click();
        });
      })()
    `);
    await sleep(300);

    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save Filled Values'));
        if (btn) btn.click();
      })()
    `);
    await sleep(1200);
    await client.screenshot(path.join(shotsDir, 'geico-filled.png'));

    // 6. Download filled PDF via backend API, reopen in a fresh tab, and verify persistence
    const guiSavedPath = path.join(outDir, 'GEICO_Application_GUI_Verified.pdf');
    const savedBase64 = await client.eval(`
      (async () => {
        const res = await fetch('http://127.0.0.1:${backendPort}/api/docs');
        const list = await res.json();
        const geico = list.find(d => d.filename.includes('PROVIDER APP REQ FORM'));
        const dl = await fetch('http://127.0.0.1:${backendPort}/api/docs/' + geico.doc_id + '/download');
        const buf = await dl.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      })()
    `);
    fs.writeFileSync(guiSavedPath, Buffer.from(savedBase64, 'base64'));

    const docNode2 = await client.send('DOM.getDocument', { depth: 1 });
    const fileInput2 = await client.send('DOM.querySelector', {
      nodeId: docNode2.root.nodeId,
      selector: 'input[type="file"][accept=".pdf"]',
    });
    await client.send('DOM.setFileInputFiles', { nodeId: fileInput2.nodeId, files: [guiSavedPath] });

    let reopenedTab = '';
    for (let i = 0; i < 30; i++) {
      reopenedTab = await client.eval(`
        (() => {
          const tabs = Array.from(document.querySelectorAll('.doc-tab'));
          const t = tabs.find(el => el.textContent.includes('GEICO_Application_GUI_Verified.pdf'));
          if (t && !t.classList.contains('active')) t.click();
          return document.querySelector('.doc-tab.active')?.textContent || '';
        })()
      `);
      if (reopenedTab.includes('GEICO_Application_GUI_Verified.pdf')) break;
      await sleep(400);
    }
    assert(reopenedTab.includes('GEICO_Application_GUI_Verified.pdf'), 'Reopened GEICO tab did not activate');
    await sleep(900);

    const reopenedCheck = await client.eval(`
      (() => {
        const inputs = Array.from(document.querySelectorAll('.form-widget-box input[type="text"], .form-widget-box textarea'));
        const cbs = Array.from(document.querySelectorAll('.form-widget-box input[type="checkbox"]'));
        return {
          widgetCount: document.querySelectorAll('.form-widget-box').length,
          businessName: inputs[0]?.value || '',
          telephone: inputs[3]?.value || '',
          email: inputs[4]?.value || '',
          checkedCount: cbs.filter(c => c.checked).length,
        };
      })()
    `);
    console.log('Reopened GEICO GUI check:', reopenedCheck);
    assert(reopenedCheck.widgetCount === 34, 'Reopened widget count mismatch');
    assert(reopenedCheck.businessName === 'Example Coastal Roadside LLC', 'Business name did not persist');
    assert(reopenedCheck.telephone === '555-0100', 'Telephone did not persist');
    assert(reopenedCheck.email === 'example@example.com', 'Email did not persist');
    assert(reopenedCheck.checkedCount === 7, `Expected 7 checked boxes, got ${reopenedCheck.checkedCount}`);

    await client.screenshot(path.join(shotsDir, 'geico-reopened.png'));
    console.log('ALL GEICO REAL-WORLD GUI VERIFICATION CHECKS PASSED!');
    client.close();
  } finally {
    cleanup();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

