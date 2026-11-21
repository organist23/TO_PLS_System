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
  else if (u.length > 50) errors.username = 'At most 50 characters';
  if (!name) errors.fullName = 'Required';
  else if (name.length > 150) errors.fullName = 'At most 150 characters';
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

export async function resetPassword(pool, { id, password } = {}, { actorId } = {}) {
  const pw = passwordError(password);
  if (pw) return fieldErrors({ password: pw });
  const [[user]] = await pool.query('SELECT id, username FROM users WHERE id = ?', [Number(id) || 0]);
  if (!user) return NOT_FOUND;
  // It would end the session the admin is using; their own password is changed at login (US-1).
  if (user.id === actorId) return { ok: false, error: 'You cannot reset your own password here.' };
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [await hashPassword(password), user.id]);
  return { ok: true, data: { id: user.id, username: user.username } };
}

// The admin rows are locked while checking, so two admins disabling each other at once cannot leave none active.
export async function setActive(pool, { id, active } = {}, { actorId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 FOR UPDATE");
    const [[user]] = await conn.query('SELECT id, role, active FROM users WHERE id = ? FOR UPDATE', [Number(id) || 0]);
    const on = Boolean(active);
    let refusal = !user ? NOT_FOUND : null;
    if (user && !on) {
      if (user.id === actorId) refusal = { ok: false, error: 'You cannot disable your own account.' };
      else if (user.role === 'admin' && user.active) {
        const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", [user.id]);
        if (n === 0) refusal = { ok: false, error: 'Keep at least one active admin.' };
      }
    }
    if (refusal) {
      await conn.rollback();
      return refusal;
    }
    await conn.query('UPDATE users SET active = ? WHERE id = ?', [on ? 1 : 0, user.id]);
    await conn.commit();
    return { ok: true, data: { id: user.id, active: on } };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
