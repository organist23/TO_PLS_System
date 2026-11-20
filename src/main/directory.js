export const EMPLOYMENT_STATUSES = ['Permanent', 'Casual', 'Coterminous', 'Contractual', 'Job Order'];

const fieldErrors = (errors) => ({ ok: false, error: 'Check the highlighted fields', errors });
const text = (v) => String(v ?? '').trim();
const isDup = (e) => e.code === 'ER_DUP_ENTRY';
// LIKE wildcards in user input must match literally.
const likeLiteral = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ---------- offices ----------

export async function listOffices(pool, { archived = false } = {}) {
  const [rows] = await pool.query(
    `SELECT o.id, o.name, o.archived_at AS archivedAt,
            (SELECT COUNT(*) FROM employees e WHERE e.office_id = o.id AND e.archived_at IS NULL) AS activeEmployees
       FROM offices o
      WHERE o.archived_at IS ${archived ? 'NOT ' : ''}NULL
      ORDER BY o.name`,
  );
  return { ok: true, data: rows };
}

async function saveOffice(pool, id, input) {
  const name = text(input.name);
  if (!name) return fieldErrors({ name: 'Required' });
  try {
    if (id) {
      await pool.query('UPDATE offices SET name = ? WHERE id = ?', [name, id]);
      return { ok: true, data: { id } };
    }
    const [r] = await pool.query('INSERT INTO offices (name) VALUES (?)', [name]);
    return { ok: true, data: { id: r.insertId } };
  } catch (e) {
    if (isDup(e)) return fieldErrors({ name: 'An office with this name already exists' });
    throw e;
  }
}

export const createOffice = (pool, input) => saveOffice(pool, null, input);
export const updateOffice = (pool, input) => saveOffice(pool, input.id, input);

export async function archiveOffice(pool, { id }) {
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM employees WHERE office_id = ? AND archived_at IS NULL',
    [id],
  );
  if (n > 0) return { ok: false, error: `Move or archive its ${n} employees first.` };
  await pool.query('UPDATE offices SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL', [id]);
  return { ok: true };
}

export async function restoreOffice(pool, { id }) {
  await pool.query('UPDATE offices SET archived_at = NULL WHERE id = ?', [id]);
  return { ok: true };
}

// ---------- employees ----------

export async function listEmployees(pool, { search = '', officeId = null, archived = false } = {}) {
  const where = [`e.archived_at IS ${archived ? 'NOT ' : ''}NULL`];
  const params = [];
  if (text(search)) {
    where.push("e.full_name LIKE ? ESCAPE '\\\\'");
    params.push(likeLiteral(text(search)));
  }
  if (officeId) {
    where.push('e.office_id = ?');
    params.push(officeId);
  }
  const [rows] = await pool.query(
    `SELECT e.id, e.full_name AS fullName, e.designation, e.employment_status AS employmentStatus,
            e.office_id AS officeId, o.name AS officeName, e.archived_at AS archivedAt
       FROM employees e JOIN offices o ON o.id = e.office_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.full_name`,
    params,
  );
  return { ok: true, data: rows };
}

async function saveEmployee(pool, id, input) {
  const fullName = text(input.fullName);
  const designation = text(input.designation);
  const employmentStatus = text(input.employmentStatus);
  const officeId = input.officeId || null;
  const errors = {};
  if (!fullName) errors.fullName = 'Required';
  if (!officeId) errors.officeId = 'Required';
  else {
    const [[o]] = await pool.query('SELECT archived_at FROM offices WHERE id = ?', [officeId]);
    if (!o || o.archived_at) errors.officeId = 'Choose an active office';
  }
  if (!EMPLOYMENT_STATUSES.includes(employmentStatus)) errors.employmentStatus = 'Choose a status';
  if (Object.keys(errors).length) return fieldErrors(errors);

  const values = [fullName, designation, employmentStatus, officeId];
  try {
    if (id) {
      await pool.query(
        'UPDATE employees SET full_name = ?, designation = ?, employment_status = ?, office_id = ? WHERE id = ?',
        [...values, id],
      );
      return { ok: true, data: { id } };
    }
    const [r] = await pool.query(
      'INSERT INTO employees (full_name, designation, employment_status, office_id) VALUES (?, ?, ?, ?)',
      values,
    );
    return { ok: true, data: { id: r.insertId } };
  } catch (e) {
    if (isDup(e)) return fieldErrors({ fullName: 'This employee already exists in this office' });
    throw e;
  }
}

export const createEmployee = (pool, input) => saveEmployee(pool, null, input);
export const updateEmployee = (pool, input) => saveEmployee(pool, input.id, input);

export async function archiveEmployee(pool, { id }) {
  await pool.query('UPDATE employees SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL', [id]);
  return { ok: true };
}

export async function restoreEmployee(pool, { id }) {
  const [[row]] = await pool.query(
    'SELECT o.archived_at FROM employees e JOIN offices o ON o.id = e.office_id WHERE e.id = ?',
    [id],
  );
  if (row?.archived_at) return { ok: false, error: 'Restore its office first.' };
  await pool.query('UPDATE employees SET archived_at = NULL WHERE id = ?', [id]);
  return { ok: true };
}
