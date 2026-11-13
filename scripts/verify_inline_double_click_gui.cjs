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
  const cdpPort = 9251;
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
    assert(target, 'Could not connect to packaged AppImage CDP target');

    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();

    // 1. Wait for offline backend
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

    // 3. Single-click a span -> selection frame + 8 handles, no inline editor
    const spanRect = await client.eval(`
      (() => {
        const spans = Array.from(document.querySelectorAll('.span-box'));
        const sp = spans.find(el => (el.getAttribute('title') || '').includes('Annual license fee')) || spans[0];
        if (!sp) return null;
        const r = sp.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: sp.getAttribute('title') };
      })()
    `);
    assert(spanRect, 'Could not locate target .span-box');
    await client.mouseClick(spanRect.x, spanRect.y, 1);
    await sleep(300);

    const selectionInfo = await client.eval(`
      (() => ({
        hasFrame: Boolean(document.querySelector('.object-selection-frame')),
        handleCount: document.querySelectorAll('.object-selection-frame .resize-handle').length,
        hasInlineEditor: Boolean(document.querySelector('.inline-paragraph-overlay')),
      }))()
    `);
    assert(selectionInfo.hasFrame && selectionInfo.handleCount === 8, 'Single-click must show selection frame with 8 handles');
    assert(!selectionInfo.hasInlineEditor, 'Single-click must not open inline editor');
    console.log('1) Single-click selection verified (8 handles, no inline editor)');

    // 4. Double-clicking resize handle, image box, and blank page area must NOT open inline editor
    const handlePos = await client.eval(`
      (() => {
        const h = document.querySelector('.object-selection-frame .handle-se');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    assert(handlePos, 'Resize handle missing');
    await client.doubleClick(handlePos.x, handlePos.y);
    await sleep(200);
    assert(!(await client.eval(`Boolean(document.querySelector('.inline-paragraph-overlay'))`)), 'Double-clicking resize handle must NOT open editor');

    const imgPos = await client.eval(`
      (() => {
        const im = document.querySelector('.image-box');
        if (!im) return null;
        const r = im.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    if (imgPos) {
      await client.doubleClick(imgPos.x, imgPos.y);
      await sleep(200);
      assert(!(await client.eval(`Boolean(document.querySelector('.inline-paragraph-overlay'))`)), 'Double-clicking image must NOT open editor');
    }

    const blankPos = await client.eval(`
      (() => {
        const c = document.querySelector('.pdf-page-stage');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.left + 20, y: r.bottom - 20 };
      })()
    `);
    await client.doubleClick(blankPos.x, blankPos.y);
    await sleep(200);
    assert(!(await client.eval(`Boolean(document.querySelector('.inline-paragraph-overlay'))`)), 'Double-clicking blank page must NOT open editor');
    console.log('2) Non-text double-click guards verified (resize handle, image, blank page)');

    // 5. Double-click selected span (hits .object-selection-body) -> opens inline editor!
    await client.mouseClick(spanRect.x, spanRect.y, 1);
    await sleep(200);
    await client.doubleClick(spanRect.x, spanRect.y);
    await sleep(300);

    const openState = await client.eval(`
      (() => {
        const overlay = document.querySelector('.inline-paragraph-overlay');
        const ta = document.querySelector('.inline-paragraph-input');
        const saveBtn = Array.from(document.querySelectorAll('.inline-paragraph-floating-toolbar button')).find(b => b.textContent.includes('Save'));
        const cancelBtn = Array.from(document.querySelectorAll('.inline-paragraph-floating-toolbar button')).find(b => b.textContent.includes('Cancel'));
        return {
          opened: Boolean(overlay && ta),
          hasSave: Boolean(saveBtn),
          hasCancel: Boolean(cancelBtn),
          text: ta ? ta.value : '',
        };
      })()
    `);
    assert(openState.opened && openState.hasSave && openState.hasCancel, 'Double-click on selected span must open inline editor with Save/Cancel');
    console.log('3) Double-click on selected span opened inline editor:', openState.text);

    // 6. Escape cancels without modifying document
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(250);
    assert(!(await client.eval(`Boolean(document.querySelector('.inline-paragraph-overlay'))`)), 'Escape must close inline editor');
    const undoAfterCancel = await client.eval(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Undo'))?.textContent || ''
    `);
    assert(undoAfterCancel.includes('Undo (0)'), `Cancel must leave Undo (0), got ${undoAfterCancel}`);
    console.log('4) Escape cancel verified without modifying document');

    // 7. Zoom In (Ctrl+=) -> 135% and double-click span to create a 2-line reflowed paragraph, then double-click the multiline paragraph
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: '=',
      code: 'Equal',
      windowsVirtualKeyCode: 187,
      modifiers: 2,
    });
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: '=',
      code: 'Equal',
      windowsVirtualKeyCode: 187,
      modifiers: 2,
    });
    await sleep(350);

    const headerSpanPos = await client.eval(`
      (() => {
        const spans = Array.from(document.querySelectorAll('.span-box'));
        const sp = spans.find(el => (el.getAttribute('title') || '').includes('MASTER SOFTWARE SERVICES'));
        if (!sp) return null;
        sp.scrollIntoView({ block: 'center' });
        const r = sp.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    assert(headerSpanPos, 'Could not locate header span');
    await client.doubleClick(headerSpanPos.x, headerSpanPos.y);
    await sleep(350);

    // Edit to longer text that triggers overflow, then resolve via Fit Font to create a 2-line paragraph
    await client.eval(`
      (() => {
        const ta = document.querySelector('.inline-paragraph-input');
        if (!ta) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, 'MASTER SOFTWARE SERVICES AGREEMENT Enterprise Linux Edition');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await sleep(150);
    await client.eval(`
      Array.from(document.querySelectorAll('.inline-paragraph-floating-toolbar button')).find(b => b.textContent.includes('Save'))?.click()
    `);
    await sleep(600);
    const fitBtnClicked = await client.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('.paragraph-overflow-actions button')).find(b => b.textContent.includes('Fit Font'));
        if (btn) { btn.click(); return true; }
        return false;
      })()
    `);
    assert(fitBtnClicked, 'Expected Fit Font overflow resolution button');
    await sleep(900);

    // Now double-click one line of the 2-line reflowed paragraph and verify the ENTIRE multiline paragraph loads!
    const multiSpanPos = await client.eval(`
      (() => {
        const spans = Array.from(document.querySelectorAll('.span-box'));
        const sp = spans.find(el => (el.getAttribute('title') || '').includes('MASTER SOFTWARE SERVICES'));
        if (!sp) return null;
        sp.scrollIntoView({ block: 'center' });
        const r = sp.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    assert(multiSpanPos, 'Could not locate reflowed multiline paragraph span');
    await client.doubleClick(multiSpanPos.x, multiSpanPos.y);
    await sleep(400);

    const multiInfo = await client.eval(`
      (() => {
        const ta = document.querySelector('.inline-paragraph-input');
        const inspTa = document.querySelector('.inspector-section textarea');
        return {
          text: ta ? ta.value : '',
          inspText: inspTa ? inspTa.value : '',
          zoomText: document.querySelector('.status-bar')?.textContent || '',
        };
      })()
    `);
    assert(multiInfo.zoomText.includes('135%'), `Expected zoom 135%, got: ${multiInfo.zoomText}`);
    assert(
      multiInfo.text.includes('MASTER SOFTWARE SERVICES') && multiInfo.text.includes('Enterprise Linux Edition'),
      `Multiline paragraph must load full paragraph text, got: ${JSON.stringify(multiInfo)}`
    );
    assert(multiInfo.text === multiInfo.inspText, 'Inline editor and Properties Inspector must stay synchronized');

    await client.screenshot(path.resolve(__dirname, '../docs/screenshots/inline-edit-dark-zoomed.png'));
    console.log('5) Zoomed (135%) multiline paragraph double-click & inspector sync verified');

    // 8. Keyboard editing (click inside textarea, End, Backspace 7 chars, type 'OS.') and Ctrl+Enter save
    await client.send('Page.bringToFront');
    const taPos = await client.eval(`
      (() => {
        const ta = document.querySelector('.inline-paragraph-input');
        if (!ta) return null;
        const r = ta.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    await client.mouseClick(taPos.x, taPos.y, 1);
    await sleep(100);
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
    for (let i = 0; i < 7; i++) {
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    }
    for (const ch of 'OS.') {
      await client.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    }
    await sleep(200);

    const syncedAfterType = await client.eval(`
      (() => {
        const ta = document.querySelector('.inline-paragraph-input');
        const inspTa = document.querySelector('.inspector-section textarea');
        return {
          match: ta?.value === inspTa?.value && ta?.value.endsWith('OS.'),
          taVal: ta?.value,
          inspVal: inspTa?.value,
        };
      })()
    `);
    assert(syncedAfterType.match, `Keyboard typing must update both inline editor and Properties Inspector, got: ${JSON.stringify(syncedAfterType)}`);

    // Commit via Ctrl+Enter
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      modifiers: 2,
    });
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      modifiers: 2,
    });
    await sleep(1000);

    const afterCommit = await client.eval(`
      (() => ({
        closed: !document.querySelector('.inline-paragraph-overlay'),
        undoText: Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Undo'))?.textContent || '',
        hasOSSpan: Array.from(document.querySelectorAll('.span-box')).some(el => (el.getAttribute('title') || '').includes('OS.')),
      }))()
    `);
    assert(afterCommit.closed && afterCommit.undoText.includes('Undo (2)') && afterCommit.hasOSSpan, `Ctrl+Enter must save edit and increment Undo, got: ${JSON.stringify(afterCommit)}`);
    console.log('6) Keyboard edit + Ctrl+Enter commit verified');

    // 9. Undo & Redo
    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Undo ('))?.click()`);
    await sleep(800);
    const afterUndo = await client.eval(`
      Array.from(document.querySelectorAll('.span-box')).some(el => (el.getAttribute('title') || '').includes('OS.'))
    `);
    assert(!afterUndo, 'Undo must revert inline edit');

    await client.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Redo ('))?.click()`);
    await sleep(800);
    const afterRedo = await client.eval(`
      Array.from(document.querySelectorAll('.span-box')).some(el => (el.getAttribute('title') || '').includes('OS.'))
    `);
    assert(afterRedo, 'Redo must restore inline edit');
    console.log('7) Undo & Redo verified');

    // 10. Light Theme check + screenshot
    await client.eval(`
      (() => {
        const themeBtn = document.querySelector('button[title*="Theme"], button[title*="theme"], .theme-toggle-btn');
        if (themeBtn) themeBtn.click();
      })()
    `);
    await sleep(350);

    const lightSpanPos = await client.eval(`
      (() => {
        const spans = Array.from(document.querySelectorAll('.span-box'));
        const sp = spans.find(el => (el.getAttribute('title') || '').includes('Annual license fee'));
        if (!sp) return null;
        sp.scrollIntoView({ block: 'center' });
        const r = sp.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()
    `);
    assert(lightSpanPos, 'Could not locate span for light theme check');
    await client.doubleClick(lightSpanPos.x, lightSpanPos.y);
    await sleep(350);
    await client.screenshot(path.resolve(__dirname, '../docs/screenshots/inline-edit-light.png'));

    // Replace with shorter text & Save via Save button
    await client.eval(`
      (() => {
        const ta = document.querySelector('.inline-paragraph-input');
        if (!ta) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, 'Annual fee: $48,500.00 USD');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await sleep(150);
    await client.eval(`
      Array.from(document.querySelectorAll('.inline-paragraph-floating-toolbar button')).find(b => b.textContent.includes('Save'))?.click()
    `);
    await sleep(900);
    console.log('8) Light theme inline edit + Save button verified');

    // 11. Save PDF to disk, close doc, & Reopen from disk to verify persisted bytes
    const persisted = await client.eval(`
      (async () => {
        const docs = await fetch('http://127.0.0.1:18420/api/docs').then(r => r.json());
        const targetDoc = docs.find(d => d.undo_count > 0) || docs[docs.length - 1];
        const docId = targetDoc.doc_id;
        const outPath = '/tmp/vellum-inline-verify.pdf';
        const saveRes = await fetch('http://127.0.0.1:18420/api/docs/' + docId + '/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_path: outPath }),
        });
        if (!saveRes.ok) throw new Error('Save failed: ' + saveRes.status + ' ' + await saveRes.text());
        await fetch('http://127.0.0.1:18420/api/docs/' + docId, { method: 'DELETE' });
        const reopenRes = await fetch('http://127.0.0.1:18420/api/docs/open-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_path: outPath }),
        });
        if (!reopenRes.ok) throw new Error('Reopen failed: ' + reopenRes.status + ' ' + await reopenRes.text());
        const uploaded = await reopenRes.json();
        const objs = await fetch('http://127.0.0.1:18420/api/docs/' + uploaded.doc_id + '/pages/0/objects').then(r => r.json());
        const allText = objs.text_spans.map(s => s.text).join(' ');
        const hasLink = (objs.links || objs.hyperlinks || []).some(h => (h.uri || '').includes('specifications.vellumpdf.linux'));
        return {
          docId: uploaded.doc_id,
          hasOS: allText.includes('Enterprise Linux OS.'),
          hasAnnualFee: allText.includes('Annual fee: $48,500.00 USD'),
          hasLink,
        };
      })()
    `);
    assert(
      persisted.hasOS && persisted.hasAnnualFee && persisted.hasLink,
      `Exported & reopened PDF missing edits or hyperlink: ${JSON.stringify(persisted)}`
    );
    console.log('9) Save, close, reopen & hyperlink preservation verified:', persisted);

    // 12. Rotate page 90 deg via backend and verify rotated-page inline edit + readback
    const rotatedCheck = await client.eval(`
      (async () => {
        const docId = ${JSON.stringify(persisted.docId)};
        await fetch('http://127.0.0.1:18420/api/docs/' + docId + '/pages/rotate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_indices: [0], angle: 90 }),
        });
        const objs = await fetch('http://127.0.0.1:18420/api/docs/' + docId + '/pages/0/objects').then(r => r.json());
        const blk = objs.text_blocks.find(b => b.text.includes('Annual fee:'));
        if (!blk) return { ok: false, reason: 'block not found after rotate' };
        const res = await fetch('http://127.0.0.1:18420/api/docs/' + docId + '/pages/0/edit-paragraph', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            block_id: blk.id,
            orig_bbox: blk.bbox,
            expected_orig_text: blk.text,
            new_text: 'Rotated Fee: $48,500 USD',
            target_bbox: blk.bbox,
            font_name: blk.dominant_font || 'helv',
            font_size: blk.dominant_size || 10,
            color_hex: blk.dominant_color || '#000000',
            bold: Boolean(blk.bold),
            italic: Boolean(blk.italic),
            align: blk.align || 'left',
            line_height: blk.line_height || 1.25,
            keep_original_font: true,
            overflow_policy: 'check',
          }),
        }).then(r => r.json());
        const objsAfter = await fetch('http://127.0.0.1:18420/api/docs/' + docId + '/pages/0/objects').then(r => r.json());
        return {
          status: res.status,
          hasRotatedEdit: objsAfter.text_spans.some(s => s.text.includes('Rotated Fee: $48,500 USD')),
        };
      })()
    `);
    assert(rotatedCheck.status === 'ok' && rotatedCheck.hasRotatedEdit, `Rotated page edit failed: ${JSON.stringify(rotatedCheck)}`);
    console.log('10) 90° rotated page inline edit verified:', rotatedCheck);

    console.log('ALL packaged AppImage double-click inline editing tests PASSED!');
    client.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

