import { fieldErrors } from './directory.js';
import { FORM_TYPES, isDate } from './records.js';

// One row per employee on an active, filled record. The office is the one saved on the record.
const FROM_ACTIVE = `FROM record_employees re
  JOIN records r ON r.id = re.record_id
  JOIN offices o ON o.id = re.office_id
 WHERE r.status = 'filled' AND r.archived_at IS NULL`;

export async function outOn(pool, { date, officeId = null } = {}) {
  if (!isDate(date)) return fieldErrors({ date: 'Enter a valid date' });
  const oid = Number(officeId) || 0;
  const [rows] = await pool.query(
    `SELECT r.id AS recordId, r.number, r.form_type AS formType, re.full_name AS fullName, re.office_id AS officeId,
            o.name AS officeName, r.destination, r.return_at AS returnAt, r.inclusive_from AS inclusiveFrom, r.inclusive_to AS inclusiveTo
       ${FROM_ACTIVE} AND r.inclusive_from <= ? AND r.inclusive_to >= ? ${oid ? 'AND re.office_id = ?' : ''}
      ORDER BY o.name, re.full_name, r.number`,
    [date, date, ...(oid ? [oid] : [])],
  );
  return { ok: true, data: rows };
}

export async function officeReport(pool, { officeId = null, formType = '', from, to } = {}) {
  const errors = {};
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (!v) errors[k] = 'Required';
    else if (!isDate(v)) errors[k] = 'Enter a valid date';
  }
  if (!errors.from && !errors.to && to < from) errors.to = 'End date is before start date';
  if (Object.keys(errors).length) return fieldErrors(errors);

  const oid = Number(officeId) || 0;
  const form = FORM_TYPES.includes(formType) ? formType : '';
  const where = `${FROM_ACTIVE} AND r.inclusive_to >= ? AND r.inclusive_from <= ?
    ${oid ? 'AND re.office_id = ?' : ''} ${form ? 'AND r.form_type = ?' : ''}`;
  const params = [from, to, ...(oid ? [oid] : []), ...(form ? [form] : [])];
  const [rows] = await pool.query(
    `SELECT r.id AS recordId, r.number, r.form_type AS formType, re.full_name AS fullName, o.name AS officeName,
            r.date_filed AS dateFiled, r.inclusive_from AS inclusiveFrom, r.inclusive_to AS inclusiveTo, r.destination
       ${where}
      ORDER BY o.name, re.full_name, r.inclusive_from, r.number`,
    params,
  );
  // A record counts once per office, however many of that office's employees are on it.
  const [byForm] = await pool.query(
    `SELECT o.name AS officeName, r.form_type AS formType, COUNT(DISTINCT r.id) AS n ${where}
      GROUP BY o.id, o.name, r.form_type ORDER BY o.name`,
    params,
  );
  const counts = [];
  for (const { officeName, formType: f, n } of byForm) {
    let c = counts.find((x) => x.officeName === officeName);
    if (!c) counts.push((c = { officeName, PLS: 0, TO: 0 }));
    c[f] = n;
  }
  return { ok: true, data: { rows, counts } };
}
