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

  const geicoPdf = path.join(rootDir, 'tests', 'fixtures', 'PROVIDER APP REQ FORM (2).pdf');
  const origHash = sha256(geicoPdf);

  const firstFilledOut = path.join(outDir, 'PROVIDER APP REQ FORM (2)_filled.pdf');
  const customSaveAsOut = path.join(outDir, 'GEICO_Custom_SaveAs.pdf');
  for (const f of [firstFilledOut, customSaveAsOut, firstFilledOut + '.bak']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const dialogQueueFile = path.join(outDir, 'test_save_dialog_queue.json');
  fs.writeFileSync(dialogQueueFile, JSON.stringify({ calls: [], queue: [null, firstFilledOut, customSaveAsOut] }));

  const cdpPort = 9248;
  const backendPort = 18448;
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

    // 1. Open GEICO PDF via file input
    await client.send('DOM.enable');
    const docNode = await client.send('DOM.getDocument', { depth: 1 });
    const fileInput = await client.send('DOM.querySelector', {
      nodeId: docNode.root.nodeId,
      selector: 'input[type="file"][accept=".pdf"]',
    });
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
    assert(activeTab.includes('PROVIDER APP REQ FORM'), 'GEICO tab did not activate');

    // 2. Forms -> Prepare Form -> Detect Fields -> Accept All (34)
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Forms')?.click()`);
    await sleep(300);
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Prepare Form')?.click()`);
    await sleep(300);
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Detect Fields'))?.click()`);
    for (let i = 0; i < 20; i++) {
      if ((await client.eval(`document.querySelectorAll('.form-candidate-box').length`)) === 34) break;
      await sleep(300);
    }
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Accept All'))?.click()`);
    for (let i = 0; i < 40; i++) {
      if ((await client.eval(`document.querySelectorAll('.form-widget-box').length`)) === 34) break;
      await sleep(400);
    }

    // 3. Fill all 10 text/multiline fields + 7 checkboxes WITHOUT clicking "Save Filled Values"
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
      assert(pos, `Missing input ${i}`);
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await client.send('Input.insertText', { text: fillMap[i] });
      await sleep(60);
    }
    await client.eval(`
      (() => {
        const cbs = Array.from(document.querySelectorAll('.form-widget-box input[type="checkbox"]'));
        [0, 1, 2, 5, 9, 20, 23].forEach(idx => { if (cbs[idx] && !cbs[idx].checked) cbs[idx].click(); });
      })()
    `);
    await sleep(250);

    // Verify unsaved dirty dot is visible
    const hasDirtyDot = await client.eval(`!!document.querySelector('.doc-tab.active .dirty-dot')`);
    assert(hasDirtyDot, 'Expected unsaved-changes dirty dot on active tab after typing');
    await client.screenshot(path.join(shotsDir, 'geico-save-fix-before-apply.png'));

    // 4. BUG 2 CHECK: Switch to Prepare Form, select field, change Font Size, click Apply Field Changes WITHOUT Save Filled Values
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Prepare Form')?.click()`);
    await sleep(500);
    await client.eval(`document.querySelector('.form-widget-box')?.click()`);
    await sleep(300);
    await client.eval(`
      (() => {
        const applyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Apply Field Changes');
        if (applyBtn) applyBtn.click();
      })()
    `);
    await sleep(900);

    const afterApplyCheck = await client.eval(`
      (() => {
        const inputs = Array.from(document.querySelectorAll('.form-widget-box input[type="text"], .form-widget-box textarea'));
        const cbs = Array.from(document.querySelectorAll('.form-widget-box input[type="checkbox"]'));
        return {
          businessName: inputs[0]?.value || '',
          telephone: inputs[3]?.value || '',
          email: inputs[4]?.value || '',
          checkedCount: cbs.filter(c => c.checked).length,
        };
      })()
    `);
    console.log('After Apply Field Changes:', afterApplyCheck);
    assert(afterApplyCheck.businessName === 'Example Coastal Roadside LLC', 'BUG 2: Apply Field Changes erased businessName!');
    assert(afterApplyCheck.telephone === '555-0100', 'BUG 2: Apply Field Changes erased telephone!');
    assert(afterApplyCheck.email === 'example@example.com', 'BUG 2: Apply Field Changes erased email!');
    assert(afterApplyCheck.checkedCount === 7, 'BUG 2: Apply Field Changes erased checkboxes!');
    await client.screenshot(path.join(shotsDir, 'geico-save-fix-after-apply.png'));

    // 5. Switch to Edit PDF and back to Forms -> Fill Form, verify values persist
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Edit PDF')?.click()`);
    await sleep(300);
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Forms')?.click()`);
    await sleep(300);
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Fill Form')?.click()`);
    await sleep(300);

    // 6. BUG 3 + BUG 1 CHECK: Test native saveFileDialog IPC suggested _filled.pdf, Cancel, then Save PDF directly WITHOUT Save Filled Values!
    // 6a. Click Save PDF -> first dialog call returns null (Cancel)
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Save PDF')?.click()`);
    await sleep(600);
    const dialogState1 = JSON.parse(fs.readFileSync(dialogQueueFile, 'utf8'));
    const cancelCheck = await client.eval(`({
      notice: document.querySelector('.notice-banner')?.textContent || '',
      businessName: document.querySelectorAll('.form-widget-box input[type="text"]')[0]?.value || ''
    })`);
    console.log('Save Cancel check:', { calls: dialogState1.calls, ...cancelCheck });
    assert(dialogState1.calls.length === 1 && dialogState1.calls[0].endsWith('PROVIDER APP REQ FORM (2)_filled.pdf'), `Expected _filled.pdf suggestion, got ${dialogState1.calls[0]}`);
    assert(cancelCheck.businessName === 'Example Coastal Roadside LLC', 'Cancel discarded in-memory edits!');
    assert(!fs.existsSync(firstFilledOut), 'Cancel should not write output file');

    // 6b. Click Save PDF directly -> writes _filled.pdf cleanly WITHOUT clicking Save Filled Values
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Save PDF')?.click()`);
    await sleep(1200);
    assert(fs.existsSync(firstFilledOut), 'First Save PDF did not create _filled.pdf');
    await client.screenshot(path.join(shotsDir, 'geico-save-fix-after-save.png'));

    // 6c. Rapid edit + subsequent Save PDF -> should NOT prompt Save As again!
    const telPos = await client.eval(`
      (() => {
        const el = document.querySelectorAll('.form-widget-box input[type="text"]')[3];
        el.value = '';
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + 20, y: r.top + r.height / 2 };
      })()
    `);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: telPos.x, y: telPos.y, button: 'left', clickCount: 3 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: telPos.x, y: telPos.y, button: 'left', clickCount: 3 });
    await client.send('Input.insertText', { text: '555-0199' });
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Save PDF')?.click()`);
    await sleep(900);
    const dialogState2 = JSON.parse(fs.readFileSync(dialogQueueFile, 'utf8'));
    assert(dialogState2.calls.length === 2, `Subsequent Save should not open Save As dialog (calls=${dialogState2.calls.length})`);

    // 6d. Click Save As -> prompts Save As dialog and writes custom path
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Save As')?.click()`);
    await sleep(900);
    const dialogState3 = JSON.parse(fs.readFileSync(dialogQueueFile, 'utf8'));
    assert(dialogState3.calls.length === 3 && fs.existsSync(customSaveAsOut), 'Save As did not write custom output file');

    // 7. Reopen the saved _filled.pdf in a fresh tab and verify ALL entered values persisted!
    const docNode2 = await client.send('DOM.getDocument', { depth: 1 });
    const fileInput2 = await client.send('DOM.querySelector', {
      nodeId: docNode2.root.nodeId,
      selector: 'input[type="file"][accept=".pdf"]',
    });
    await client.send('DOM.setFileInputFiles', { nodeId: fileInput2.nodeId, files: [firstFilledOut] });
    for (let i = 0; i < 30; i++) {
      const tab = await client.eval(`
        (() => {
          const tabs = Array.from(document.querySelectorAll('.doc-tab'));
          const t = tabs.find(el => el.textContent.includes('_filled.pdf'));
          if (t && !t.classList.contains('active')) t.click();
          return document.querySelector('.doc-tab.active')?.textContent || '';
        })()
      `);
      if (tab.includes('_filled.pdf')) break;
      await sleep(400);
    }
    await sleep(900);

    const reopened = await client.eval(`
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
    console.log('Reopened saved _filled.pdf check:', reopened);
    assert(reopened.widgetCount === 34, 'Reopened widget count mismatch');
    assert(reopened.businessName === 'Example Coastal Roadside LLC', 'Reopened businessName lost!');
    assert(reopened.telephone === '555-0199', 'Reopened rapid-edited telephone lost!');
    assert(reopened.email === 'example@example.com', 'Reopened email lost!');
    assert(reopened.checkedCount === 7, 'Reopened checkbox states lost!');

    // Original GEICO fixture MUST remain byte-for-byte unchanged
    assert(sha256(geicoPdf) === origHash, 'Original GEICO fixture SHA-256 changed!');
    await client.screenshot(path.join(shotsDir, 'geico-save-fix-reopened.png'));
    console.log('ALL FORM SAVE INTEGRITY & SAFE SAVE WORKFLOW GUI CHECKS PASSED!');
    client.close();
  } finally {
    cleanup();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

