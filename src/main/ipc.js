import { login, changePassword } from './auth.js';
import * as directory from './directory.js';
import * as signatories from './signatories.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecord, issueBlank, listBlank, fillBlank, listRecords, getRecord, updateRecord, archiveRecord, restoreRecord } from './records.js';
import { getPrintable, buildWorkbook, previewOf } from './print.js';

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
  'records:create': ['ready', ({ pool, user, p }) => createRecord(pool, p, { userId: user.id })],
  'records:issueBlank': ['ready', ({ pool, user, p }) => issueBlank(pool, p, { userId: user.id })],
  'records:listBlank': ['ready', ({ pool }) => listBlank(pool)],
  'records:fillBlank': ['ready', ({ pool, user, p }) => fillBlank(pool, p, { userId: user.id })],
  'records:preview': ['ready', async ({ pool, p }) => {
    const rec = await getPrintable(pool, p.id);
    return rec.ok ? { ok: true, data: await previewOf(rec.data) } : rec;
  }],
  'records:print': ['ready', async ({ pool, id, p, os, exported }) => {
    const rec = await getPrintable(pool, p.id);
    if (!rec.ok) return rec;
    const buffer = await buildWorkbook(rec.data);
    const { canceled, filePath } = await os.showSaveDialog({
      defaultPath: path.join(os.documentsDir, `${rec.data.form_type} ${rec.data.number}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { ok: true, data: { canceled: true } };
    try {
      await fs.writeFile(filePath, buffer);
    } catch (e) {
      console.error('[ipc] records:print write', e);
      return { ok: false, error: 'Could not save the file. If it is open in Excel, close it and try again.' };
    }
    exported.set(id, filePath);
    return { ok: true, data: { path: filePath } };
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

// os = { showSaveDialog(opts), openPath(file), documentsDir }: Electron's dialog/shell, injected so tests can fake them.
export function registerIpc(ipcMain, pool, os = {}) {
  const sessions = new Map(); // webContents id → User; lives only in the main process
  const exported = new Map(); // webContents id → last file saved by records:print
  for (const [channel, [access, fn]] of Object.entries(ROUTES)) {
    ipcMain.handle(channel, async (event, payload) => {
      const id = event.sender.id;
      const user = sessions.get(id);
      if (access !== 'public' && !user) return { ok: false, error: 'Not logged in' };
      if (access === 'ready' && user.mustChangePassword) return { ok: false, error: 'Change your password first' };
      try {
        return await fn({ pool, sessions, id, user, p: payload ?? {}, os, exported });
      } catch (e) {
        console.error(`[ipc] ${channel}`, e);
        return { ok: false, error: 'Something went wrong. Please try again.' };
      }
    });
  }
  return { endSession: (id) => sessions.delete(id) };
}
