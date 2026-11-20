import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { freshTestDb } from '../helpers/testDb.js';
import { ensureAdmin } from '../../src/main/auth.js';
import { registerIpc, CHANNELS } from '../../src/main/ipc.js';

let pool, call;
beforeEach(async () => {
  pool = await freshTestDb();
  await ensureAdmin(pool);
  const handlers = {};
  registerIpc({ handle: (ch, fn) => (handlers[ch] = fn) }, pool);
  call = (sender, channel, payload) => handlers[channel]({ sender: { id: sender } }, payload);
});
afterEach(() => pool.end());

const loginChanged = async (sender) => {
  await call(sender, 'auth:login', { username: 'admin', password: 'admin' });
  return call(sender, 'auth:changePassword', { newPassword: 'Test-pass-123' });
};

test('preload allowlist matches CHANNELS', () => {
  const src = fs.readFileSync(new URL('../../src/main/preload.cjs', import.meta.url), 'utf8');
  const allowed = [...src.match(/const ALLOWED = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(allowed.sort()).toEqual([...CHANNELS].sort());
});

test('employees:list without login → Not logged in', async () => {
  expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Not logged in' });
});

test('bad login → Invalid username or password', async () => {
  expect(await call(1, 'auth:login', { username: 'admin', password: 'x' })).toEqual({
    ok: false, error: 'Invalid username or password',
  });
});

test('before password change → Change your password first', async () => {
  const res = await call(1, 'auth:login', { username: 'admin', password: 'admin' });
  expect(res.data.mustChangePassword).toBe(true);
  expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Change your password first' });
});

test('after changePassword, employees:list ok and me reflects it', async () => {
  expect(await loginChanged(1)).toEqual({ ok: true });
  expect(await call(1, 'employees:list', {})).toEqual({ ok: true, data: [] });
  expect((await call(1, 'auth:me')).data.mustChangePassword).toBe(false);
});

test('logout then employees:list → Not logged in', async () => {
  await loginChanged(1);
  await call(1, 'auth:logout');
  expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Not logged in' });
  expect(await call(1, 'auth:me')).toEqual({ ok: true, data: null });
});

test('sessions are per sender', async () => {
  await loginChanged(1);
  expect(await call(2, 'employees:list', {})).toEqual({ ok: false, error: 'Not logged in' });
});

test('changePassword without login → Not logged in', async () => {
  expect(await call(1, 'auth:changePassword', { newPassword: 'Test-pass-123' })).toEqual({
    ok: false, error: 'Not logged in',
  });
});

test('thrown error → generic message', async () => {
  await loginChanged(1);
  await pool.query('DROP TABLE employees');
  const orig = console.error;
  console.error = () => {};
  try {
    expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
  } finally {
    console.error = orig;
  }
});
