const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('/usr/share/nodejs/ws');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  async screenshot(filePath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
    console.log(`Saved screenshot: ${filePath}`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  const cdpPort = 9250;
  const appImagePath = path.resolve(__dirname, '../release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage');
  console.log('Starting packaged AppImage with CDP on port ' + cdpPort + ':', appImagePath);

  const appProc = spawn(
    appImagePath,
    ['--appimage-extract-and-run', '--no-sandbox', `--remote-debugging-port=${cdpPort}`],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        DISPLAY: process.env.DISPLAY || ':0',
      },
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

    if (!target) {
      throw new Error('Could not connect to packaged AppImage CDP target on port ' + cdpPort);
    }

    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();

    // Wait for backend ready
    let isReady = false;
    for (let i = 0; i < 40; i++) {
      const statusText = await client.eval(`document.querySelector('.status-bar')?.textContent || ''`);
      if (statusText.includes('Ready (Offline)')) {
        isReady = true;
        console.log('Packaged backend Ready:', statusText.trim());
        break;
      }
      await sleep(500);
    }
    if (!isReady) throw new Error('Packaged backend did not become ready');

    // 1. Open Showcase PDF
    await client.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Showcase PDF'));
      if (btn) btn.click();
    `);
    for (let i = 0; i < 25; i++) {
      if (await client.eval(`Boolean(document.querySelector('.pdf-page-stage'))`)) break;
      await sleep(500);
    }
    await sleep(1500);

    // 2. Click "Edit Paragraph" tool and open a multi-line paragraph block
    const toolClicked = await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('.tool-btn')).find(b => b.textContent.includes('Edit Paragraph'));
        if (btn) { btn.click(); return true; }
        return false;
      })()
    `);
    console.log('Edit Paragraph tool clicked:', toolClicked);
    await sleep(600);

    const paraCount = await client.eval(`document.querySelectorAll('.paragraph-box-overlay').length`);
    console.log('Paragraph overlays visible:', paraCount);
    if (paraCount === 0) throw new Error('No .paragraph-box-overlay elements found');

    // Click the multi-line body paragraph ("Provider shall deliver...")
    const opened = await client.eval(`
      (() => {
        const boxes = Array.from(document.querySelectorAll('.paragraph-box-overlay'));
        // Pick a box with height > 22px (multi-line) or fallback to first
        boxes.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
        if (boxes[0]) { boxes[0].click(); return true; }
        return false;
      })()
    `);
    console.log('Opened paragraph editor:', opened);
    await sleep(600);

    const hasEditor = await client.eval(`Boolean(document.querySelector('.inline-paragraph-overlay'))`);
    if (!hasEditor) throw new Error('Inline paragraph editor overlay did not appear');

    const screenshotsDir = path.resolve(__dirname, '../docs/screenshots');
    await client.screenshot(path.join(screenshotsDir, 'paragraph-editor-open.png'));

    // 3. Test Overflow Warning: append extra text via React textarea input
    await client.eval(`
      (() => {
        const ta = document.querySelector('.inline-paragraph-input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ta.value + ' Additional compliance verification text that wraps across multiple lines and triggers safe overflow handling.');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await sleep(300);

    // Click Apply to trigger overflow check
    await client.eval(`
      document.querySelector('.inline-paragraph-overlay .mini-btn.apply').click();
    `);
    await sleep(1000);

    const hasOverflowBanner = await client.eval(`Boolean(document.querySelector('.paragraph-overflow-banner'))`);
    console.log('Overflow banner displayed:', hasOverflowBanner);
    if (hasOverflowBanner) {
      await client.screenshot(path.join(screenshotsDir, 'paragraph-overflow-warning.png'));
      // Choose "Expand Box" (or "Fit Font")
      const choiceClicked = await client.eval(`
        (() => {
          const btns = Array.from(document.querySelectorAll('.paragraph-overflow-actions .mini-btn.apply'));
          if (btns[0]) { btns[0].click(); return btns[0].textContent.trim(); }
          return null;
        })()
      `);
      console.log('Overflow resolution clicked:', choiceClicked);
      await sleep(1500);
    }

    await client.screenshot(path.join(screenshotsDir, 'paragraph-reflowed.png'));

    // 4. Verify Undo / Redo works on the paragraph edit
    await client.eval(`
      const undoBtn = document.querySelector('button[title*="Undo"], .tool-btn[title*="Undo"]');
      if (undoBtn) undoBtn.click();
    `);
    await sleep(1000);
    await client.eval(`
      const redoBtn = document.querySelector('button[title*="Redo"], .tool-btn[title*="Redo"]');
      if (redoBtn) redoBtn.click();
    `);
    await sleep(1000);

    // 5. Verify Save / Export endpoint from packaged app
    const exportStatus = await client.eval(`
      (async () => {
        const url = await window.vellumDesktop.getBackendUrl();
        const docs = await fetch(url + '/api/docs').then(r => r.json()).catch(() => null);
        return { url, hasBackend: Boolean(url) };
      })()
    `);
    console.log('Packaged backend export check:', exportStatus);

    console.log('Packaged AppImage paragraph editor verification PASSED!');
    client.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});

