import { hashPassword, passwordError } from './auth.js';
import { fieldErrors, text, isDup } from './directory.js';

export const USER_ROLES = ['admin', 'encoder'];
const NOT_FOUND = { ok: false, error: 'Account not found' };

export async function listUsers(pool) {
  const [rows] = await pool.query(
    `SELECT id, username, full_name AS fullName, role, active = 1 AS active, must_change_password = 1 AS mustChangePassword
       FROM users ORDER BY username`,
  );
  return { ok: true, data: rows.map((r) => ({ ...r, active: r.active === 1, mustChangePassword: r.mustChangePassword === 1 })) };
}

// US-2: the password given here is temporary; the user chooses their own at the first login (US-1 screen).
export async function createUser(pool, { username, fullName, role, password } = {}) {
  const errors = {};
  const u = text(username);
  const name = text(fullName);
  if (!u) errors.username = 'Required';
  if (!name) errors.fullName = 'Required';
  if (!USER_ROLES.includes(role)) errors.role = 'Choose admin or encoder';
  const pw = passwordError(password);
  if (pw) errors.password = pw;
  if (Object.keys(errors).length) return fieldErrors(errors);
  try {
    const [r] = await pool.query(
      'INSERT INTO users (username, full_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)',
      [u, name, role, await hashPassword(password)],
    );
    return { ok: true, data: { id: r.insertId } };
  } catch (e) {
    if (isDup(e)) return fieldErrors({ username: 'Username already taken' });
    throw e;
  }
}

export async function resetPassword(pool, { id, password } = {}) {
  const pw = passwordError(password);
  if (pw) return fieldErrors({ password: pw });
  const [[user]] = await pool.query('SELECT id, username FROM users WHERE id = ?', [Number(id) || 0]);
  if (!user) return NOT_FOUND;
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [await hashPassword(password), user.id]);
  return { ok: true, data: { id: user.id, username: user.username } };
}

export async function setActive(pool, { id, active } = {}, { actorId }) {
  const [[user]] = await pool.query('SELECT id, role, active FROM users WHERE id = ?', [Number(id) || 0]);
  if (!user) return NOT_FOUND;
  const on = Boolean(active);
  if (!on) {
    if (user.id === actorId) return { ok: false, error: 'You cannot disable your own account.' };
    if (user.role === 'admin' && user.active) {
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", [user.id]);
      if (n === 0) return { ok: false, error: 'Keep at least one active admin.' };
    }
  }
  await pool.query('UPDATE users SET active = ? WHERE id = ?', [on ? 1 : 0, user.id]);
  return { ok: true, data: { id: user.id, active: on } };
}
