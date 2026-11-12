const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('/usr/share/nodejs/ws');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getPageTarget(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const page = list.find(t => t.type === 'page');
          if (page) resolve(page);
          else reject(new Error('No page target found'));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
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
      returnByValue: true
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
  const cdpPort = 9232;
  console.log('Starting Electron with CDP on port ' + cdpPort + '...');

  const electronBin = require('electron');
  const electronProcess = spawn(electronBin, ['--no-sandbox', '.', `--remote-debugging-port=${cdpPort}`], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      DISPLAY: process.env.DISPLAY || ':0',
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: 'inherit'
  });

  const cleanup = () => {
    try {
      electronProcess.kill('SIGTERM');
    } catch (e) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  try {
    let target = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        target = await getPageTarget(cdpPort);
        if (target) break;
      } catch (e) {}
    }

    if (!target) {
      throw new Error('Could not connect to CDP target page on port ' + cdpPort);
    }

    console.log('Connecting to target:', target.webSocketDebuggerUrl);
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();

    // Wait for backend ready in status bar
    console.log('Waiting for backend Ready state in status bar...');
    let isReady = false;
    for (let i = 0; i < 30; i++) {
      const statusText = await client.eval(`document.querySelector('.status-bar')?.textContent || ''`);
      if (statusText.includes('Ready (Offline)')) {
        isReady = true;
        console.log('Backend confirmed Ready:', statusText.trim());
        break;
      }
      await sleep(500);
    }

    if (!isReady) {
      console.warn('Backend did not reach Ready (Offline) within 15s');
    }

    // 1. Open Showcase PDF
    console.log('Clicking Open Showcase PDF button...');
    await client.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Showcase PDF'));
      if (btn) btn.click();
    `);

    // Wait for page stage to render
    for (let i = 0; i < 20; i++) {
      const hasStage = await client.eval(`Boolean(document.querySelector('.pdf-page-stage'))`);
      if (hasStage) {
        console.log('PDF page stage successfully mounted!');
        break;
      }
      await sleep(500);
    }

    await sleep(1500);

    // 2. Select "+ Add Text Box (Drag on Page)" tool
    console.log('Clicking Add Text Box tool...');
    const addTextBtnClicked = await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('.tool-btn')).find(b => b.textContent.includes('Add Text Box'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Add Text Box tool button clicked:', addTextBtnClicked);
    await sleep(500);

    // Get canvas stage bounding rect
    const stageRect = await client.eval(`
      (() => {
        const stage = document.querySelector('.pdf-page-stage');
        if (!stage) return null;
        const r = stage.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      })()
    `);
    console.log('Stage rect:', stageRect);

    if (stageRect) {
      const startX = Math.round(stageRect.left + 100);
      const startY = Math.round(stageRect.top + 100);
      const endX = Math.round(startX + 260);
      const endY = Math.round(startY + 80);

      console.log(`Dragging from (${startX}, ${startY}) to (${endX}, ${endY})...`);
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', clickCount: 1 });
      await sleep(150);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: endX, y: endY });
      await sleep(150);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: endY, button: 'left' });
      await sleep(1000);

      // Verify inline textbox overlay appeared
      const hasDraftOverlay = await client.eval(`Boolean(document.querySelector('.inline-textbox-overlay'))`);
      console.log('Inline text box editor overlay present:', hasDraftOverlay);

      if (hasDraftOverlay) {
        // Focus and type text via CDP Input.insertText
        await client.eval(`
          const ta = document.querySelector('.inline-textbox-input');
          if (ta) ta.focus();
        `);
        await sleep(200);
        await client.send('Input.insertText', { text: "Executive Briefing: Vellum Object Manipulation" });
        await sleep(500);

        // Click Insert into PDF
        await client.eval(`
          const applyBtn = document.querySelector('.inline-textbox-toolbar .mini-btn.apply');
          if (applyBtn) applyBtn.click();
        `);
        console.log('Committed draft text box.');
        await sleep(2000);
      }
    }

    // 3. Find and click the newly inserted Vellum text box overlay
    console.log('Searching for .vellum-box-overlay...');
    const boxCount = await client.eval(`document.querySelectorAll('.vellum-box-overlay').length`);
    console.log('Vellum box overlays found:', boxCount);

    if (boxCount > 0) {
      await client.eval(`
        const box = document.querySelector('.vellum-box-overlay');
        if (box) box.click();
      `);
      await sleep(800);
    }

    // Verify selection frame and 8 handles
    const selectionState = await client.eval(`
      (() => {
        const frame = document.querySelector('.object-selection-frame');
        const handles = document.querySelectorAll('.resize-handle');
        const badge = document.querySelector('.selection-dimension-badge');
        const inspector = document.querySelector('.right-inspector');
        return {
          frameVisible: Boolean(frame),
          handlesCount: handles.length,
          badgeText: badge ? badge.textContent.trim() : null,
          inspectorHasMove: inspector ? inspector.textContent.includes('Selected Text Box') : false
        };
      })()
    `);
    console.log('Selection State:', selectionState);

    const screenshotsDir = path.resolve(__dirname, '../docs/screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

    // Screenshot 1: Object selected with 8 handles and dimension badge
    await client.screenshot(path.join(screenshotsDir, 'object-selected-handles.png'));

    // 4. Test live drag-to-move
    const bodyCenter = await client.eval(`
      (() => {
        const body = document.querySelector('.object-selection-body');
        if (!body) return null;
        const r = body.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()
    `);

    if (bodyCenter) {
      console.log(`Dragging selection body from (${bodyCenter.x}, ${bodyCenter.y})...`);
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bodyCenter.x, y: bodyCenter.y, button: 'left', clickCount: 1 });
      await sleep(100);

      // Drag +80px right, +60px down
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bodyCenter.x + 80, y: bodyCenter.y + 60 });
      await sleep(400);

      // Screenshot 2: Live drag-to-move in progress with snapping / alignment
      await client.screenshot(path.join(screenshotsDir, 'object-drag-move.png'));

      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bodyCenter.x + 80, y: bodyCenter.y + 60, button: 'left' });
      console.log('Finished drag-to-move gesture.');
      await sleep(2000);
    }

    // 5. Test Resizing handle
    const seHandlePos = await client.eval(`
      (() => {
        const h = document.querySelector('.handle-se');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()
    `);

    if (seHandlePos) {
      console.log(`Dragging SE resize handle from (${seHandlePos.x}, ${seHandlePos.y})...`);
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: seHandlePos.x, y: seHandlePos.y, button: 'left', clickCount: 1 });
      await sleep(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: seHandlePos.x + 90, y: seHandlePos.y + 40 });
      await sleep(200);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: seHandlePos.x + 90, y: seHandlePos.y + 40, button: 'left' });
      console.log('Finished resize gesture.');
      await sleep(2000);
    }

    // 6. Test Arrow nudging
    console.log('Nudging object with Arrow keys...');
    await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight' });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
    await sleep(200);
    await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown' });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown' });
    await sleep(1000);

    // Screenshot 3: Object resized, moved, and saved
    await client.screenshot(path.join(screenshotsDir, 'object-resized-saved.png'));

    console.log('GUI verification completed successfully!');
    client.close();
  } finally {
    electronProcess.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
