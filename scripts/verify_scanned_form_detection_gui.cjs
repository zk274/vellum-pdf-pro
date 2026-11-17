const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('/usr/share/nodejs/ws');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
  const appImagePath = path.join(rootDir, 'release', 'Vellum_PDF_Pro-1.0.0-x86_64.AppImage');
  const electronBin = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');
  const usePackaged = process.env.VELLUM_TEST_PACKAGED !== '0' && fs.existsSync(appImagePath);
  const shotsDir = path.join(rootDir, 'docs', 'screenshots');
  const outDir = path.join(rootDir, 'tests', 'output');
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const nsdPdf = path.join(rootDir, 'tests', 'fixtures', 'NNSDFILLABLEAPP (1).pdf');
  const origNsdHash = sha256(nsdPdf);
  const nsdOutPdf = path.join(outDir, 'NNSDFILLABLEAPP_1_fillable.pdf');
  if (fs.existsSync(nsdOutPdf)) fs.unlinkSync(nsdOutPdf);

  const dialogQueueFile = path.join(outDir, 'test_nsd_dialog_queue.json');
  fs.writeFileSync(dialogQueueFile, JSON.stringify({ calls: [], queue: [nsdOutPdf] }));

  const cdpPort = 9250;
  const backendPort = 18450;
  const spawnEnv = {
    ...process.env,
    VELLUM_PORT: String(backendPort),
    VELLUM_PYTHON: path.join(rootDir, '.venv', 'bin', 'python'),
    VELLUM_TEST_SAVE_DIALOG_FILE: dialogQueueFile,
    DISPLAY: process.env.DISPLAY || ':0',
  };
  delete spawnEnv.ELECTRON_RUN_AS_NODE;

  const launchCmd = usePackaged ? appImagePath : electronBin;
  const launchArgs = usePackaged
    ? ['--appimage-extract-and-run', '--no-sandbox', `--remote-debugging-port=${cdpPort}`]
    : ['--no-sandbox', `--remote-debugging-port=${cdpPort}`, path.join(rootDir, 'electron', 'main.cjs')];
  console.log('Launching GUI target:', launchCmd, usePackaged ? '(PACKAGED AppImage)' : '(Electron)');

  const appProc = spawn(launchCmd, launchArgs, { cwd: rootDir, env: spawnEnv, stdio: 'inherit' });
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
    await sleep(400);

    // 1. Open NSD 16-page PDF
    await client.send('DOM.enable');
    const docNode = await client.send('DOM.getDocument', { depth: 1 });
    const fileInput = await client.send('DOM.querySelector', {
      nodeId: docNode.root.nodeId,
      selector: 'input[type="file"][accept=".pdf"]',
    });
    await client.send('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [nsdPdf] });

    let activeTab = '';
    for (let i = 0; i < 30; i++) {
      activeTab = await client.eval(`
        (() => {
          const tabs = Array.from(document.querySelectorAll('.doc-tab'));
          const t = tabs.find(el => el.textContent.includes('NNSDFILLABLEAPP'));
          if (t && !t.classList.contains('active')) t.click();
          return document.querySelector('.doc-tab.active')?.textContent || '';
        })()
      `);
      if (activeTab.includes('NNSDFILLABLEAPP')) break;
      await sleep(400);
    }
    assert(activeTab.includes('NNSDFILLABLEAPP'), 'NSD tab did not activate');
    await sleep(600);
    await client.screenshot(path.join(shotsDir, 'nsd-original.png'));

    // 2. Forms -> Prepare Form -> Detect Current Page
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Forms')?.click()`);
    await sleep(300);
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Prepare Form')?.click()`);
    await sleep(300);
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Detect Current Page'))?.click()`);

    let candCount = 0;
    for (let i = 0; i < 40; i++) {
      candCount = await client.eval(`document.querySelectorAll('.form-candidate-box').length`);
      if (candCount >= 25) break;
      await sleep(400);
    }
    console.log('Detected NSD Page 1 scanned candidate overlays:', candCount);
    assert(candCount >= 25, `Expected >=25 NSD Page 1 candidate overlays, found ${candCount}`);
    await client.screenshot(path.join(shotsDir, 'nsd-detected-candidates.png'));

    // 3. Accept All -> convert into real AcroForm widgets
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Accept All'))?.click()`);
    let widgetCount = 0;
    for (let i = 0; i < 50; i++) {
      widgetCount = await client.eval(`document.querySelectorAll('.form-widget-box').length`);
      if (widgetCount >= 25) break;
      await sleep(400);
    }
    console.log('Accepted NSD Page 1 interactive widgets:', widgetCount);
    assert(widgetCount >= 25, `Expected >=25 NSD Page 1 widgets, found ${widgetCount}`);
    await client.screenshot(path.join(shotsDir, 'nsd-accepted-fields.png'));

    // 4. Fill first 3 text fields directly in Fill Form mode and Save PDF WITHOUT Save Filled Values
    const samples = ['Example Roadside Recovery LLC', 'Example Towing', '123 Example Boulevard'];
    for (let i = 0; i < samples.length; i++) {
      const pos = await client.eval(`
        (() => {
          const boxes = Array.from(document.querySelectorAll('.form-widget-box input[type="text"]'));
          const el = boxes[${i}];
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.left + 20, y: r.top + r.height / 2 };
        })()
      `);
      assert(pos, `Missing NSD input ${i}`);
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await client.send('Input.insertText', { text: samples[i] });
      await sleep(80);
    }
    await sleep(300);
    await client.screenshot(path.join(shotsDir, 'nsd-filled.png'));

    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Save PDF')?.click()`);
    await sleep(1500);
    assert(fs.existsSync(nsdOutPdf), 'NSD Save PDF did not create output file');

    // 5. Reopen saved PDF in fresh tab and verify persistence
    const docNode2 = await client.send('DOM.getDocument', { depth: 1 });
    const fileInput2 = await client.send('DOM.querySelector', {
      nodeId: docNode2.root.nodeId,
      selector: 'input[type="file"][accept=".pdf"]',
    });
    await client.send('DOM.setFileInputFiles', { nodeId: fileInput2.nodeId, files: [nsdOutPdf] });
    for (let i = 0; i < 30; i++) {
      const tab = await client.eval(`
        (() => {
          const tabs = Array.from(document.querySelectorAll('.doc-tab'));
          const t = tabs.find(el => el.textContent.includes('NNSDFILLABLEAPP_1_fillable.pdf'));
          if (t && !t.classList.contains('active')) t.click();
          return document.querySelector('.doc-tab.active')?.textContent || '';
        })()
      `);
      if (tab.includes('NNSDFILLABLEAPP_1_fillable.pdf')) break;
      await sleep(400);
    }
    await sleep(900);

    const reopened = await client.eval(`
      (() => {
        const inputs = Array.from(document.querySelectorAll('.form-widget-box input[type="text"]'));
        return {
          widgetCount: document.querySelectorAll('.form-widget-box').length,
          val0: inputs[0]?.value || '',
          val1: inputs[1]?.value || '',
          val2: inputs[2]?.value || '',
        };
      })()
    `);
    console.log('Reopened NSD check:', reopened);
    assert(reopened.widgetCount >= 25, 'Reopened NSD widget count mismatch');
    assert(reopened.val0 === 'Example Roadside Recovery LLC', 'NSD legal business name did not persist');
    assert(reopened.val1 === 'Example Towing', 'NSD DBA did not persist');
    assert(reopened.val2 === '123 Example Boulevard', 'NSD address did not persist');
    assert(sha256(nsdPdf) === origNsdHash, 'Original NSD fixture SHA-256 changed!');

    await client.screenshot(path.join(shotsDir, 'nsd-reopened.png'));
    console.log('ALL SCANNED NSD FORM DETECTION & FILLING GUI CHECKS PASSED!');
    client.close();
  } finally {
    cleanup();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

