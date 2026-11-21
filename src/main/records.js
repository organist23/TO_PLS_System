import { fieldErrors, text } from './directory.js';
import { ISSUING_OFFICES, activeSignatory } from './signatories.js';

export const FORM_TYPES = ['PLS', 'TO'];
const MAX_PURPOSE = 360; // fits the 4 printed PURPOSE(S) lines

export const formatNumber = (issuingOffice, period, seq) => `${issuingOffice === 'SB' ? 'SB ' : ''}${period}-${seq}`;
export const periodOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// 'YYYY-MM-DD' that is a real calendar date.
const isDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '')) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
const isDateTime = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s ?? '') && isDate(s.slice(0, 10));
const toSqlDateTime = (s) => `${s.replace('T', ' ')}:00`;

// Form type, office and signatories: what a blank form prints.
async function validateHeader(conn, input, errors) {
  if (!FORM_TYPES.includes(input.formType)) errors.formType = 'Required';
  if (!ISSUING_OFFICES[input.issuingOffice]) errors.issuingOffice = 'Required';
  const recommending = await activeSignatory(conn, input.recommendingId, 'recommending');
  if (!recommending) errors.recommendingId = 'Choose an active recommending signatory';
  const approving = await activeSignatory(conn, input.approvingId, 'approving');
  if (!approving) errors.approvingId = 'Choose an active approving signatory';
  return { recommending, approving };
}

// Everything staff write on the form: dates, employees, destination, purpose.
async function validateDetails(conn, input, errors) {
  if (!isDate(input.dateFiled)) errors.dateFiled = 'Required';
  for (const f of ['destination', 'purpose']) if (!text(input[f])) errors[f] = 'Required';
  if (!errors.purpose && text(input.purpose).length > MAX_PURPOSE) errors.purpose = `At most ${MAX_PURPOSE} characters`;
  for (const f of ['inclusiveFrom', 'inclusiveTo']) if (!isDate(input[f])) errors[f] = 'Required';
  if (!isDateTime(input.departureAt)) errors.departureAt = 'Required';
  const hasReturn = Boolean(input.returnAt);
  if (hasReturn && !isDateTime(input.returnAt)) errors.returnAt = 'Enter a valid date and time';
  if (!errors.inclusiveFrom && !errors.inclusiveTo && input.inclusiveTo < input.inclusiveFrom) {
    errors.inclusiveTo = 'End date is before start date';
  }
  if (hasReturn && !errors.returnAt && !errors.departureAt && input.returnAt < input.departureAt) {
    errors.returnAt = 'Return is before departure';
  }

  const ids = Array.isArray(input.employeeIds) ? input.employeeIds.map(Number) : [];
  if (ids.length === 0) errors.employees = 'Add at least one employee';
  else if (ids.length > 5) errors.employees = 'At most 5 employees';
  else if (new Set(ids).size !== ids.length) errors.employees = 'Remove duplicate employees';
  else {
    const [rows] = await conn.query(
      'SELECT id, office_id, full_name, designation, employment_status FROM employees WHERE id IN (?) AND archived_at IS NULL',
      [ids],
    );
    if (rows.length !== ids.length) errors.employees = 'Choose active employees';
    else return ids.map((id) => rows.find((r) => r.id === id));
  }
  return [];
}

const detailValues = (input) => [
  input.dateFiled, text(input.destination), text(input.vehicle), input.inclusiveFrom, input.inclusiveTo,
  toSqlDateTime(input.departureAt), input.returnAt ? toSqlDateTime(input.returnAt) : null, text(input.purpose),
];

const insertEmployees = (conn, recordId, employees) =>
  conn.query(
    'INSERT INTO record_employees (record_id, position, employee_id, office_id, full_name, designation, employment_status) VALUES ?',
    [employees.map((e, i) => [recordId, i + 1, e.id, e.office_id, e.full_name, e.designation, e.employment_status])],
  );

async function findOverlaps(conn, employees, from, to) {
  const [rows] = await conn.query(
    `SELECT e.full_name AS employeeName, r.form_type AS formType, r.number,
            r.inclusive_from AS inclusiveFrom, r.inclusive_to AS inclusiveTo
       FROM record_employees re
       JOIN records r ON r.id = re.record_id
       JOIN employees e ON e.id = re.employee_id
      WHERE re.employee_id IN (?) AND r.archived_at IS NULL
        AND r.inclusive_from <= ? AND r.inclusive_to >= ?
      ORDER BY e.full_name, r.number`,
    [employees.map((e) => e.id), to, from],
  );
  return rows;
}

// Runs fn(conn) on a pooled connection. A failed RELEASE_LOCK after commit must not turn success into an error:
// destroying the connection ends the session, which frees any named lock it held.
async function withConnection(pool, fn) {
  const conn = await pool.getConnection();
  const held = [];
  try {
    return await fn(conn, held);
  } finally {
    try {
      for (const name of held) await conn.query('SELECT RELEASE_LOCK(?)', [name]);
      conn.release();
    } catch (e) {
      console.error('[records] RELEASE_LOCK failed', e);
      conn.destroy();
    }
  }
}

// The only place a number is assigned. A named lock per counter serializes concurrent saves
// (FOR UPDATE on an empty range deadlocks in InnoDB); the unique key on (form, office, period, seq) is the backstop.
async function withCounter(conn, held, formType, issuingOffice, now, insert) {
  const period = periodOf(now);
  const lockName = `plsto:${formType}:${issuingOffice}:${period}`;
  const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [lockName]);
  if (got !== 1) throw new Error(`Could not lock counter ${lockName}`);
  held.push(lockName);
  await conn.beginTransaction();
  try {
    const [[{ next }]] = await conn.query(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM records WHERE form_type = ? AND issuing_office = ? AND period = ?',
      [formType, issuingOffice, period],
    );
    const number = formatNumber(issuingOffice, period, next);
    const id = await insert({ period, seq: next, number });
    await conn.commit();
    return { ok: true, data: { id, number, formType } };
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

const HEADER_COLUMNS = `form_type, issuing_office, period, seq, number, status,
  recommending_id, recommending_name, recommending_title, approving_id, approving_name, approving_title, created_by`;
const headerValues = (input, c, status, rec, appr, userId) => [
  input.formType, input.issuingOffice, c.period, c.seq, c.number, status,
  rec.id, rec.name, rec.title, appr.id, appr.name, appr.title, userId,
];

export function createRecord(pool, input, { userId, now = new Date() }) {
  return withConnection(pool, async (conn, held) => {
    const errors = {};
    const { recommending, approving } = await validateHeader(conn, input, errors);
    const employees = await validateDetails(conn, input, errors);
    if (Object.keys(errors).length) return fieldErrors(errors);

    if (input.confirmOverlap !== true) {
      const overlaps = await findOverlaps(conn, employees, input.inclusiveFrom, input.inclusiveTo);
      if (overlaps.length) return { ok: false, error: 'Overlapping records', overlaps };
    }

    return withCounter(conn, held, input.formType, input.issuingOffice, now, async (c) => {
      const [r] = await conn.query(
        `INSERT INTO records (${HEADER_COLUMNS}, date_filed, destination, vehicle, inclusive_from, inclusive_to,
           departure_at, return_at, purpose)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...headerValues(input, c, 'filled', recommending, approving, userId), ...detailValues(input)],
      );
      await insertEmployees(conn, r.insertId, employees);
      return r.insertId;
    });
  });
}

export function issueBlank(pool, input, { userId, now = new Date() }) {
  return withConnection(pool, async (conn, held) => {
    const errors = {};
    const { recommending, approving } = await validateHeader(conn, input, errors);
    if (Object.keys(errors).length) return fieldErrors(errors);
    return withCounter(conn, held, input.formType, input.issuingOffice, now, async (c) => {
      const [r] = await conn.query(
        `INSERT INTO records (${HEADER_COLUMNS}, destination, purpose) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')`,
        headerValues(input, c, 'blank', recommending, approving, userId),
      );
      return r.insertId;
    });
  });
}

export async function listBlank(pool) {
  const [rows] = await pool.query(
    `SELECT id, number, form_type AS formType, issuing_office AS issuingOffice,
            recommending_name AS recommendingName, recommending_title AS recommendingTitle,
            approving_name AS approvingName, approving_title AS approvingTitle, created_at AS createdAt
       FROM records WHERE status = 'blank' AND archived_at IS NULL ORDER BY id DESC`,
  );
  return { ok: true, data: rows };
}

const GONE = { ok: false, error: 'This blank form is no longer available.' };

// Fills a blank form under its printed number. Form type, office and signatories stay as printed.
export function fillBlank(pool, input, { userId }) {
  return withConnection(pool, async (conn) => {
    const [[rec]] = await conn.query(
      "SELECT id, number, form_type FROM records WHERE id = ? AND status = 'blank' AND archived_at IS NULL",
      [Number(input.id) || 0],
    );
    if (!rec) return GONE;
    const errors = {};
    const employees = await validateDetails(conn, input, errors);
    if (Object.keys(errors).length) return fieldErrors(errors);
    if (input.confirmOverlap !== true) {
      const overlaps = await findOverlaps(conn, employees, input.inclusiveFrom, input.inclusiveTo);
      if (overlaps.length) return { ok: false, error: 'Overlapping records', overlaps };
    }
    await conn.beginTransaction();
    try {
      const [u] = await conn.query(
        `UPDATE records SET status = 'filled', date_filed = ?, destination = ?, vehicle = ?, inclusive_from = ?, inclusive_to = ?,
           departure_at = ?, return_at = ?, purpose = ? WHERE id = ? AND status = 'blank'`,
        [...detailValues(input), rec.id],
      );
      if (u.affectedRows !== 1) {
        await conn.rollback();
        return GONE; // filled by another save in the meantime
      }
      await insertEmployees(conn, rec.id, employees);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
    return { ok: true, data: { id: rec.id, number: rec.number, formType: rec.form_type } };
  });
}
