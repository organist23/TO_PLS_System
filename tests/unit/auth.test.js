import { test, expect, beforeEach, afterEach } from 'vitest';
import { freshTestDb } from '../helpers/testDb.js';
import { ensureAdmin, login, changePassword } from '../../src/main/auth.js';

let pool;
beforeEach(async () => {
  pool = await freshTestDb();
  await ensureAdmin(pool);
});
afterEach(() => pool.end());

test('ensureAdmin seeds once', async () => {
  await ensureAdmin(pool);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  expect(n).toBe(1);
  expect(await login(pool, 'admin', 'admin')).toMatchObject({
    username: 'admin', fullName: 'Administrator', role: 'admin', mustChangePassword: true,
  });
});

test('wrong password → null', async () => {
  expect(await login(pool, 'admin', 'nope')).toBeNull();
});

test('unknown user → null', async () => {
  expect(await login(pool, 'ghost', 'admin')).toBeNull();
});

test('disabled → null', async () => {
  await pool.query('UPDATE users SET active = 0');
  expect(await login(pool, 'admin', 'admin')).toBeNull();
});

test('hash is not plaintext', async () => {
  const [[{ password_hash }]] = await pool.query('SELECT password_hash FROM users');
  expect(password_hash.startsWith('scrypt$')).toBe(true);
  expect(password_hash).not.toContain('admin');
});

test('changePassword rejects short password', async () => {
  const { id } = await login(pool, 'admin', 'admin');
  expect(await changePassword(pool, id, 'short')).toEqual({ ok: false, errors: { newPassword: 'At least 8 characters' } });
});

test('changePassword rejects the current password', async () => {
  const { id } = await login(pool, 'admin', 'admin');
  expect(await changePassword(pool, id, 'adminadmin')).toEqual({ ok: true });
  expect(await changePassword(pool, id, 'adminadmin')).toEqual({
    ok: false, errors: { newPassword: 'Must differ from the current password' },
  });
});

test('changePassword clears the forced change and replaces the old password', async () => {
  const { id } = await login(pool, 'admin', 'admin');
  await changePassword(pool, id, 'Test-pass-123');
  expect(await login(pool, 'admin', 'Test-pass-123')).toMatchObject({ mustChangePassword: false });
  expect(await login(pool, 'admin', 'admin')).toBeNull();
});
