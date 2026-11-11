const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const BACKEND_PORT = process.env.VELLUM_PORT || '18420';
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

let mainWindow = null;
let backendProcess = null;

function checkBackendReady() {
  return new Promise((resolve) => {
    const req = http.get(`${BACKEND_URL}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureBackendRunning() {
  const alreadyUp = await checkBackendReady();
  if (alreadyUp) {
    return;
  }

  const appRoot = path.resolve(__dirname, '..');
  const candidates = [
    process.env.VELLUM_PYTHON,
    path.join(appRoot, '.venv', 'bin', 'python'),
    path.join(process.resourcesPath || appRoot, 'venv', 'bin', 'python'),
    path.join(appRoot, 'payload', '.venv', 'bin', 'python'),
    '/opt/vellum-pdf-pro/.venv/bin/python',
    'python3.11',
    'python3',
  ].filter(Boolean);
  const pythonBin = candidates.find((c) => c.startsWith('/') ? fs.existsSync(c) : true) || 'python3';

  backendProcess = spawn(pythonBin, ['-m', 'backend.app'], {
    cwd: appRoot,
    env: {
      ...process.env,
      PYTHONPATH: appRoot,
      VELLUM_PORT: String(BACKEND_PORT),
    },
    stdio: 'pipe',
  });

  backendProcess.stderr.on('data', (chunk) => {
    if (process.env.VELLUM_DEBUG) {
      process.stderr.write(`[Backend] ${chunk}`);
    }
  });

  for (let i = 0; i < 40; i++) {
    const ready = await checkBackendReady();
    if (ready) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

function sendMenuAction(action, payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vellum:menu-action', { action, ...payload });
  }
}

function buildNativeLinuxMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Blank PDF', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new-doc') },
        { label: 'Open PDF...', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open-file') },
        { label: 'Open Sample Showcase PDF', click: () => sendMenuAction('open-sample') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('save-as') },
        { type: 'separator' },
        { label: 'Document Properties...', accelerator: 'CmdOrCtrl+D', click: () => sendMenuAction('doc-properties') },
        { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: () => sendMenuAction('print') },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Vellum PDF Pro', accelerator: 'CmdOrCtrl+Q' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => sendMenuAction('redo') },
        { type: 'separator' },
        { label: 'Edit PDF Content Mode', accelerator: 'CmdOrCtrl+E', click: () => sendMenuAction('set-mode', { mode: 'edit' }) },
        { label: 'Find in Document...', accelerator: 'CmdOrCtrl+F', click: () => sendMenuAction('focus-search') },
        { label: 'Command Palette...', accelerator: 'CmdOrCtrl+K', click: () => sendMenuAction('command-palette') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => sendMenuAction('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => sendMenuAction('zoom-out') },
        { label: 'Actual Size (100%)', accelerator: 'CmdOrCtrl+0', click: () => sendMenuAction('zoom-reset') },
        { type: 'separator' },
        { label: 'Toggle Left Sidebar', accelerator: 'F9', click: () => sendMenuAction('toggle-left-sidebar') },
        { label: 'Toggle Right Inspector', accelerator: 'F10', click: () => sendMenuAction('toggle-right-panel') },
        { label: 'Toggle Dark / Light Theme', accelerator: 'CmdOrCtrl+Shift+T', click: () => sendMenuAction('toggle-theme') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Document',
      submenu: [
        { label: 'Organize Pages', click: () => sendMenuAction('set-mode', { mode: 'pages' }) },
        { label: 'Insert Blank Page', click: () => sendMenuAction('insert-blank-page') },
        { label: 'Rotate Page Clockwise', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendMenuAction('rotate-page-cw') },
        { label: 'Crop Page', click: () => sendMenuAction('set-mode', { mode: 'pages' }) },
        { type: 'separator' },
        { label: 'Headers & Footers...', click: () => sendMenuAction('set-mode', { mode: 'pro' }) },
        { label: 'Watermark...', click: () => sendMenuAction('set-mode', { mode: 'pro' }) },
        { label: 'Bates Numbering...', click: () => sendMenuAction('set-mode', { mode: 'pro' }) },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Annotate & Markup', click: () => sendMenuAction('set-mode', { mode: 'annotate' }) },
        { label: 'Forms & AcroForm Designer', click: () => sendMenuAction('set-mode', { mode: 'forms' }) },
        { label: 'Digital Signatures & X.509 Certs', click: () => sendMenuAction('set-mode', { mode: 'sign' }) },
        { label: 'OCR & Convert Documents', click: () => sendMenuAction('set-mode', { mode: 'ocr' }) },
        { label: 'Security, Encryption & Redaction', click: () => sendMenuAction('set-mode', { mode: 'security' }) },
        { label: 'Compare Two PDFs & Preflight', click: () => sendMenuAction('set-mode', { mode: 'pro' }) },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Next Document Tab', accelerator: 'CmdOrCtrl+Tab', click: () => sendMenuAction('next-tab') },
        { label: 'Close Current Tab', accelerator: 'CmdOrCtrl+W', click: () => sendMenuAction('close-tab') },
        { type: 'separator' },
        { role: 'minimize' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Command Palette & Shortcuts', accelerator: 'F1', click: () => sendMenuAction('command-palette') },
        { label: 'Crash Recovery Manager', click: () => sendMenuAction('open-recovery') },
        { label: 'About Vellum PDF Pro', click: () => sendMenuAction('about') },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  await ensureBackendRunning();
  buildNativeLinuxMenu();

  mainWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    title: 'Vellum PDF Pro — Linux Desktop PDF Editor',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else if (fs.existsSync(distIndex)) {
    await mainWindow.loadFile(distIndex);
  } else {
    await mainWindow.loadURL('http://127.0.0.1:5173');
  }

  // If a PDF file path was passed via CLI arguments, instruct renderer to open it
  const cliPdfArg = process.argv.slice(1).find((arg) => arg.toLowerCase().endsWith('.pdf') && fs.existsSync(arg));
  if (cliPdfArg) {
    mainWindow.webContents.once('did-finish-load', () => {
      sendMenuAction('open-cli-path', { filePath: path.resolve(cliPdfArg) });
    });
  }
}

ipcMain.handle('vellum:get-backend-url', () => BACKEND_URL);

ipcMain.handle('vellum:open-file-dialog', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF Document',
    properties: ['openFile'],
    filters: [
      { name: 'PDF Documents', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('vellum:save-file-dialog', async (_event, defaultFilename) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF Document As',
    defaultPath: defaultFilename || 'Document.pdf',
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('vellum:print-document', async () => {
  if (!mainWindow) return { printed: false };
  mainWindow.webContents.print({ silent: false, printBackground: true });
  return { printed: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
});

