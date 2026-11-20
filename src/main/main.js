import { app, BrowserWindow, ipcMain } from 'electron';
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

  try {
    const config = loadConfig(envPath);
    await migrate(config);
    const pool = createPool(config);
    await ensureAdmin(pool);
    const { endSession } = registerIpc(ipcMain, pool);
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
