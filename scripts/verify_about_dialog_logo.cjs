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
  const cdpPort = 9229;
  console.log('Starting Electron with packaged dist build...');
  
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

  try {
    let target = null;
    for (let i = 0; i < 30; i++) {
      try {
        target = await getPageTarget(cdpPort);
        if (target) break;
      } catch (_) {}
      await sleep(500);
    }

    if (!target) {
      throw new Error('Failed to connect to Electron CDP target within 15s');
    }

    console.log(`Connected to page target: ${target.title}`);
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();

    // Wait for the UI header to load
    await sleep(2000);

    // Open About Modal by clicking the brand badge
    console.log('Clicking .brand-badge to open About modal...');
    await client.eval(`
      (() => {
        const badge = document.querySelector('.brand-badge');
        if (badge) badge.click();
      })()
    `);

    await sleep(800);

    // Check image element in About modal
    const imgInfo = await client.eval(`
      (() => {
        const img = document.querySelector('.modal-card img');
        if (!img) return { error: 'No image element found in modal-card' };
        return {
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          width: img.width,
          height: img.height,
          currentSrc: img.currentSrc,
          alt: img.alt,
          computedFilter: window.getComputedStyle(img).filter,
        };
      })()
    `);

    console.log('About Dialog Image Verification Info:', JSON.stringify(imgInfo, null, 2));

    if (imgInfo.error) {
      throw new Error(`Image verification failed: ${imgInfo.error}`);
    }

    if (!imgInfo.complete || imgInfo.naturalWidth === 0 || imgInfo.naturalHeight === 0) {
      throw new Error(`Logo image is STILL broken! complete=${imgInfo.complete}, naturalWidth=${imgInfo.naturalWidth}`);
    }

    console.log('SUCCESS: Logo image successfully loaded in About modal!');
    console.log(`Natural Dimensions: ${imgInfo.naturalWidth}x${imgInfo.naturalHeight}`);
    console.log(`Rendered Dimensions: ${imgInfo.width}x${imgInfo.height}`);
    console.log(`Resolved Source URL: ${imgInfo.currentSrc}`);

    // Take screenshot of dark modal
    await client.screenshot('docs/screenshots/branded-about-modal-dark.png');

    // Switch to light theme and verify
    console.log('Switching to light theme...');
    await client.eval(`
      (() => {
        const themeBtn = Array.from(document.querySelectorAll('button')).find(b => b.title && b.title.includes('Theme'));
        if (themeBtn) themeBtn.click();
      })()
    `);
    await sleep(600);

    // Take screenshot of light modal
    await client.screenshot('docs/screenshots/branded-about-modal-light.png');

    client.close();
  } finally {
    console.log('Terminating test Electron process...');
    electronProcess.kill('SIGTERM');
    await sleep(1000);
    try {
      electronProcess.kill('SIGKILL');
    } catch (_) {}
  }
}

main().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
