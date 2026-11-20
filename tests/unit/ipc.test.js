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
  await pool.query('RENAME TABLE employees TO employees_gone'); // breaks the query; FKs block DROP
  const orig = console.error;
  console.error = () => {};
  try {
    expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
  } finally {
    console.error = orig;
  }
});

test('records:create needs a changed password, then saves with the session user', async () => {
  await call(1, 'auth:login', { username: 'admin', password: 'admin' });
  expect(await call(1, 'records:create', {})).toEqual({ ok: false, error: 'Change your password first' });
  await call(1, 'auth:changePassword', { newPassword: 'Test-pass-123' });
  const officeId = (await call(1, 'offices:create', { name: 'MHO' })).data.id;
  const emp = (await call(1, 'employees:create', { fullName: 'Ana', employmentStatus: 'Casual', officeId })).data.id;
  const rec = (await call(1, 'signatories:create', { name: 'R', title: 'DEPARTMENT HEAD', role: 'recommending' })).data.id;
  const appr = (await call(1, 'signatories:create', { name: 'A', title: 'MUNICIPAL MAYOR', role: 'approving' })).data.id;
  await call(1, 'signatories:setDefault', { issuingOffice: 'MAYOR', role: 'approving', signatoryId: appr });
  expect((await call(1, 'signatories:defaults')).data.MAYOR.approving).toBe(appr);
  const res = await call(1, 'records:create', {
    formType: 'TO', issuingOffice: 'MAYOR', dateFiled: '2026-11-20', employeeIds: [emp], destination: 'Capitol',
    inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-20', departureAt: '2026-11-20T08:00', purpose: 'Meeting',
    recommendingId: rec, approvingId: appr,
  });
  expect(res.data.number).toMatch(/^\d{4}-\d{2}-1$/);
  const [[row]] = await pool.query('SELECT created_by FROM records');
  const [[admin]] = await pool.query("SELECT id FROM users WHERE username = 'admin'");
  expect(row.created_by).toBe(admin.id);
});
