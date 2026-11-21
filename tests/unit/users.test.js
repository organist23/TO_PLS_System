import { test, expect, beforeEach, afterEach } from 'vitest';
import { freshTestDb } from '../helpers/testDb.js';
import { ensureAdmin, login } from '../../src/main/auth.js';
import { listUsers, createUser, resetPassword, setActive } from '../../src/main/users.js';

let pool, adminId;
beforeEach(async () => {
  pool = await freshTestDb();
  await ensureAdmin(pool);
  [[{ id: adminId }]] = await pool.query("SELECT id FROM users WHERE username = 'admin'");
});
afterEach(() => pool.end());

const enc = (over = {}) => createUser(pool, { username: 'encoder1', fullName: 'Ana Cruz', role: 'encoder', password: 'Temp-pass-1', ...over });

test('createUser validates every field', async () => {
  expect((await createUser(pool, {})).errors).toEqual({
    username: 'Required', fullName: 'Required', role: 'Choose admin or encoder', password: 'At least 8 characters',
  });
  expect((await enc({ password: '1234567' })).errors).toEqual({ password: 'At least 8 characters' });
  expect((await enc({ role: 'boss' })).errors).toEqual({ role: 'Choose admin or encoder' });
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  expect(n).toBe(1);
});

test('a duplicate username is rejected, ignoring case and surrounding spaces', async () => {
  expect((await enc()).ok).toBe(true);
  expect((await enc({ username: ' Encoder1 ' })).errors).toEqual({ username: 'Username already taken' });
});

test('a new user logs in with the temporary password and must change it', async () => {
  await enc({ username: '  encoder1  ', fullName: '  Ana   Cruz ' });
  expect(await login(pool, 'encoder1', 'Temp-pass-1')).toMatchObject({ username: 'encoder1', fullName: 'Ana Cruz', role: 'encoder', mustChangePassword: true });
});

test('listUsers lists by username without password hashes', async () => {
  const { id } = (await enc()).data;
  expect((await listUsers(pool)).data).toEqual([
    { id: adminId, username: 'admin', fullName: 'Administrator', role: 'admin', active: true, mustChangePassword: true },
    { id, username: 'encoder1', fullName: 'Ana Cruz', role: 'encoder', active: true, mustChangePassword: true },
  ]);
});

test('resetPassword sets a temporary password that must be changed', async () => {
  const { id } = (await enc()).data;
  await pool.query('UPDATE users SET must_change_password = 0 WHERE id = ?', [id]);
  expect((await resetPassword(pool, { id, password: 'short' })).errors).toEqual({ password: 'At least 8 characters' });
  expect(await resetPassword(pool, { id, password: 'Reset-pass-2' })).toEqual({ ok: true, data: { id, username: 'encoder1' } });
  expect(await login(pool, 'encoder1', 'Temp-pass-1')).toBeNull();
  expect(await login(pool, 'encoder1', 'Reset-pass-2')).toMatchObject({ mustChangePassword: true });
  expect(await resetPassword(pool, { id: 99999, password: 'Reset-pass-2' })).toEqual({ ok: false, error: 'Account not found' });
});

test('a disabled user cannot log in; enabled again, they can', async () => {
  const { id } = (await enc()).data;
  expect(await setActive(pool, { id, active: false }, { actorId: adminId })).toEqual({ ok: true, data: { id, active: false } });
  expect(await login(pool, 'encoder1', 'Temp-pass-1')).toBeNull();
  expect(await setActive(pool, { id, active: true }, { actorId: adminId })).toEqual({ ok: true, data: { id, active: true } });
  expect(await login(pool, 'encoder1', 'Temp-pass-1')).not.toBeNull();
});

test('an admin cannot disable their own account or the last active admin', async () => {
  expect(await setActive(pool, { id: adminId, active: false }, { actorId: adminId })).toEqual({ ok: false, error: 'You cannot disable your own account.' });
  const b = (await enc({ username: 'admin2', role: 'admin' })).data.id;
  expect((await setActive(pool, { id: b, active: false }, { actorId: adminId })).ok).toBe(true); // two admins: fine
  // b (now disabled) is re-enabled; then b tries to disable admin while admin is the only other active admin
  await setActive(pool, { id: b, active: true }, { actorId: adminId });
  await setActive(pool, { id: adminId, active: false }, { actorId: b }); // b disables admin: two were active, fine
  const [[{ active }]] = await pool.query('SELECT active FROM users WHERE id = ?', [adminId]);
  expect(active).toBe(0);
  // b is now the last active admin; an encoder-free check from a third admin account that is disabled:
  const c = (await enc({ username: 'admin3', role: 'admin' })).data.id;
  await setActive(pool, { id: c, active: false }, { actorId: b });
  expect(await setActive(pool, { id: b, active: false }, { actorId: c })).toEqual({ ok: false, error: 'Keep at least one active admin.' });
  const [[{ active: bActive }]] = await pool.query('SELECT active FROM users WHERE id = ?', [b]);
  expect(bActive).toBe(1);
  expect(await setActive(pool, { id: 99999, active: false }, { actorId: b })).toEqual({ ok: false, error: 'Account not found' });
});
