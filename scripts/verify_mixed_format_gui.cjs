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

  async mouseClick(x, y, clickCount = 1) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      clickCount: 0,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount,
    });
  }

  async doubleClick(x, y) {
    await this.mouseClick(x, y, 1);
    await sleep(40);
    await this.mouseClick(x, y, 2);
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
  const cdpPort = 9255;
  const appImagePath = path.resolve(__dirname, '../release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage');
  const screenshotsDir = path.resolve(__dirname, '../docs/screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

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
    assert(target, 'Could not connect to packaged AppImage CDP target');

    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();

    // 1. Wait for Ready (Offline)
    let isReady = false;
    for (let i = 0; i < 40; i++) {
      const statusText = await client.eval(`document.querySelector('.status-bar')?.textContent || ''`);
      if (statusText.includes('Ready (Offline)')) {
        isReady = true;
        console.log('Packaged backend ready:', statusText.trim());
        break;
      }
      await sleep(500);
    }
    assert(isReady, 'Backend did not reach Ready (Offline)');

    // 2. Open Sample MSA & enter Edit PDF mode
    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sample MSA'));
        if (btn) btn.click();
      })()
    `);
    await sleep(1500);

    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Edit PDF'));
        if (btn) btn.click();
      })()
    `);
    await sleep(800);

    // 3. Single-click span -> verify selection frame & 8 resize handles
    const spanRect = await client.eval(`
      (() => {
        const spans = Array.from(document.querySelectorAll('.span-box'));
        const sp = spans.find(el => (el.getAttribute('title') || '').includes('Annual license fee')) || spans[0];
        if (!sp) return null;
        const r = sp.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    assert(spanRect, 'Could not locate a span-box on page');
    await client.mouseClick(spanRect.x, spanRect.y, 1);
    await sleep(300);

    const handleCount = await client.eval(`document.querySelectorAll('.object-selection-frame .resize-handle').length`);
    assert(handleCount === 8, `Expected 8 resize handles on single-click, got ${handleCount}`);
    const overlayAfterSingle = await client.eval(`!!document.querySelector('.inline-paragraph-overlay')`);
    assert(!overlayAfterSingle, 'Single-click must not open inline paragraph editor');
    console.log('Verified single-click selection with 8 resize handles.');

    // 4. Switch to Edit Paragraph tool and click a multi-line paragraph to open rich inline editor
    await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Edit Paragraph'));
        if (btn) btn.click();
      })()
    `);
    await sleep(500);

    const paraClicked = await client.eval(`
      (() => {
        const boxes = Array.from(document.querySelectorAll('.paragraph-box-overlay'));
        boxes.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
        const target = boxes[0];
        if (!target) return false;
        target.scrollIntoView({ block: 'center', inline: 'center' });
        target.click();
        return true;
      })()
    `);
    assert(paraClicked, 'Could not find and click a paragraph-box-overlay');
    await sleep(500);

    const richState = await client.eval(`
      (() => {
        const ov = document.querySelector('.inline-paragraph-overlay');
        const rt = document.querySelector('.inline-paragraph-richtext');
        return { hasOverlay: !!ov, hasRichText: !!rt, isCE: !!rt?.isContentEditable, attr: rt?.getAttribute('contenteditable') };
      })()
    `);
    console.log('Rich editor state:', JSON.stringify(richState));
    assert(richState.hasOverlay && richState.hasRichText && richState.isCE, 'Expected contentEditable rich inline paragraph editor');
    console.log('Opened rich inline paragraph editor.');

    // 5. Select a range of characters inside .inline-paragraph-richtext and apply Bold + Red Color + Size 13
    const selResult = await client.eval(`
      (() => {
        const el = document.querySelector('.inline-paragraph-richtext');
        if (!el) return null;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (!textNode || textNode.textContent.length < 12) return null;
        const range = document.createRange();
        range.setStart(textNode, 3);
        range.setEnd(textNode, 11);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return { selected: sel.toString(), full: el.textContent };
      })()
    `);
    assert(selResult && selResult.selected.length === 8, `Expected 8 selected chars, got ${JSON.stringify(selResult)}`);
    await sleep(250);

    // Verify Inspector selection badge
    const badgeVisible = await client.eval(`document.body.textContent.includes('Selection (8 chars)')`);
    assert(badgeVisible, 'Expected Inspector selection badge for 8 chars');

    // Click Bold button and set color to #d92626
    await client.eval(`
      (() => {
        const boldBtn = document.querySelector('.inline-paragraph-floating-toolbar .rich-fmt-btn[title*="Bold"]');
        if (boldBtn) boldBtn.click();
      })()
    `);
    await sleep(200);

    await client.eval(`
      (() => {
        const colorInput = document.querySelector('.inline-paragraph-floating-toolbar .rich-fmt-color');
        if (colorInput) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(colorInput, '#d92626');
          colorInput.dispatchEvent(new Event('input', { bubbles: true }));
          colorInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await sleep(300);

    // Verify styled span exists without changing surrounding spans
    const spanStats = await client.eval(`
      (() => {
        const spans = Array.from(document.querySelectorAll('.inline-paragraph-richtext span'));
        return spans.map(s => ({
          text: s.textContent,
          weight: s.style.fontWeight,
          color: s.style.color,
        }));
      })()
    `);
    console.log('Rich editor spans:', JSON.stringify(spanStats));
    assert(
      spanStats.length === 3 &&
        spanStats[0].weight === '700' &&
        spanStats[1].weight === '400' &&
        spanStats[1].color.includes('217, 38, 38') &&
        spanStats[2].weight === '700' &&
        spanStats[0].color === spanStats[2].color,
      `Expected middle selected span to toggle bold/color without modifying surrounding runs, got ${JSON.stringify(spanStats)}`
    );

    // 6. Set zoom to 115% and capture Dark Theme 115% screenshot
    await client.eval(`
      (() => {
        const select = document.querySelector('.zoom-select, select[title*="Zoom"]');
        if (select) {
          select.value = '1.15';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await sleep(500);
    await client.screenshot(path.join(screenshotsDir, 'mixed-format-dark-115.png'));

    // 7. Zoom to 150% and capture Dark Theme 150% screenshot
    await client.eval(`
      (() => {
        const select = document.querySelector('.zoom-select, select[title*="Zoom"]');
        if (select) {
          select.value = '1.5';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await sleep(500);
    await client.screenshot(path.join(screenshotsDir, 'mixed-format-dark-150.png'));

    // 8. Toggle Light theme at 150% zoom and capture screenshot
    await client.eval(`
      (() => {
        const themeBtn = document.querySelector('button[title*="theme" i], button[title*="Light" i], button[title*="Dark" i]');
        if (themeBtn) themeBtn.click();
      })()
    `);
    await sleep(500);
    await client.screenshot(path.join(screenshotsDir, 'mixed-format-light-150.png'));

    // 9. Commit edit via Save button (if overflow banner appears, approve Expand Box), then test Undo / Redo
    await client.eval(`
      (() => {
        const saveBtn = document.querySelector('.inline-paragraph-floating-toolbar .mini-btn.apply');
        if (saveBtn) saveBtn.click();
      })()
    `);
    await sleep(1200);

    const expandedIfOverflow = await client.eval(`
      (() => {
        const expandBtn = Array.from(document.querySelectorAll('.paragraph-overflow-actions .mini-btn.apply'))
          .find(b => b.textContent.includes('Expand Box') || b.textContent.includes('Fit Font'));
        if (expandBtn) {
          expandBtn.click();
          return true;
        }
        return false;
      })()
    `);
    if (expandedIfOverflow) {
      console.log('Handled overflow prompt via Expand Box / Fit Font.');
      await sleep(1200);
    }

    const overlayClosed = await client.eval(`!document.querySelector('.inline-paragraph-overlay')`);
    assert(overlayClosed, 'Inline paragraph overlay should close after Save');

    // Verify Undo & Redo buttons are enabled and work
    const undoOk = await client.eval(`
      (() => {
        const undoBtn = document.querySelector('button[title*="Undo"]');
        if (!undoBtn || undoBtn.disabled) return false;
        undoBtn.click();
        return true;
      })()
    `);
    assert(undoOk, 'Undo button should be enabled after paragraph commit');
    await sleep(800);

    const redoOk = await client.eval(`
      (() => {
        const redoBtn = document.querySelector('button[title*="Redo"]');
        if (!redoBtn || redoBtn.disabled) return false;
        redoBtn.click();
        return true;
      })()
    `);
    assert(redoOk, 'Redo button should be enabled after Undo');
    await sleep(800);

    console.log('ALL MIXED-FORMAT GUI CHECKS PASSED!');
    client.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

