const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');

let BACKEND_PORT = parseInt(process.env.VELLUM_PORT || '18420', 10);
let BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

let mainWindow = null;
let backendProcess = null;
const recentBackendLogs = [];

const backendState = {
  started: false,
  ready: false,
  port: BACKEND_PORT,
  pid: null,
  exitCode: null,
  error: null,
};

function addBackendLog(line) {
  const entry = `[${new Date().toISOString()}] ${line}`;
  recentBackendLogs.push(entry);
  if (recentBackendLogs.length > 120) {
    recentBackendLogs.shift();
  }
  if (process.env.VELLUM_DEBUG || process.env.NODE_ENV === 'development') {
    process.stderr.write(`[Backend] ${line}\n`);
  }
}

function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function findFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.listen(0, host);
  });
}

async function resolveBackendPort() {
  if (process.env.VELLUM_PORT) {
    BACKEND_PORT = parseInt(process.env.VELLUM_PORT, 10);
  } else {
    const defaultAvailable = await isPortAvailable(18420);
    if (defaultAvailable) {
      BACKEND_PORT = 18420;
    } else {
      // If 18420 is taken, check if it's already an active Vellum backend
      const alreadyHealthy = await checkBackendReady(`http://127.0.0.1:18420`);
      if (alreadyHealthy) {
        // Multiple instances should isolate if possible, find dedicated port
        BACKEND_PORT = await findFreePort();
      } else {
        BACKEND_PORT = await findFreePort();
      }
    }
  }
  BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
  backendState.port = BACKEND_PORT;
  addBackendLog(`Resolved backend port: ${BACKEND_PORT} (URL: ${BACKEND_URL})`);
  return BACKEND_PORT;
}

function checkBackendReady(url = BACKEND_URL) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function terminateBackendProcess() {
  if (backendProcess) {
    const pid = backendProcess.pid;
    addBackendLog(`Terminating backend process PID ${pid}...`);
    try {
      backendProcess.kill('SIGTERM');
    } catch (err) {
      addBackendLog(`SIGTERM error: ${err.message}`);
    }
    setTimeout(() => {
      if (pid) {
        try {
          process.kill(pid, 0);
          process.kill(pid, 'SIGKILL');
          addBackendLog(`Sent SIGKILL to backend PID ${pid}`);
        } catch {}
      }
    }, 1500);
    backendProcess = null;
  }
}

async function ensureBackendRunning() {
  await resolveBackendPort();

  const alreadyUp = await checkBackendReady();
  if (alreadyUp) {
    addBackendLog(`Backend is already answering healthy on ${BACKEND_URL}`);
    backendState.started = true;
    backendState.ready = true;
    backendState.error = null;
    return true;
  }

  const appRoot = path.resolve(__dirname, '..');
  const candidates = [
    process.env.VELLUM_PYTHON,
    path.join(appRoot, '..', 'python', 'bin', 'python3.11'),
    path.join(appRoot, 'python', 'bin', 'python3.11'),
    path.join(appRoot, '.venv', 'bin', 'python'),
    path.join(process.resourcesPath || appRoot, 'venv', 'bin', 'python'),
    path.join(appRoot, 'payload', '.venv', 'bin', 'python'),
    '/opt/vellum-pdf-pro/payload/python/bin/python3.11',
    '/opt/vellum-pdf-pro/.venv/bin/python',
    'python3.11',
    'python3',
  ].filter(Boolean);

  const pythonBin = candidates.find((c) => (c.startsWith('/') ? fs.existsSync(c) : true)) || 'python3';
  addBackendLog(`Selected Python executable: ${pythonBin}`);

  const extraPaths = [
    appRoot,
    process.env.PYTHONPATH,
    path.join(path.dirname(pythonBin), '..', 'lib', 'python3.11', 'site-packages'),
    path.join(appRoot, '..', 'python', 'lib', 'python3.11', 'site-packages'),
    '/opt/vellum-pdf-pro/payload/app',
    '/opt/vellum-pdf-pro/payload/python/lib/python3.11/site-packages',
  ].filter(Boolean);

  const pythonPath = extraPaths.join(':');

  const ldPaths = [
    path.join(path.dirname(pythonBin), '..', 'lib'),
    '/opt/vellum-pdf-pro/payload/python/lib',
    process.env.LD_LIBRARY_PATH,
  ].filter(Boolean).join(':');

  backendState.exitCode = null;
  backendState.error = null;
  backendState.started = true;

  try {
    backendProcess = spawn(pythonBin, ['-m', 'backend.app', '--port', String(BACKEND_PORT)], {
      cwd: appRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath,
        LD_LIBRARY_PATH: ldPaths,
        VELLUM_PORT: String(BACKEND_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendState.pid = backendProcess.pid;
    addBackendLog(`Spawned backend process PID ${backendProcess.pid} on port ${BACKEND_PORT}`);
  } catch (spawnErr) {
    backendState.error = `Failed to spawn Python process (${pythonBin}): ${spawnErr.message}`;
    addBackendLog(backendState.error);
    return false;
  }

  backendProcess.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) addBackendLog(`[stdout] ${line.trim()}`);
    }
  });

  backendProcess.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) addBackendLog(`[stderr] ${line.trim()}`);
    }
  });

  backendProcess.on('exit', (code, signal) => {
    backendState.ready = false;
    backendState.exitCode = code;
    backendState.error = `Backend process exited with code ${code} (signal: ${signal})`;
    addBackendLog(backendState.error);
    backendProcess = null;
  });

  // Poll health endpoint for up to 45 seconds (180 iterations * 250ms)
  const maxAttempts = 180;
  for (let i = 0; i < maxAttempts; i++) {
    if (backendState.exitCode !== null) {
      addBackendLog(`Aborting startup wait: backend exited prematurely (code ${backendState.exitCode})`);
      return false;
    }
    const ready = await checkBackendReady();
    if (ready) {
      backendState.ready = true;
      backendState.error = null;
      addBackendLog(`Backend successfully initialized and healthy on ${BACKEND_URL}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  backendState.error = `Backend health check timed out after 45 seconds on ${BACKEND_URL}`;
  addBackendLog(backendState.error);
  return false;
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
        { label: 'Retry Backend Connection', click: () => sendMenuAction('retry-backend') },
        {
          label: 'Restart Backend Engine',
          click: async () => {
            terminateBackendProcess();
            await ensureBackendRunning();
            sendMenuAction('retry-backend');
          },
        },
        { type: 'separator' },
        { label: 'About Vellum PDF Pro', click: () => sendMenuAction('about') },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
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

  // Ensure backend is running in parallel or before initial user document operations
  ensureBackendRunning().then((ready) => {
    if (!ready && backendState.error && mainWindow && !mainWindow.isDestroyed()) {
      addBackendLog(`Notifying window of backend startup error: ${backendState.error}`);
      sendMenuAction('backend-error', { error: backendState.error, logs: recentBackendLogs.slice(-20) });
    }
  });

  // If a PDF file path was passed via CLI arguments, instruct renderer to open it
  const cliPdfArg = process.argv.slice(1).find((arg) => arg.toLowerCase().endsWith('.pdf') && fs.existsSync(arg));
  if (cliPdfArg) {
    mainWindow.webContents.once('did-finish-load', () => {
      sendMenuAction('open-cli-path', { filePath: path.resolve(cliPdfArg) });
    });
  }
}

ipcMain.handle('vellum:get-backend-url', () => BACKEND_URL);

ipcMain.handle('vellum:get-backend-status', () => ({
  ...backendState,
  url: BACKEND_URL,
  port: BACKEND_PORT,
  logs: recentBackendLogs.slice(-40),
}));

ipcMain.handle('vellum:restart-backend', async () => {
  terminateBackendProcess();
  const ready = await ensureBackendRunning();
  return {
    ...backendState,
    url: BACKEND_URL,
    ready,
  };
});

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
  terminateBackendProcess();
  app.quit();
});

app.on('before-quit', () => {
  terminateBackendProcess();
});

process.on('exit', () => {
  terminateBackendProcess();
});
