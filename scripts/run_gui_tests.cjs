const { getPageTarget, CDPClient } = require('./cdp_helper.cjs');

async function testGUI() {
  const page = await getPageTarget();
  console.log('Connecting to page:', page.title);
  const client = new CDPClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  // 1. Initial State Screenshot
  console.log('[1/8] Capturing initial application launch screenshot...');
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/01_initial_app_launch.png');

  // Check what's on the screen
  const appHtml = await client.eval(`document.querySelector('.app-shell')?.className || 'no-app-shell'`);
  console.log('App shell class:', appHtml);

  // Check open document tabs
  const tabs = await client.eval(`
    Array.from(document.querySelectorAll('.tab')).map(t => t.textContent.trim())
  `);
  console.log('Active Tabs:', tabs);

  // 2. Open Sample Showcase Document
  console.log('[2/8] Opening Sample Showcase Document in GUI...');
  await client.eval(`
    (async () => {
      // Find and click the 'Open Sample Document' button in empty workspace, or trigger menu action
      const sampleBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Open Sample PDF') || b.textContent.includes('Showcase'));
      if (sampleBtn) {
        sampleBtn.click();
      } else {
        // Fallback to calling openSample directly via api
        const doc = await window.pdfApi.openSample();
        window.dispatchEvent(new CustomEvent('test:open-sample', { detail: doc }));
      }
    })()
  `);

  await new Promise(r => setTimeout(r, 2000));
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/02_sample_showcase_loaded.png');

  // 3. Switch to 'Edit PDF' mode in Toolbar
  console.log('[3/8] Switching to Edit PDF Mode...');
  const editModeClicked = await client.eval(`
    (() => {
      const editBtn = Array.from(document.querySelectorAll('.mode-tab')).find(b => b.textContent.includes('Edit PDF'));
      if (editBtn) {
        editBtn.click();
        return true;
      }
      return false;
    })()
  `);
  console.log('Edit mode button clicked:', editModeClicked);

  await new Promise(r => setTimeout(r, 1500));
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/03_edit_mode_active.png');

  // Inspect page objects in Edit mode
  const spansCount = await client.eval(`
    document.querySelectorAll('.page-canvas-wrapper, .pdf-page-container, canvas').length
  `);
  console.log('Document canvas containers on screen:', spansCount);

  // 4. Test Annotate Mode
  console.log('[4/8] Switching to Annotate Mode...');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-tab')).find(b => b.textContent.includes('Annotate'));
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1200));
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/04_annotate_mode.png');

  // 5. Test Organize Pages Mode
  console.log('[5/8] Switching to Organize Pages Mode...');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-tab')).find(b => b.textContent.includes('Pages'));
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1200));
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/05_pages_mode.png');

  // 6. Test Interactive Forms & Signatures Mode
  console.log('[6/8] Switching to Forms Mode...');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-tab')).find(b => b.textContent.includes('Forms'));
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1200));
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/06_forms_mode.png');

  // 7. Test Security & Redaction Mode
  console.log('[7/8] Switching to Security & Redaction Mode...');
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.mode-tab')).find(b => b.textContent.includes('Security'));
      if (btn) btn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1200));
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/07_security_redaction_mode.png');

  // 8. Test Command Palette
  console.log('[8/8] Opening Command Palette & Shortcuts Modal (F1 / Ctrl+K)...');
  await client.eval(`
    (() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    })()
  `);
  await new Promise(r => setTimeout(r, 800));
  await client.captureScreenshot('/home/zk/workspace/pdfedit/test_screenshots/08_command_palette.png');

  console.log('GUI Automated Tests & Screenshot Captures Completed!');
  client.close();
}

testGUI().catch(err => {
  console.error('Error running testGUI:', err);
  process.exit(1);
});

