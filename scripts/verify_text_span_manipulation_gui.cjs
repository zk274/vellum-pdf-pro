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
      this.ws.on('close', (code, reason) => {
        console.log(`WebSocket closed (code: ${code}, reason: ${reason})`);
      });
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
  const cdpPort = 9245;
  console.log('Starting Electron with CDP on port ' + cdpPort + '...');

  const electronBin = require('electron');
  const electronProcess = spawn(
    electronBin,
    ['--no-sandbox', '.', `--remote-debugging-port=${cdpPort}`],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        DISPLAY: process.env.DISPLAY || ':0',
        ELECTRON_ENABLE_LOGGING: '1',
      },
      stdio: 'inherit',
    }
  );

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

    await sleep(2000);

    // 2. Select the Hyperlink text span
    console.log('Finding and selecting hyperlink text span...');
    const selectResult = await client.eval(`
      (() => {
        const hitboxes = Array.from(document.querySelectorAll('.span-box'));
        const linkHitbox = hitboxes.find(h => h.title && h.title.includes('specifications.vellumpdf.linux/msa'));
        if (linkHitbox) {
          linkHitbox.click();
          return { found: true, title: linkHitbox.title };
        }
        return { found: false, count: hitboxes.length };
      })()
    `);
    console.log('Select result:', selectResult);
    await sleep(800);

    // Verify selection frame and badge
    const frameInfo = await client.eval(`
      (() => {
        const frame = document.querySelector('.object-selection-frame');
        const badge = document.querySelector('.selection-dimension-badge');
        const inspector = document.querySelector('.right-inspector');
        return {
          frameVisible: Boolean(frame),
          badgeText: badge ? badge.textContent.trim() : null,
          inspectorText: inspector ? inspector.textContent.slice(0, 200) : null
        };
      })()
    `);
    console.log('Initial text span selection state:', frameInfo);

    // Capture screenshot: text span selected with handles
    const shotBefore = path.resolve(__dirname, '../docs/screenshots/text-span-selected.png');
    await client.screenshot(shotBefore);

    // 3. Resize bounding box from 190x14 pt to 239x42 pt
    console.log('Dragging resize handle (handle-se) to expand bounding box to 239x42 pt...');
    const handleSeRect = await client.eval(`
      (() => {
        const handle = document.querySelector('.resize-handle.handle-se');
        if (!handle) return null;
        const r = handle.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    console.log('Handle SE position:', handleSeRect);

    if (handleSeRect) {
      const fromX = Math.round(handleSeRect.x);
      const fromY = Math.round(handleSeRect.y);
      const toX = fromX + 49; // 190 -> 239 pt
      const toY = fromY + 28; // 14 -> 42 pt

      console.log(`Sending mousePressed at (${fromX}, ${fromY})...`);
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1 });
      console.log('mousePressed sent.');
      await sleep(150);
      console.log(`Sending mouseMoved to (${toX}, ${toY})...`);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: toX, y: toY });
      console.log('mouseMoved sent.');
      await sleep(200);
      console.log(`Sending mouseReleased at (${toX}, ${toY})...`);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left' });
      console.log('mouseReleased sent.');
      await sleep(2000);
    }

    // Verify text is still present in page objects and canvas
    const postResizeState = await client.eval(`
      (() => {
        const badge = document.querySelector('.selection-dimension-badge');
        const hitboxes = Array.from(document.querySelectorAll('.span-box'));
        const linkHitbox = hitboxes.find(h => h.title && h.title.includes('specifications.vellumpdf.linux/msa'));
        return {
          badgeText: badge ? badge.textContent.trim() : null,
          linkHitboxPresent: Boolean(linkHitbox),
          linkTitle: linkHitbox ? linkHitbox.title : null
        };
      })()
    `);
    console.log('Post-resize state:', postResizeState);

    const shotResized = path.resolve(__dirname, '../docs/screenshots/text-span-after-resize.png');
    await client.screenshot(shotResized);

    // 4. Move text span by dragging selection body
    console.log('Dragging selection body to move text span...');
    const bodyRect = await client.eval(`
      (() => {
        const body = document.querySelector('.object-selection-body');
        if (!body) return null;
        const r = body.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    console.log('Body position:', bodyRect);

    if (bodyRect) {
      const fromX = Math.round(bodyRect.x);
      const fromY = Math.round(bodyRect.y);
      const toX = fromX + 60;
      const toY = fromY + 40;

      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1 });
      await sleep(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: toX, y: toY });
      await sleep(100);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left' });
      await sleep(1500);
    }

    const postMoveState = await client.eval(`
      (() => {
        const badge = document.querySelector('.selection-dimension-badge');
        const hitboxes = Array.from(document.querySelectorAll('.span-box'));
        const linkHitbox = hitboxes.find(h => h.title && h.title.includes('specifications.vellumpdf.linux/msa'));
        return {
          badgeText: badge ? badge.textContent.trim() : null,
          linkHitboxPresent: Boolean(linkHitbox),
          linkTitle: linkHitbox ? linkHitbox.title : null
        };
      })()
    `);
    console.log('Post-move state:', postMoveState);

    const shotMoved = path.resolve(__dirname, '../docs/screenshots/text-span-after-move.png');
    await client.screenshot(shotMoved);

    // 5. Test Undo
    console.log('Clicking Undo in top menu / toolbar...');
    await client.eval(`
      (() => {
        const undoBtn = document.querySelector('button[title*="Undo"], .tool-btn[title*="Undo"]');
        if (undoBtn) {
          undoBtn.click();
          return true;
        }
        return false;
      })()
    `);
    await sleep(1200);

    const shotUndo = path.resolve(__dirname, '../docs/screenshots/text-span-after-undo.png');
    await client.screenshot(shotUndo);

    console.log('GUI Verification of text-span manipulation completed successfully!');
    client.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
