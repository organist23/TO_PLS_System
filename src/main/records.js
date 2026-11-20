import { fieldErrors, text } from './directory.js';
import { ISSUING_OFFICES, activeSignatory } from './signatories.js';

export const FORM_TYPES = ['PLS', 'TO'];

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

async function validate(conn, input) {
  const errors = {};
  if (!FORM_TYPES.includes(input.formType)) errors.formType = 'Required';
  if (!ISSUING_OFFICES[input.issuingOffice]) errors.issuingOffice = 'Required';
  if (!isDate(input.dateFiled)) errors.dateFiled = 'Required';
  for (const f of ['destination', 'purpose']) if (!text(input[f])) errors[f] = 'Required';
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
  let employees = [];
  if (ids.length === 0) errors.employees = 'Add at least one employee';
  else if (ids.length > 5) errors.employees = 'At most 5 employees';
  else if (new Set(ids).size !== ids.length) errors.employees = 'Remove duplicate employees';
  else {
    const [rows] = await conn.query(
      'SELECT id, office_id, full_name, designation, employment_status FROM employees WHERE id IN (?) AND archived_at IS NULL',
      [ids],
    );
    if (rows.length !== ids.length) errors.employees = 'Choose active employees';
    else employees = ids.map((id) => rows.find((r) => r.id === id));
  }

  const recommending = await activeSignatory(conn, input.recommendingId, 'recommending');
  if (!recommending) errors.recommendingId = 'Choose an active recommending signatory';
  const approving = await activeSignatory(conn, input.approvingId, 'approving');
  if (!approving) errors.approvingId = 'Choose an active approving signatory';

  return { errors, employees, recommending, approving };
}

async function findOverlaps(conn, ids, from, to) {
  const [rows] = await conn.query(
    `SELECT e.full_name AS employeeName, r.form_type AS formType, r.number,
            r.inclusive_from AS inclusiveFrom, r.inclusive_to AS inclusiveTo
       FROM record_employees re
       JOIN records r ON r.id = re.record_id
       JOIN employees e ON e.id = re.employee_id
      WHERE re.employee_id IN (?) AND r.archived_at IS NULL
        AND r.inclusive_from <= ? AND r.inclusive_to >= ?
      ORDER BY e.full_name, r.number`,
    [ids, to, from],
  );
  return rows;
}

export async function createRecord(pool, input, { userId, now = new Date() }) {
  const conn = await pool.getConnection();
  const period = periodOf(now);
  const lockName = `plsto:${input.formType}:${input.issuingOffice}:${period}`;
  let locked = false;
  try {
    const { errors, employees, recommending, approving } = await validate(conn, input);
    if (Object.keys(errors).length) return fieldErrors(errors);

    const ids = employees.map((e) => e.id);
    if (input.confirmOverlap !== true) {
      const overlaps = await findOverlaps(conn, ids, input.inclusiveFrom, input.inclusiveTo);
      if (overlaps.length) return { ok: false, error: 'Overlapping records', overlaps };
    }

    // A named lock per counter serializes concurrent saves; FOR UPDATE on an empty range deadlocks in InnoDB.
    const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [lockName]);
    if (got !== 1) throw new Error(`Could not lock counter ${lockName}`);
    locked = true;

    await conn.beginTransaction();
    try {
      const [[{ next }]] = await conn.query(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM records WHERE form_type = ? AND issuing_office = ? AND period = ?',
        [input.formType, input.issuingOffice, period],
      );
      const number = formatNumber(input.issuingOffice, period, next);
      const [r] = await conn.query(
        `INSERT INTO records (form_type, issuing_office, period, seq, number, date_filed, destination, vehicle,
           inclusive_from, inclusive_to, departure_at, return_at, purpose,
           recommending_id, recommending_name, recommending_title, approving_id, approving_name, approving_title, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.formType, input.issuingOffice, period, next, number, input.dateFiled,
          text(input.destination), text(input.vehicle), input.inclusiveFrom, input.inclusiveTo,
          toSqlDateTime(input.departureAt), input.returnAt ? toSqlDateTime(input.returnAt) : null, text(input.purpose),
          recommending.id, recommending.name, recommending.title, approving.id, approving.name, approving.title, userId,
        ],
      );
      await conn.query(
        'INSERT INTO record_employees (record_id, position, employee_id, office_id, full_name, designation, employment_status) VALUES ?',
        [employees.map((e, i) => [r.insertId, i + 1, e.id, e.office_id, e.full_name, e.designation, e.employment_status])],
      );
      await conn.commit();
      return { ok: true, data: { id: r.insertId, number, formType: input.formType } };
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  } finally {
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
    conn.release();
  }
}
