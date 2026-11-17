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
  const multiOutPdf = path.join(outDir, 'NNSDFILLABLEAPP_multipage_verified.pdf');
  if (fs.existsSync(multiOutPdf)) fs.unlinkSync(multiOutPdf);
  const dialogQueueFile = path.join(outDir, 'test_nsd_dialog_queue.json');
  fs.writeFileSync(dialogQueueFile, JSON.stringify({ calls: [], queue: [nsdOutPdf, multiOutPdf] }));

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
    } catch (e) { }
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
      } catch (e) { }
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

    // 6. Test Persistent Page Navigator + Page 2 (Yes/No), Page 4 (0 false positives), Page 12 (5 Initials), Page 16 (Rate table)
    const jumpAndDetect = async (pageNum, expectedMinCands, expectedMaxCands, shotName) => {
      await client.eval(`
        (() => {
          const inp = document.querySelector('.page-navigator-bar input[type="number"]');
          if (inp) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(inp, '${pageNum}');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
            inp.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        })()
      `);
      for (let i = 0; i < 20; i++) {
        const st = await client.eval(`document.querySelector('.status-bar')?.textContent || ''`);
        if (st.includes('Page ${pageNum} of 16')) break;
        await sleep(250);
      }
      const statusTxt = await client.eval(`document.querySelector('.status-bar')?.textContent || ''`);
      assert(statusTxt.includes(`Page ${pageNum} of 16`), `Status bar failed to sync to Page ${pageNum}: ${statusTxt}`);

      await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Prepare Form')?.click()`);
      await sleep(200);
      await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Detect Current Page'))?.click()`);
      await sleep(800);
      for (let i = 0; i < 70; i++) {
        const cnt = await client.eval(`document.querySelectorAll('.form-candidate-box').length`);
        const banner = await client.eval(`document.querySelector('.notice-banner')?.textContent || ''`);
        if (cnt >= expectedMinCands && cnt <= expectedMaxCands) break;
        if (expectedMaxCands === 0 && (banner.includes('No confident') || banner.includes(`on Page ${pageNum}.`))) break;
        await sleep(300);
      }
      const finalCnt = await client.eval(`document.querySelectorAll('.form-candidate-box').length`);
      console.log(`NSD Page ${pageNum} navigator+detect: cands=${finalCnt}`);
      assert(finalCnt >= expectedMinCands && finalCnt <= expectedMaxCands, `Page ${pageNum}: expected ${expectedMinCands}..${expectedMaxCands}, got ${finalCnt}`);
      await client.screenshot(path.join(shotsDir, shotName));
    };

    // Switch back to original NSD tab to test p2, p4, p12, p16 cleanly
    await client.eval(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('.doc-tab'));
        const t = tabs.find(el => el.textContent.includes('NNSDFILLABLEAPP (1)'));
        if (t) t.click();
      })()
    `);
    await sleep(600);
    await jumpAndDetect(2, 71, 71, 'nsd-page2-nav-and-yesno.png');
    // Accept Page 2 candidates and test real GUI Yes/No radio + checkbox interactions + Tab/Shift+Tab
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('Accept All ('))?.click()`);
    for (let i = 0; i < 120; i++) {
      const wCnt = await client.eval(`document.querySelectorAll('.form-widget-box').length`);
      const cCnt = await client.eval(`document.querySelectorAll('.form-candidate-box').length`);
      if (wCnt >= 71 && cCnt === 0) break;
      await sleep(250);
    }
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Fill Form')?.click()`);
    for (let i = 0; i < 20; i++) {
      const rCnt = await client.eval(`document.querySelectorAll('.form-widget-box input[type="radio"]').length`);
      if (rCnt >= 18) break;
      await sleep(200);
    }
    // Test Tab / Shift+Tab navigation between Page 2 form controls
    await client.eval(`document.querySelector('.form-widget-box input')?.focus()`);
    const firstFocusedName = await client.eval(`document.activeElement?.name || document.activeElement?.type || ''`);
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(80);
    const afterTabEl = await client.eval(`document.activeElement !== document.querySelector('.form-widget-box input')`);
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(80);
    const afterShiftTabEl = await client.eval(`document.activeElement === document.querySelector('.form-widget-box input')`);
    assert(afterTabEl && afterShiftTabEl && firstFocusedName !== '', 'Page 2 Tab / Shift+Tab navigation failed');

    await client.eval(`
      (() => {
        const radios = Array.from(document.querySelectorAll('.form-widget-box input[type="radio"]'));
        if (radios.length >= 9) {
          radios[0].click(); // repair facility Yes
          radios[2].click(); // sell tires Yes
          radios[6].click(); // secure storage lot Yes
        }
      })()
    `);
    await sleep(150);
    await client.eval(`
      (() => {
        const radios = Array.from(document.querySelectorAll('.form-widget-box input[type="radio"]'));
        const cbs = Array.from(document.querySelectorAll('.form-widget-box input[type="checkbox"]'));
        if (radios.length >= 9) {
          radios[1].click(); // switch repair facility -> No
          radios[7].click(); // switch secure storage lot -> No
        }
        if (cbs.length >= 3) {
          cbs[0].click(); // tires Auto
          cbs[2].click(); // tires Motorcycle
        }
      })()
    `);
    await sleep(200);
    const p2Interactive = await client.eval(`
      (() => {
        const radios = Array.from(document.querySelectorAll('.form-widget-box input[type="radio"]'));
        const cbs = Array.from(document.querySelectorAll('.form-widget-box input[type="checkbox"]'));
        return {
          radioCount: radios.length,
          cbCount: cbs.length,
          r0Checked: radios[0]?.checked || false,
          r1Checked: radios[1]?.checked || false,
          r2Checked: radios[2]?.checked || false,
          r6Checked: radios[6]?.checked || false,
          r7Checked: radios[7]?.checked || false,
          c0Checked: cbs[0]?.checked || false,
          c2Checked: cbs[2]?.checked || false,
        };
      })()
    `);
    console.log('NSD Page 2 interactive state:', p2Interactive);
    assert(p2Interactive.radioCount === 18 && !p2Interactive.r0Checked && p2Interactive.r1Checked && p2Interactive.r2Checked && !p2Interactive.r6Checked && p2Interactive.r7Checked, 'Page 2 radio mutual exclusion failed');
    assert(p2Interactive.cbCount === 40 && p2Interactive.c0Checked && p2Interactive.c2Checked, 'Page 2 independent checkboxes failed');

    await jumpAndDetect(4, 4, 4, 'nsd-p4-clean.png');
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('Accept All ('))?.click()`);
    for (let i = 0; i < 40; i++) {
      const wCnt = await client.eval(`document.querySelectorAll('.form-widget-box').length`);
      const cCnt = await client.eval(`document.querySelectorAll('.form-candidate-box').length`);
      if (wCnt >= 4 && cCnt === 0) break;
      await sleep(200);
    }
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Fill Form')?.click()`);
    await sleep(200);
    await client.eval(`
      (() => {
        const setVal = (el, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        };
        const inputs = Array.from(document.querySelectorAll('.form-widget-box input'));
        ['17', 'November', '26', 'Example Roadside Recovery LLC'].forEach((v, idx) => {
          if (inputs[idx]) setVal(inputs[idx], v);
        });
      })()
    `);
    await sleep(300);

    await jumpAndDetect(12, 5, 5, 'nsd-p12-initials.png');
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('Accept All ('))?.click()`);
    for (let i = 0; i < 40; i++) {
      const wCnt = await client.eval(`document.querySelectorAll('.form-widget-box').length`);
      const cCnt = await client.eval(`document.querySelectorAll('.form-candidate-box').length`);
      if (wCnt >= 5 && cCnt === 0) break;
      await sleep(200);
    }
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Fill Form')?.click()`);
    await sleep(200);
    await client.eval(`
      (() => {
        const setVal = (el, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        };
        const inputs = Array.from(document.querySelectorAll('.form-widget-box input'));
        inputs.forEach((inp, idx) => setVal(inp, 'E' + (idx + 1)));
      })()
    `);
    await sleep(300);

    // Save multi-page NSD edits (Page 2, Page 4, Page 12) to multiOutPdf
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Save PDF')?.click()`);
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(multiOutPdf)) break;
      await sleep(250);
    }
    assert(fs.existsSync(multiOutPdf), 'Multi-page NSD output PDF was not saved');

    await jumpAndDetect(16, 121, 121, 'nsd-p16-table.png');
    const p16NobOk = await client.eval(`document.querySelectorAll('.form-candidate-box').length === 121`);
    assert(p16NobOk, 'Page 16 expected 121 clean candidate boxes');

    // Reopen saved multiOutPdf in a fresh tab and verify Page 2, Page 4, Page 12 persisted
    const docNode3 = await client.send('DOM.getDocument', { depth: 1 });
    const fileInput3 = await client.send('DOM.querySelector', {
      nodeId: docNode3.root.nodeId,
      selector: 'input[type="file"][accept=".pdf"]',
    });
    await client.send('DOM.setFileInputFiles', { nodeId: fileInput3.nodeId, files: [multiOutPdf] });
    for (let i = 0; i < 30; i++) {
      const tab = await client.eval(`
        (() => {
          const tabs = Array.from(document.querySelectorAll('.doc-tab'));
          const t = tabs.find(el => el.textContent.includes('NNSDFILLABLEAPP_multipage_verified'));
          if (t && !t.classList.contains('active')) t.click();
          return document.querySelector('.doc-tab.active')?.textContent || '';
        })()
      `);
      if (tab.includes('NNSDFILLABLEAPP_multipage_verified')) break;
      await sleep(300);
    }
    await sleep(600);
    const jumpPageOnly = async (pNum) => {
      await client.eval(`
        (() => {
          const inp = document.querySelector('.page-navigator-bar input[type="number"]');
          if (inp) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(inp, '${pNum}');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()
      `);
      await sleep(80);
      await client.eval(`
        (() => {
          const inp = document.querySelector('.page-navigator-bar input[type="number"]');
          if (inp) {
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
            inp.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        })()
      `);
      for (let i = 0; i < 25; i++) {
        const st = await client.eval(`document.querySelector('.status-bar')?.textContent || ''`);
        if (st.includes('Page ' + pNum + ' of 16')) break;
        await sleep(200);
      }
      const stFinal = await client.eval(`document.querySelector('.status-bar')?.textContent || ''`);
      assert(stFinal.includes('Page ' + pNum + ' of 16'), 'jumpPageOnly failed to sync to Page ' + pNum + ': ' + stFinal);
      await sleep(400);
    };
    await jumpPageOnly(2);
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Fill Form')?.click()`);
    for (let i = 0; i < 20; i++) {
      if ((await client.eval(`document.querySelectorAll('.form-widget-box input[type="radio"]').length`)) >= 8) break;
      await sleep(200);
    }
    const p2Reopen = await client.eval(`({
      tab: document.querySelector('.doc-tab.active')?.textContent || '',
      radioCount: document.querySelectorAll('.form-widget-box input[type="radio"]').length,
      cbCount: document.querySelectorAll('.form-widget-box input[type="checkbox"]').length,
      r0: document.querySelectorAll('.form-widget-box input[type="radio"]')[0]?.checked || false,
      r1: document.querySelectorAll('.form-widget-box input[type="radio"]')[1]?.checked || false,
      r2: document.querySelectorAll('.form-widget-box input[type="radio"]')[2]?.checked || false,
      r6: document.querySelectorAll('.form-widget-box input[type="radio"]')[6]?.checked || false,
      r7: document.querySelectorAll('.form-widget-box input[type="radio"]')[7]?.checked || false,
      c0: document.querySelectorAll('.form-widget-box input[type="checkbox"]')[0]?.checked || false,
      c2: document.querySelectorAll('.form-widget-box input[type="checkbox"]')[2]?.checked || false,
    })`);
    console.log('Reopened Page 2 state:', p2Reopen);
    assert(
      p2Reopen.radioCount === 18 && p2Reopen.cbCount === 40
      && !p2Reopen.r0 && p2Reopen.r1 && p2Reopen.r2 && !p2Reopen.r6 && p2Reopen.r7
      && p2Reopen.c0 && p2Reopen.c2,
      'Reopened Page 2 radio/checkbox values did not persist'
    );

    await jumpPageOnly(4);
    const p4Reopen = await client.eval(`Array.from(document.querySelectorAll('.form-widget-box input')).map(i => i.value)`);
    console.log('Reopened Page 4 values:', p4Reopen);
    assert(p4Reopen.length === 4 && p4Reopen[0] === '17' && p4Reopen[3] === 'Example Roadside Recovery LLC', 'Reopened Page 4 values did not persist');

    await jumpPageOnly(12);
    const p12Reopen = await client.eval(`Array.from(document.querySelectorAll('.form-widget-box input')).map(i => i.value)`);
    console.log('Reopened Page 12 initials:', p12Reopen);
    assert(p12Reopen.length === 5 && p12Reopen.every((v, idx) => v === 'E' + (idx + 1)), 'Reopened Page 12 initials did not persist');

    // 7. Test Document Closing clears thumbnails, canvas, and overlays without stale ghost state
    for (let k = 0; k < 6; k++) {
      const closed = await client.eval(`
        (() => {
          const btn = document.querySelector('.doc-tab .tab-close');
          if (!btn) return false;
          btn.click();
          return true;
        })()
      `);
      if (!closed) break;
      await sleep(300);
      await client.eval(`
        (() => {
          const discardBtn = Array.from(document.querySelectorAll('.modal-card button')).find(
            (b) => b.textContent && b.textContent.includes('Discard & Close')
          );
          if (discardBtn) discardBtn.click();
        })()
      `);
      await sleep(350);
    }
    const postClose = await client.eval(`({
      tabs: document.querySelectorAll('.doc-tab').length,
      thumbs: document.querySelectorAll('.thumb-card').length,
      stage: !!document.querySelector('.pdf-page-stage'),
      cands: document.querySelectorAll('.form-candidate-box').length,
      widgets: document.querySelectorAll('.form-widget-box').length,
    })`);
    console.log('Post-close state check:', postClose);
    assert(postClose.tabs === 0 && postClose.thumbs === 0 && !postClose.stage && postClose.cands === 0 && postClose.widgets === 0, 'Stale viewer state remained after closing all documents!');
    await client.screenshot(path.join(shotsDir, 'nsd-closed-welcome.png'));

    console.log('ALL SCANNED NSD FORM DETECTION, NAVIGATOR & LIFECYCLE GUI CHECKS PASSED!');
    client.close();
  } finally {
    cleanup();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

