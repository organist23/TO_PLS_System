import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(pw, Buffer.from(saltHex, 'hex'), KEYLEN);
  return crypto.timingSafeEqual(actual, expected);
}

// Unknown usernames still pay for one scrypt so response time does not reveal which usernames exist.
const DUMMY_HASH = await hashPassword('dummy-password');

export async function ensureAdmin(pool) {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) return;
  await pool.query(
    'INSERT INTO users (username, full_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)',
    ['admin', 'Administrator', 'admin', await hashPassword('admin')],
  );
}

export async function login(pool, username, password) {
  const [[row]] = await pool.query('SELECT * FROM users WHERE username = ?', [String(username ?? '')]);
  const ok = await verifyPassword(String(password ?? ''), row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || !row.active) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

// US-1 password rule, shared with US-2 (new and reset passwords).
export const passwordError = (pw) => (String(pw ?? '').length < 8 ? 'At least 8 characters' : null);

export async function changePassword(pool, userId, newPassword) {
  const pw = String(newPassword ?? '');
  if (passwordError(pw)) return { ok: false, errors: { newPassword: passwordError(pw) } };
  const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
  if (await verifyPassword(pw, row.password_hash)) {
    return { ok: false, errors: { newPassword: 'Must differ from the current password' } };
  }
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [
    await hashPassword(pw),
    userId,
  ]);
  return { ok: true };
}
