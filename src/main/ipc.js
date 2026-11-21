import { login, changePassword } from './auth.js';
import * as directory from './directory.js';
import * as signatories from './signatories.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  issueBlanks, nextNumbers, listBlank, findBlank, unusedBlankMonths, deleteUnusedBlanks, fillBlank,
  listRecords, getRecord, updateRecord, archiveRecord, restoreRecord,
} from './records.js';
import { getPrintable, buildStackWorkbook, previewOf } from './print.js';
import { outOn, officeReport, reportFile } from './reports.js';
import { backupName, writeBackup, restoreBackup } from './backup.js';

// Save dialog, write, and remember the file so records:openExport can open it. Used by every export.
async function saveExport({ id, os, exported }, defaultName, buffer) {
  const { canceled, filePath } = await os.showSaveDialog({
    defaultPath: path.join(os.documentsDir, defaultName),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { ok: true, data: { canceled: true } };
  try {
    await fs.writeFile(filePath, buffer);
  } catch (e) {
    console.error('[ipc] export write', e);
    return { ok: false, error: 'Could not save the file. If it is open in Excel, close it and try again.' };
  }
  exported.set(id, filePath);
  return { ok: true, data: { path: filePath } };
}

// Access levels: public, logged in (password change may be pending), ready (logged in, password changed).
const ROUTES = {
  'auth:login': ['public', async ({ pool, sessions, id, p }) => {
    const user = await login(pool, p.username, p.password);
    if (!user) return { ok: false, error: 'Invalid username or password' };
    sessions.set(id, user);
    return { ok: true, data: user };
  }],
  'auth:me': ['public', async ({ sessions, id }) => ({ ok: true, data: sessions.get(id) ?? null })],
  'auth:logout': ['public', async ({ sessions, id }) => {
    sessions.delete(id);
    return { ok: true };
  }],
  'auth:changePassword': ['loggedIn', async ({ pool, sessions, id, user, p }) => {
    const res = await changePassword(pool, user.id, p.newPassword);
    if (!res.ok) return { ...res, error: 'Check the highlighted fields' };
    sessions.set(id, { ...user, mustChangePassword: false });
    return res;
  }],
  ...Object.fromEntries(
    [
      ['offices:list', directory.listOffices],
      ['offices:create', directory.createOffice],
      ['offices:update', directory.updateOffice],
      ['offices:archive', directory.archiveOffice],
      ['offices:restore', directory.restoreOffice],
      ['employees:list', directory.listEmployees],
      ['employees:create', directory.createEmployee],
      ['employees:update', directory.updateEmployee],
      ['employees:archive', directory.archiveEmployee],
      ['employees:restore', directory.restoreEmployee],
      ['signatories:list', signatories.listSignatories],
      ['signatories:create', signatories.createSignatory],
      ['signatories:update', signatories.updateSignatory],
      ['signatories:archive', signatories.archiveSignatory],
      ['signatories:restore', signatories.restoreSignatory],
      ['signatories:defaults', signatories.getDefaults],
      ['signatories:setDefault', signatories.setDefault],
    ].map(([ch, fn]) => [ch, ['ready', ({ pool, p }) => fn(pool, p)]]),
  ),
  'records:list': ['ready', ({ pool, p }) => listRecords(pool, p)],
  'records:get': ['ready', ({ pool, p }) => getRecord(pool, p.id)],
  'records:update': ['ready', ({ pool, p }) => updateRecord(pool, p)],
  'records:archive': ['ready', ({ pool, p }) => archiveRecord(pool, p)],
  'records:restore': ['ready', ({ pool, p }) => restoreRecord(pool, p)],
  'records:issueBlank': ['ready', ({ pool, user, p }) => issueBlanks(pool, { count: 1, ...p }, { userId: user.id })],
  'records:nextNumbers': ['ready', ({ pool, p }) => nextNumbers(pool, p)],
  'records:findBlank': ['ready', ({ pool, p }) => findBlank(pool, p)],
  'records:unusedBlanks': ['ready', ({ pool }) => unusedBlankMonths(pool)],
  'records:deleteUnusedBlanks': ['ready', ({ pool, p }) => deleteUnusedBlanks(pool, p)],
  'records:listBlank': ['ready', ({ pool }) => listBlank(pool)],
  'records:fillBlank': ['ready', ({ pool, user, p }) => fillBlank(pool, p, { userId: user.id })],
  'records:preview': ['ready', async ({ pool, p }) => {
    const rec = await getPrintable(pool, p.id);
    return rec.ok ? { ok: true, data: await previewOf(rec.data) } : rec;
  }],
  // { id } for one form, { ids } for a stack (US-16): one file, one sheet per form.
  'records:print': ['ready', async (ctx) => {
    const ids = Array.isArray(ctx.p.ids) ? [...new Set(ctx.p.ids.map(Number))] : [ctx.p.id];
    if (ids.length < 1 || ids.length > 50) return { ok: false, error: 'Choose 1 to 50 forms to print.' };
    const records = [];
    for (const id of ids) {
      const rec = await getPrintable(ctx.pool, id);
      if (!rec.ok) return rec;
      records.push(rec.data);
    }
    const [first, last] = [records[0], records[records.length - 1]];
    const name = records.length === 1 ? `${first.form_type} ${first.number}` : `${first.form_type} ${first.number} to ${last.number}`;
    return saveExport(ctx, `${name}.xlsx`, await buildStackWorkbook(records));
  }],
  'reports:out': ['ready', ({ pool, p }) => outOn(pool, p)],
  'reports:office': ['ready', ({ pool, p }) => officeReport(pool, p)],
  'reports:export': ['ready', async (ctx) => {
    const file = await reportFile(ctx.pool, ctx.p);
    return file.ok ? saveExport(ctx, file.data.name, file.data.buffer) : file;
  }],
  // US-13: a dated .sql in the folder the user picks.
  'backup:create': ['ready', async ({ pool, os }) => {
    const folder = await os.chooseFolder();
    if (!folder) return { ok: true, data: { canceled: true } };
    const file = path.join(folder, backupName(new Date()));
    try {
      await writeBackup(pool, file);
    } catch (e) {
      console.error('[ipc] backup:create', e);
      return { ok: false, error: `Could not save the backup: ${e.message}` };
    }
    return { ok: true, data: { path: file } };
  }],
  // US-14: the file is picked in the main process and remembered, so a renderer-supplied path is never restored.
  'backup:pick': ['ready', async ({ id, os, picked }) => {
    const file = await os.chooseBackupFile();
    if (!file) return { ok: true, data: { canceled: true } };
    picked.set(id, file);
    return { ok: true, data: { file: path.basename(file) } };
  }],
  'backup:restore': ['ready', async ({ pool, id, os, picked, sessions }) => {
    const file = picked.get(id);
    if (!file) return { ok: false, error: 'Choose a backup file first.' };
    picked.delete(id);
    const before = path.join(os.backupDir, backupName(new Date()).replace('.sql', '-before-restore.sql'));
    try {
      await fs.mkdir(os.backupDir, { recursive: true });
      await writeBackup(pool, before);
    } catch (e) {
      console.error('[ipc] backup:restore pre-restore backup', e);
      return { ok: false, error: `Could not back up the current data first: ${e.message}. Nothing was changed.` };
    }
    const res = await restoreBackup(os.dbConfig, file);
    if (!res.ok) return res;
    sessions.clear(); // the users table was replaced: everyone logs in again
    return { ok: true, data: { file: path.basename(file), path: before } };
  }],
  // Opens only the file this window just saved: a renderer-supplied path could launch anything.
  'records:openExport': ['ready', async ({ id, os, exported }) => {
    const file = exported.get(id);
    if (!file) return { ok: false, error: 'Nothing to open yet.' };
    const error = await os.openPath(file);
    return error ? { ok: false, error } : { ok: true };
  }],
};

// preload.cjs keeps its own copy of this list (a sandboxed preload cannot import ESM); ipc.test.js checks they match.
export const CHANNELS = Object.keys(ROUTES);

// os = { showSaveDialog(opts), openPath(file), documentsDir, chooseFolder(), chooseBackupFile(), backupDir, dbConfig }:
// Electron's dialog/shell and paths, injected so tests can fake them.
export function registerIpc(ipcMain, pool, os = {}) {
  const sessions = new Map(); // webContents id → User; lives only in the main process
  const exported = new Map(); // webContents id → last file saved by records:print or reports:export
  const picked = new Map(); // webContents id → backup file chosen in backup:pick
  for (const [channel, [access, fn]] of Object.entries(ROUTES)) {
    ipcMain.handle(channel, async (event, payload) => {
      const id = event.sender.id;
      const user = sessions.get(id);
      if (access !== 'public' && !user) return { ok: false, error: 'Not logged in' };
      if (access === 'ready' && user.mustChangePassword) return { ok: false, error: 'Change your password first' };
      try {
        return await fn({ pool, sessions, id, user, p: payload ?? {}, os, exported, picked });
      } catch (e) {
        console.error(`[ipc] ${channel}`, e);
        return { ok: false, error: 'Something went wrong. Please try again.' };
      }
    });
  }
  return { endSession: (id) => sessions.delete(id) };
}
