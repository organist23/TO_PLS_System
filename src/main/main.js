import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { ensureAdmin } from './auth.js';
import { registerIpc } from './ipc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = path.join(here, '../../dist/renderer/index.html');

async function start() {
  const envPath =
    process.env.PLS_TO_ENV_FILE ??
    (app.isPackaged ? path.join(app.getPath('userData'), '.env') : path.join(here, '../../.env'));

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'PLS-TO Records System',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // The window only ever shows our own page: a dropped file or link must not replace it and inherit window.api.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  try {
    const config = loadConfig(envPath);
    await migrate(config);
    const pool = createPool(config);
    await ensureAdmin(pool);
    // Looked up at call time so E2E tests can stub the OS dialog and shell.
    const { endSession } = registerIpc(ipcMain, pool, {
      documentsDir: app.getPath('documents'),
      showSaveDialog: (opts) => dialog.showSaveDialog(win, opts),
      openPath: (file) => shell.openPath(file),
    });
    const id = win.webContents.id;
    win.on('closed', () => endSession(id));
    await win.loadFile(indexHtml);
  } catch (e) {
    console.error('[startup]', e);
    await win.loadFile(indexHtml, { hash: `db-error=${encodeURIComponent(`${e.message} Config file: ${envPath}`)}` });
  }
}

app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
