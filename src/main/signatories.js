import { fieldErrors, text, isDup } from './directory.js';

export const ISSUING_OFFICES = { MAYOR: "Mayor's Office", SB: 'Sangguniang Bayan' };
export const ROLES = ['recommending', 'approving'];

const defaultBlock = async (pool, id) => {
  const [[d]] = await pool.query('SELECT issuing_office FROM signatory_defaults WHERE signatory_id = ? ORDER BY issuing_office', [id]);
  return d && { ok: false, error: `It is the default for ${ISSUING_OFFICES[d.issuing_office]}. Choose another default first.` };
};

export async function listSignatories(pool, { archived = false, role = null } = {}) {
  const params = [];
  let roleSql = '';
  if (ROLES.includes(role)) {
    roleSql = 'AND role = ?';
    params.push(role);
  }
  const [rows] = await pool.query(
    `SELECT id, name, title, role, archived_at AS archivedAt FROM signatories
      WHERE archived_at IS ${archived ? 'NOT ' : ''}NULL ${roleSql}
      ORDER BY role DESC, name`, // recommending before approving
    params,
  );
  return { ok: true, data: rows };
}

async function saveSignatory(pool, id, input) {
  const name = text(input.name);
  const title = text(input.title);
  const role = input.role;
  const errors = {};
  if (!name) errors.name = 'Required';
  if (!title) errors.title = 'Required';
  if (!ROLES.includes(role)) errors.role = 'Choose a role';
  if (Object.keys(errors).length) return fieldErrors(errors);
  try {
    if (id) {
      const [[cur]] = await pool.query('SELECT role FROM signatories WHERE id = ?', [id]);
      if (cur && cur.role !== role) {
        const blocked = await defaultBlock(pool, id);
        if (blocked) return blocked;
      }
      await pool.query('UPDATE signatories SET name = ?, title = ?, role = ? WHERE id = ?', [name, title, role, id]);
      return { ok: true, data: { id } };
    }
    const [r] = await pool.query('INSERT INTO signatories (name, title, role) VALUES (?, ?, ?)', [name, title, role]);
    return { ok: true, data: { id: r.insertId } };
  } catch (e) {
    if (!isDup(e)) throw e;
    const [[row]] = await pool.query('SELECT archived_at FROM signatories WHERE name = ? AND title = ? AND role = ?', [name, title, role]);
    return fieldErrors({
      name: row?.archived_at ? 'This signatory is archived. Restore it instead.' : 'This signatory already exists',
    });
  }
}

export const createSignatory = (pool, input) => saveSignatory(pool, null, input);
export const updateSignatory = (pool, input) => saveSignatory(pool, input.id, input);

export async function archiveSignatory(pool, { id }) {
  const blocked = await defaultBlock(pool, id);
  if (blocked) return blocked;
  await pool.query('UPDATE signatories SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL', [id]);
  return { ok: true };
}

export async function restoreSignatory(pool, { id }) {
  await pool.query('UPDATE signatories SET archived_at = NULL WHERE id = ?', [id]);
  return { ok: true };
}

export async function getDefaults(pool) {
  const data = Object.fromEntries(Object.keys(ISSUING_OFFICES).map((o) => [o, { recommending: null, approving: null }]));
  const [rows] = await pool.query('SELECT issuing_office, role, signatory_id FROM signatory_defaults');
  for (const r of rows) data[r.issuing_office][r.role] = r.signatory_id;
  return { ok: true, data };
}

// Returns the active signatory with that role, or undefined.
export async function activeSignatory(pool, id, role) {
  const [[row]] = await pool.query(
    'SELECT id, name, title FROM signatories WHERE id = ? AND role = ? AND archived_at IS NULL',
    [Number(id) || 0, role],
  );
  return row;
}

export async function setDefault(pool, { issuingOffice, role, signatoryId }) {
  if (!ISSUING_OFFICES[issuingOffice] || !ROLES.includes(role)) return { ok: false, error: 'Invalid default' };
  if (!(await activeSignatory(pool, signatoryId, role))) {
    return fieldErrors({ signatoryId: `Choose an active ${role} signatory` });
  }
  await pool.query(
    'INSERT INTO signatory_defaults (issuing_office, role, signatory_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE signatory_id = VALUES(signatory_id)',
    [issuingOffice, role, signatoryId],
  );
  return { ok: true };
}
