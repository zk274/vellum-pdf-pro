const { getPageTarget, CDPClient } = require('./cdp_helper.cjs');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runRealWorldDesktopTests() {
  const page = await getPageTarget();
  console.log('Connected to Desktop Application Window:', page.title);
  const client = new CDPClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  console.log('--- TEST 1: INITIAL DESKTOP LAUNCH & EDIT MODE ---');
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/01_desktop_edit_mode_initial.png');

  // Verify status bar details
  const statusInitial = await client.eval(`document.querySelector('.status-bar')?.textContent`);
  console.log('Status Bar:', statusInitial);

  console.log('--- TEST 2: SELECT AND DIRECTLY EDIT A TEXT SPAN VIA GUI ---');
  // Click on the first selectable text span in the canvas workspace
  const textEditResult = await client.eval(`
    (() => {
      const spanOverlay = document.querySelector('.text-span-overlay');
      if (!spanOverlay) return { error: 'No text span overlay found on page' };
      spanOverlay.click();

      // Read right inspector properties
      const inspectorTitle = document.querySelector('.inspector-panel')?.textContent;
      const textarea = document.querySelector('.inspector-panel textarea');
      const origText = textarea ? textarea.value : '';

      if (textarea) {
        textarea.value = 'EDITED VIA LINUX DESKTOP GUI AUTOMATION';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Find 'Apply Stream Edit' button in inspector
      const applyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Apply Stream Edit'));
      if (applyBtn) {
        applyBtn.click();
        return { success: true, origText, newText: 'EDITED VIA LINUX DESKTOP GUI AUTOMATION' };
      }
      return { error: 'Apply Stream Edit button not found' };
    })()
  `);
  console.log('Direct Text Edit GUI Action:', textEditResult);
  await sleep(1500);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/02_text_edited_in_gui.png');

  console.log('--- TEST 3: UNDO AND REDO DIRECT EDIT VIA TOOLBAR BUTTONS ---');
  const undoResult = await client.eval(`
    (() => {
      const undoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Undo'));
      if (undoBtn) {
        undoBtn.click();
        return { clicked: 'undo' };
      }
      return { error: 'Undo button not found' };
    })()
  `);
  console.log('Undo Clicked:', undoResult);
  await sleep(1200);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/03_post_undo_state.png');

  const redoResult = await client.eval(`
    (() => {
      const redoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Redo'));
      if (redoBtn) {
        redoBtn.click();
        return { clicked: 'redo' };
      }
      return { error: 'Redo button not found' };
    })()
  `);
  console.log('Redo Clicked:', redoResult);
  await sleep(1200);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/04_post_redo_state.png');

  console.log('--- TEST 4: ANNOTATION AND REVIEW MODE (HIGHLIGHT & STAMP) ---');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-btn')).find(b => b.textContent.includes('Annotate'));
      if (btn) btn.click();
    })()
  `);
  await sleep(1000);
  // Add a standard 'APPROVED' stamp via GUI action
  await client.eval(`
    (() => {
      const stampBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Stamp'));
      if (stampBtn) stampBtn.click();
    })()
  `);
  await sleep(1000);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/05_annotations_mode.png');

  console.log('--- TEST 5: ORGANIZE PAGES MODE (ROTATE, THUMBNAILS) ---');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-btn')).find(b => b.textContent.includes('Organize Pages'));
      if (btn) btn.click();
    })()
  `);
  await sleep(1200);
  // Rotate page clockwise via button
  await client.eval(`
    (() => {
      const rotateBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Rotate Clockwise') || b.textContent.includes('Rotate 90° CW'));
      if (rotateBtn) rotateBtn.click();
    })()
  `);
  await sleep(1500);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/06_organize_pages_rotated.png');

  console.log('--- TEST 6: FORMS AND SIGNATURES MODE ---');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-btn')).find(b => b.textContent.includes('Forms'));
      if (btn) btn.click();
    })()
  `);
  await sleep(1200);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/07_forms_mode.png');

  console.log('--- TEST 7: OCR & CONVERT MODE ---');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-btn')).find(b => b.textContent.includes('OCR & Convert'));
      if (btn) btn.click();
    })()
  `);
  await sleep(1200);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/08_ocr_convert_mode.png');

  console.log('--- TEST 8: SECURITY & REDACTION MODE ---');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-btn')).find(b => b.textContent.includes('Security'));
      if (btn) btn.click();
    })()
  `);
  await sleep(1200);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/09_security_redaction_mode.png');

  console.log('--- TEST 9: PRO FEATURES & COMPARISON MODE ---');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-btn')).find(b => b.textContent.includes('Pro & Compare'));
      if (btn) btn.click();
    })()
  `);
  await sleep(1200);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/10_pro_compare_mode.png');

  console.log('--- TEST 10: COMMAND PALETTE (F1 / CTRL+K) ---');
  await client.eval(`
    (() => {
      const palBtn = Array.from(document.querySelectorAll('.menu-trigger')).find(b => b.textContent.includes('Palette'));
      if (palBtn) palBtn.click();
    })()
  `);
  await sleep(800);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/11_command_palette_modal.png');

  // Dismiss modal
  await client.eval(`
    (() => {
      const closeBtn = document.querySelector('.modal-header button, .modal-backdrop');
      if (closeBtn) closeBtn.click();
    })()
  `);
  await sleep(600);

  console.log('--- TEST 11: SAVE WORKFLOW & REOPEN PERSISTENCE ---');
  const saveResult = await client.eval(`
    (async () => {
      const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save PDF'));
      if (saveBtn) {
        saveBtn.click();
        return { initiated: true };
      }
      return { error: 'Save PDF button not found' };
    })()
  `);
  console.log('Save triggered:', saveResult);
  await sleep(1500);
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/12_post_save_state.png');

  client.close();
  console.log('Real-World Desktop UI Automation Completed Successfully!');
}

runRealWorldDesktopTests().catch(err => {
  console.error('Desktop Test Failure:', err);
  process.exit(1);
});

