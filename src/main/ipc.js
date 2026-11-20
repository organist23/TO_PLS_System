import { login, changePassword } from './auth.js';
import * as directory from './directory.js';

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
    ].map(([ch, fn]) => [ch, ['ready', ({ pool, p }) => fn(pool, p)]]),
  ),
};

// preload.cjs keeps its own copy of this list (a sandboxed preload cannot import ESM); ipc.test.js checks they match.
export const CHANNELS = Object.keys(ROUTES);

export function registerIpc(ipcMain, pool) {
  const sessions = new Map(); // webContents id → User; lives only in the main process
  for (const [channel, [access, fn]] of Object.entries(ROUTES)) {
    ipcMain.handle(channel, async (event, payload) => {
      const id = event.sender.id;
      const user = sessions.get(id);
      if (access !== 'public' && !user) return { ok: false, error: 'Not logged in' };
      if (access === 'ready' && user.mustChangePassword) return { ok: false, error: 'Change your password first' };
      try {
        return await fn({ pool, sessions, id, user, p: payload ?? {} });
      } catch (e) {
        console.error(`[ipc] ${channel}`, e);
        return { ok: false, error: 'Something went wrong. Please try again.' };
      }
    });
  }
  return { endSession: (id) => sessions.delete(id) };
}
