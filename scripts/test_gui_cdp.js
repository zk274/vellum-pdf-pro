import fs from 'fs';
import http from 'http';
import WebSocket from 'ws';

function getPageTarget() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
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
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async captureScreenshot(filepath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filepath, Buffer.from(res.data, 'base64'));
    console.log(`Saved screenshot: ${filepath}`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  const page = await getPageTarget();
  console.log('Connecting to page:', page.title, page.webSocketDebuggerUrl);
  const client = new CDPClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  // 1. Initial State Screenshot
  console.log('[Step 1] Capturing initial application interface...');
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/01_initial_app_launch.png');

  // Verify page document state
  const title = await client.eval('document.title');
  console.log('App Window Document Title:', title);

  const initialOpenDocs = await client.eval(`
    Array.from(document.querySelectorAll('.tab')).map(t => t.textContent.trim())
  `);
  console.log('Open Document Tabs:', initialOpenDocs);

  // 2. Open Representative Document 1: 01_showcase_full.pdf via Native/API bridge
  console.log('[Step 2] Opening representative showcase PDF via UI bridge...');
  const openResult = await client.eval(`
    (async () => {
      const res = await window.pdfApi.openByPath('/home/zk/workspace/pdfedit/test_docs/01_showcase_full.pdf');
      // Trigger App's open handler directly
      window.dispatchEvent(new CustomEvent('vellum:open-doc', { detail: res }));
      return res;
    })()
  `);
  console.log('Opened doc_id:', openResult.doc_id, 'filename:', openResult.filename, 'page_count:', openResult.page_count);

  // Inject doc into App state by clicking Open File or simulating tab selection
  await client.eval(`
    (async () => {
      // Fetch open session summary
      const summary = await window.pdfApi.getDocument('${openResult.doc_id}');
      // Trigger native open-cli-path through menu action simulation
      // In App.tsx, window.vellumDesktop.onMenuAction handles 'open-cli-path'
      window.__simulateMenuAction?.({ action: 'open-cli-path', filePath: '/home/zk/workspace/pdfedit/test_docs/01_showcase_full.pdf' });
    })()
  `);

  // Wait 1.5 seconds for canvas rendering
  await new Promise(r => setTimeout(r, 1500));
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/02_showcase_opened.png');

  client.close();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

