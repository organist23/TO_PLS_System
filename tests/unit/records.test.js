import { test, expect, beforeEach, afterEach } from 'vitest';
import { freshTestDb, testConfig } from '../helpers/testDb.js';
import { ensureAdmin } from '../../src/main/auth.js';
import { createOffice, createEmployee, archiveEmployee, updateEmployee } from '../../src/main/directory.js';
import { createSignatory, archiveSignatory, updateSignatory } from '../../src/main/signatories.js';
import { createRecord, formatNumber, periodOf, issueBlank, listBlank, fillBlank, listRecords, getRecord, updateRecord, archiveRecord, restoreRecord } from '../../src/main/records.js';

let pool, ids;
const NOV = new Date(2026, 10, 20, 9, 0);

beforeEach(async () => {
  pool = await freshTestDb();
  await ensureAdmin(pool);
  const officeId = (await createOffice(pool, { name: 'MHO' })).data.id;
  const emps = [];
  for (let i = 1; i <= 6; i++) {
    emps.push((await createEmployee(pool, { fullName: `Emp ${i}`, designation: `Desig ${i}`, employmentStatus: 'Permanent', officeId })).data.id);
  }
  const rec = (await createSignatory(pool, { name: 'DEPT HEAD', title: 'DEPARTMENT HEAD', role: 'recommending' })).data.id;
  const appr = (await createSignatory(pool, { name: 'MAYOR', title: 'MUNICIPAL MAYOR', role: 'approving' })).data.id;
  const [[{ id: userId }]] = await pool.query('SELECT id FROM users');
  ids = { officeId, emps, rec, appr, userId };
});
afterEach(() => pool.end());

const valid = (over = {}) => ({
  formType: 'PLS', issuingOffice: 'MAYOR', dateFiled: '2026-11-20', employeeIds: [ids.emps[0]],
  destination: 'Provincial Capitol', vehicle: '', inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-20',
  departureAt: '2026-11-20T08:00', returnAt: '', purpose: 'Submit reports',
  recommendingId: ids.rec, approvingId: ids.appr, ...over,
});
const create = (over, now = NOV) => createRecord(pool, valid(over), { userId: ids.userId, now });
const numberOf = async (over, now) => (await create(over, now)).data.number;
const count = async () => (await pool.query('SELECT COUNT(*) AS n FROM records'))[0][0].n;

test('formatNumber and periodOf', () => {
  expect(formatNumber('MAYOR', '2026-11', 1)).toBe('2026-11-1');
  expect(formatNumber('SB', '2026-01', 12)).toBe('SB 2026-01-12');
  expect(periodOf(new Date(2026, 0, 5))).toBe('2026-01');
});

test('4 independent counters', async () => {
  expect(await numberOf({})).toBe('2026-11-1');
  expect(await numberOf({ inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21' })).toBe('2026-11-2');
  expect(await numberOf({ formType: 'TO', employeeIds: [ids.emps[1]] })).toBe('2026-11-1');
  expect(await numberOf({ issuingOffice: 'SB', employeeIds: [ids.emps[2]] })).toBe('SB 2026-11-1');
  expect(await numberOf({ issuingOffice: 'SB', formType: 'TO', employeeIds: [ids.emps[3]] })).toBe('SB 2026-11-1');
});

test('month boundary resets the counter (local time)', async () => {
  await create({});
  await create({ employeeIds: [ids.emps[1]] });
  expect(await numberOf({ employeeIds: [ids.emps[2]] }, new Date(2026, 10, 30, 23, 59))).toBe('2026-11-3');
  expect(await numberOf({ employeeIds: [ids.emps[3]] }, new Date(2026, 11, 1, 0, 0))).toBe('2026-12-1');
});

test('concurrent saves on one counter get different numbers', async () => {
  const results = await Promise.all(ids.emps.slice(0, 5).map((e) => create({ employeeIds: [e] })));
  expect(results.map((r) => r.data?.number).sort()).toEqual(['2026-11-1', '2026-11-2', '2026-11-3', '2026-11-4', '2026-11-5']);
});

test('restore-safe: numbering continues after the highest stored seq', async () => {
  await create({});
  await pool.query("UPDATE records SET seq = 7, number = '2026-11-7'");
  expect(await numberOf({ employeeIds: [ids.emps[1]] })).toBe('2026-11-8');
});

test('each missing required field says Required; nothing saved', async () => {
  const res = await create({
    destination: ' ', purpose: '', dateFiled: '', inclusiveFrom: '', inclusiveTo: '', departureAt: 'x',
    recommendingId: null, approvingId: '', formType: 'XX', issuingOffice: null,
  });
  expect(res.errors).toEqual({
    formType: 'Required', issuingOffice: 'Required', dateFiled: 'Required', destination: 'Required', purpose: 'Required',
    inclusiveFrom: 'Required', inclusiveTo: 'Required', departureAt: 'Required',
    recommendingId: 'Choose an active recommending signatory', approvingId: 'Choose an active approving signatory',
  });
  expect(await count()).toBe(0);
});

test('vehicle and return optional', async () => {
  const res = await create({});
  const [[row]] = await pool.query('SELECT vehicle, return_at FROM records WHERE id = ?', [res.data.id]);
  expect(row).toEqual({ vehicle: '', return_at: null });
});

test('employee list rules', async () => {
  expect((await create({ employeeIds: [] })).errors.employees).toBe('Add at least one employee');
  expect((await create({ employeeIds: ids.emps })).errors.employees).toBe('At most 5 employees');
  expect((await create({ employeeIds: [ids.emps[0], ids.emps[0]] })).errors.employees).toBe('Remove duplicate employees');
  await archiveEmployee(pool, { id: ids.emps[5] });
  expect((await create({ employeeIds: [ids.emps[5]] })).errors.employees).toBe('Choose active employees');
  expect((await create({ employeeIds: ids.emps.slice(0, 5) })).ok).toBe(true);
  expect(await count()).toBe(1);
});

test('date order rules', async () => {
  expect((await create({ inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-20' })).errors).toEqual({ inclusiveTo: 'End date is before start date' });
  expect((await create({ departureAt: '2026-11-20T08:00', returnAt: '2026-11-20T07:59' })).errors).toEqual({ returnAt: 'Return is before departure' });
});

test('signatory role and archive checks', async () => {
  expect((await create({ recommendingId: ids.appr })).errors).toEqual({ recommendingId: 'Choose an active recommending signatory' });
  await archiveSignatory(pool, { id: ids.appr });
  expect((await create({})).errors).toEqual({ approvingId: 'Choose an active approving signatory' });
});

test('snapshots survive later edits, in the given order', async () => {
  const res = await create({ employeeIds: [ids.emps[1], ids.emps[0]] });
  await updateEmployee(pool, { id: ids.emps[1], fullName: 'Renamed', designation: 'New', employmentStatus: 'Casual', officeId: ids.officeId });
  await updateSignatory(pool, { id: ids.appr, name: 'NEW MAYOR', title: 'ACTING MAYOR', role: 'approving' });
  const [rows] = await pool.query('SELECT position, full_name, designation, employment_status FROM record_employees WHERE record_id = ? ORDER BY position', [res.data.id]);
  expect(rows).toEqual([
    { position: 1, full_name: 'Emp 2', designation: 'Desig 2', employment_status: 'Permanent' },
    { position: 2, full_name: 'Emp 1', designation: 'Desig 1', employment_status: 'Permanent' },
  ]);
  const [[r]] = await pool.query('SELECT approving_name, approving_title, created_by FROM records WHERE id = ?', [res.data.id]);
  expect(r).toEqual({ approving_name: 'MAYOR', approving_title: 'MUNICIPAL MAYOR', created_by: ids.userId });
});

test('overlap warns, confirmOverlap saves', async () => {
  await create({ inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22' });
  const res = await create({ inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21' });
  expect(res).toEqual({
    ok: false, error: 'Overlapping records',
    overlaps: [{ employeeName: 'Emp 1', formType: 'PLS', number: '2026-11-1', inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22' }],
  });
  expect(await count()).toBe(1);
  expect((await create({ inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21', confirmOverlap: true })).data.number).toBe('2026-11-2');
});

test('overlap edges: same last day overlaps, next day does not, other employee or archived does not', async () => {
  await create({ inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22' });
  expect((await create({ inclusiveFrom: '2026-11-22', inclusiveTo: '2026-11-23' })).error).toBe('Overlapping records');
  expect((await create({ inclusiveFrom: '2026-11-23', inclusiveTo: '2026-11-24' })).ok).toBe(true);
  expect((await create({ employeeIds: [ids.emps[1]], inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21' })).ok).toBe(true);
  await pool.query('UPDATE records SET archived_at = NOW()');
  expect((await create({ inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21' })).ok).toBe(true);
});

test('a failed lock release after commit still reports success and does not block the counter', async () => {
  const realGet = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const conn = await realGet();
    const realQuery = conn.query.bind(conn);
    conn.query = (sql, ...rest) =>
      String(sql).startsWith('SELECT RELEASE_LOCK') ? Promise.reject(new Error('connection lost')) : realQuery(sql, ...rest);
    return conn;
  };
  const first = await create({});
  pool.getConnection = realGet;
  expect(first.ok).toBe(true);
  expect(first.data.number).toBe('2026-11-1');
  // Ask from a separate session: named locks are re-entrant, so the holder itself would not notice.
  const mysql = (await import('mysql2/promise')).default;
  const other = await mysql.createConnection(testConfig());
  let free = 0;
  for (let i = 0; i < 20 && free !== 1; i++) {
    [[{ free }]] = await other.query("SELECT IS_FREE_LOCK('plsto:PLS:MAYOR:2026-11') AS free");
    if (free !== 1) await new Promise((r) => setTimeout(r, 100));
  }
  await other.end();
  expect(free).toBe(1);
  expect(await numberOf({ employeeIds: [ids.emps[1]] })).toBe('2026-11-2');
}, 20000);

// ---------- Phase 2: purpose limit, blank forms ----------

const blank = (over = {}, now = NOV) =>
  issueBlank(pool, { formType: 'PLS', issuingOffice: 'MAYOR', recommendingId: ids.rec, approvingId: ids.appr, ...over }, { userId: ids.userId, now });
const details = (over = {}) => {
  const { formType, issuingOffice, recommendingId, approvingId, ...rest } = valid(over);
  return rest;
};
const fill = (id, over = {}) => fillBlank(pool, { id, ...details(over) }, { userId: ids.userId });

test('purpose: 360 characters ok, 361 rejected', async () => {
  expect((await create({ purpose: 'a'.repeat(361) })).errors).toEqual({ purpose: 'At most 360 characters' });
  expect((await create({ purpose: 'a'.repeat(360) })).ok).toBe(true);
});

test('blank and normal records share one counter', async () => {
  expect((await blank()).data.number).toBe('2026-11-1');
  expect(await numberOf({})).toBe('2026-11-2');
  expect((await blank({ issuingOffice: 'SB', formType: 'TO' })).data.number).toBe('SB 2026-11-1');
});

test('issueBlank stores status blank with no dates or employees', async () => {
  const { data } = await blank();
  const [[r]] = await pool.query('SELECT status, date_filed, inclusive_from, departure_at, destination, purpose, approving_name FROM records WHERE id = ?', [data.id]);
  expect(r).toEqual({ status: 'blank', date_filed: null, inclusive_from: null, departure_at: null, destination: '', purpose: '', approving_name: 'MAYOR' });
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM record_employees');
  expect(n).toBe(0);
});

test('issueBlank validates form, office and signatory roles', async () => {
  expect((await blank({ formType: 'XX', issuingOffice: 'CITY', recommendingId: ids.appr })).errors).toEqual({
    formType: 'Required', issuingOffice: 'Required', recommendingId: 'Choose an active recommending signatory',
  });
  expect(await count()).toBe(0);
});

test('listBlank lists blanks newest first and drops filled ones', async () => {
  const a = (await blank()).data;
  const b = (await blank({ formType: 'TO' })).data;
  const list = (await listBlank(pool)).data;
  expect(list.map((r) => r.number)).toEqual([b.number, a.number]);
  expect(list[0]).toMatchObject({ formType: 'TO', issuingOffice: 'MAYOR', approvingName: 'MAYOR', approvingTitle: 'MUNICIPAL MAYOR' });
  await fill(a.id);
  expect((await listBlank(pool)).data.map((r) => r.number)).toEqual([b.number]);
});

test('fillBlank keeps the number and printed signatories, ignores form, office and signatory changes', async () => {
  const { data } = await blank();
  const other = (await createSignatory(pool, { name: 'OTHER', title: 'ACTING MAYOR', role: 'approving' })).data.id;
  const res = await fillBlank(pool, { id: data.id, ...details(), formType: 'TO', issuingOffice: 'SB', approvingId: other }, { userId: ids.userId });
  expect(res).toEqual({ ok: true, data: { id: data.id, number: '2026-11-1', formType: 'PLS' } });
  const [[r]] = await pool.query('SELECT status, form_type, issuing_office, approving_name, destination, date_filed FROM records WHERE id = ?', [data.id]);
  expect(r).toEqual({ status: 'filled', form_type: 'PLS', issuing_office: 'MAYOR', approving_name: 'MAYOR', destination: 'Provincial Capitol', date_filed: '2026-11-20' });
  const [emps] = await pool.query('SELECT full_name FROM record_employees WHERE record_id = ?', [data.id]);
  expect(emps).toEqual([{ full_name: 'Emp 1' }]);
});

test('fillBlank uses the US-5 detail rules', async () => {
  const { data } = await blank();
  expect((await fill(data.id, { destination: '', employeeIds: [], purpose: 'a'.repeat(361) })).errors).toEqual({
    destination: 'Required', employees: 'Add at least one employee', purpose: 'At most 360 characters',
  });
});

test('fillBlank twice, or on a missing record, is refused', async () => {
  const { data } = await blank();
  expect((await fill(data.id)).ok).toBe(true);
  expect(await fill(data.id)).toEqual({ ok: false, error: 'This blank form is no longer available.' });
  expect(await fill(99999)).toEqual({ ok: false, error: 'This blank form is no longer available.' });
});

test('blank records never count as overlaps; filling one can warn', async () => {
  await blank();
  expect((await create({ inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22' })).ok).toBe(true);
  const { data } = await blank();
  const res = await fill(data.id, { inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21' });
  expect(res.error).toBe('Overlapping records');
  expect(res.overlaps.map((o) => o.number)).toEqual(['2026-11-2']);
  const [[r]] = await pool.query('SELECT status FROM records WHERE id = ?', [data.id]);
  expect(r.status).toBe('blank');
  expect((await fillBlank(pool, { id: data.id, ...details({ inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21' }), confirmOverlap: true }, { userId: ids.userId })).ok).toBe(true);
});

// ---------- Phase 3: list, get, edit, archive ----------

// A: PLS Mayor 2026-11-1 (Emp 1, MHO), B: TO SB SB 2026-11-1 (MARIA PEÑA, RHU), C: blank PLS 2026-11-2, D: archived PLS 2026-11-3.
async function seedList() {
  const rhu = (await createOffice(pool, { name: 'RHU' })).data.id;
  const pena = (await createEmployee(pool, { fullName: 'MARIA PEÑA', designation: 'Nurse', employmentStatus: 'Casual', officeId: rhu })).data.id;
  const a = (await create({ inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22', purpose: 'Submit 100% reports' })).data;
  const b = (await create({ formType: 'TO', issuingOffice: 'SB', employeeIds: [pena], destination: 'Manila', inclusiveFrom: '2026-11-23', inclusiveTo: '2026-11-24', purpose: 'Seminar' })).data;
  const c = (await blank()).data;
  const d = (await create({ employeeIds: [ids.emps[1]], destination: 'Cebu', inclusiveFrom: '2026-11-25', inclusiveTo: '2026-11-25' })).data;
  await pool.query('UPDATE records SET archived_at = NOW() WHERE id = ?', [d.id]);
  return { rhu, pena, a, b, c, d };
}
const numbers = async (filters) => (await listRecords(pool, filters)).data.rows.map((r) => r.number);

test('listRecords default is active (filled and blank), newest first', async () => {
  await seedList();
  expect(await numbers({})).toEqual(['2026-11-2', 'SB 2026-11-1', '2026-11-1']);
  const { rows, truncated } = (await listRecords(pool, {})).data;
  expect(truncated).toBe(false);
  expect(rows[1]).toEqual({
    id: expect.any(Number), number: 'SB 2026-11-1', formType: 'TO', issuingOffice: 'SB', status: 'filled', archived: false,
    names: 'MARIA PEÑA', destination: 'Manila', inclusiveFrom: '2026-11-23', inclusiveTo: '2026-11-24', dateFiled: '2026-11-20',
  });
  expect(rows[0]).toMatchObject({ status: 'blank', names: null, inclusiveFrom: null });
});

test('listRecords status filters', async () => {
  await seedList();
  expect(await numbers({ status: 'filled' })).toEqual(['SB 2026-11-1', '2026-11-1']);
  expect(await numbers({ status: 'blank' })).toEqual(['2026-11-2']);
  expect(await numbers({ status: 'archived' })).toEqual(['2026-11-3']);
  expect((await listRecords(pool, { status: 'archived' })).data.rows[0].archived).toBe(true);
});

test('listRecords search: number, employee name, destination, purpose, literal wildcards', async () => {
  await seedList();
  expect(await numbers({ search: '11-2' })).toEqual(['2026-11-2']);
  expect(await numbers({ search: 'SB 2026' })).toEqual(['SB 2026-11-1']);
  expect(await numbers({ search: 'peña' })).toEqual(['SB 2026-11-1']);
  expect(await numbers({ search: 'emp 1' })).toEqual(['2026-11-1']);
  expect(await numbers({ search: 'manila' })).toEqual(['SB 2026-11-1']);
  expect(await numbers({ search: 'seminar' })).toEqual(['SB 2026-11-1']);
  expect(await numbers({ search: '%' })).toEqual(['2026-11-1']);
  expect(await numbers({ search: '_' })).toEqual([]);
  expect(await numbers({ search: "o'brien" })).toEqual([]);
  expect(await numbers({ search: '  ' })).toEqual(['2026-11-2', 'SB 2026-11-1', '2026-11-1']);
});

test('listRecords form, issuing office and employee office filters', async () => {
  const s = await seedList();
  expect(await numbers({ formType: 'TO' })).toEqual(['SB 2026-11-1']);
  expect(await numbers({ formType: 'PLS' })).toEqual(['2026-11-2', '2026-11-1']);
  expect(await numbers({ issuingOffice: 'SB' })).toEqual(['SB 2026-11-1']);
  expect(await numbers({ officeId: s.rhu })).toEqual(['SB 2026-11-1']);
  expect(await numbers({ officeId: ids.officeId })).toEqual(['2026-11-1']);
  expect(await numbers({ officeId: 'x' })).toEqual(['2026-11-2', 'SB 2026-11-1', '2026-11-1']);
});

test('listRecords travel-date range overlaps inclusive dates; blanks never match', async () => {
  await seedList();
  expect(await numbers({ from: '2026-11-21', to: '2026-11-21' })).toEqual(['2026-11-1']);
  expect(await numbers({ from: '2026-11-22', to: '2026-11-23' })).toEqual(['SB 2026-11-1', '2026-11-1']);
  expect(await numbers({ from: '2026-11-23' })).toEqual(['SB 2026-11-1']);
  expect(await numbers({ to: '2026-11-19' })).toEqual([]);
  expect(await listRecords(pool, { from: '2026-11-22', to: '2026-11-21' })).toEqual({
    ok: false, error: 'Check the highlighted fields', errors: { to: 'End date is before start date' },
  });
});

test('listRecords returns the newest 200 and says when more match', async () => {
  const { a } = await seedList();
  const [[src]] = await pool.query('SELECT * FROM records WHERE id = ?', [a.id]);
  const { id, created_at, ...cols } = src;
  const rows = Array.from({ length: 198 }, (_, i) => Object.values({ ...cols, seq: 100 + i, number: `2026-11-${100 + i}` }));
  await pool.query(`INSERT INTO records (${Object.keys(cols).join(', ')}) VALUES ?`, [rows]);
  // 3 seeded active + 198 = 201 active rows
  const { data } = await listRecords(pool, {});
  expect(data.rows.length).toBe(200);
  expect(data.truncated).toBe(true);
  expect(data.rows[0].number).toBe('2026-11-297');
  expect((await listRecords(pool, { formType: 'TO' })).data.truncated).toBe(false);
});

test('getRecord returns the record with employees in position order', async () => {
  const r = (await create({ employeeIds: [ids.emps[2], ids.emps[0]] })).data;
  const { ok, data } = await getRecord(pool, r.id);
  expect(ok).toBe(true);
  expect(data).toMatchObject({ id: r.id, number: '2026-11-1', form_type: 'PLS', status: 'filled', approving_name: 'MAYOR' });
  expect(data.employees).toEqual([
    { employee_id: ids.emps[2], office_id: ids.officeId, full_name: 'Emp 3', designation: 'Desig 3', employment_status: 'Permanent' },
    { employee_id: ids.emps[0], office_id: ids.officeId, full_name: 'Emp 1', designation: 'Desig 1', employment_status: 'Permanent' },
  ]);
  expect(await getRecord(pool, 99999)).toEqual({ ok: false, error: 'Record not found' });
  expect(await getRecord(pool, 'x')).toEqual({ ok: false, error: 'Record not found' });
});

const edit = (id, over = {}) => updateRecord(pool, { id, ...details(over), recommendingId: ids.rec, approvingId: ids.appr, ...over });
const row = async (id) => (await pool.query('SELECT * FROM records WHERE id = ?', [id]))[0][0];
const savedNames = async (id) => (await pool.query('SELECT full_name FROM record_employees WHERE record_id = ? ORDER BY position', [id]))[0].map((r) => r.full_name);

test('updateRecord changes details and employees; number unchanged', async () => {
  const r = (await create({})).data;
  const res = await edit(r.id, {
    destination: 'Manila', inclusiveFrom: '2026-11-24', inclusiveTo: '2026-11-25', departureAt: '2026-11-24T06:30',
    returnAt: '2026-11-25T18:00', purpose: 'Training', vehicle: 'Service van', dateFiled: '2026-11-21', employeeIds: [ids.emps[1], ids.emps[0]],
  });
  expect(res).toEqual({ ok: true, data: { id: r.id, number: '2026-11-1', formType: 'PLS' } });
  expect(await row(r.id)).toMatchObject({
    number: '2026-11-1', destination: 'Manila', inclusive_from: '2026-11-24', inclusive_to: '2026-11-25', departure_at: '2026-11-24 06:30:00',
    return_at: '2026-11-25 18:00:00', purpose: 'Training', vehicle: 'Service van', date_filed: '2026-11-21',
  });
  expect(await savedNames(r.id)).toEqual(['Emp 2', 'Emp 1']);
});

test('updateRecord ignores number, form type, office and status in the payload', async () => {
  const r = (await create({})).data;
  expect((await edit(r.id, { formType: 'TO', issuingOffice: 'SB', number: '9999', status: 'blank', seq: 9, period: '2020-01' })).ok).toBe(true);
  expect(await row(r.id)).toMatchObject({ number: '2026-11-1', form_type: 'PLS', issuing_office: 'MAYOR', status: 'filled', seq: 1, period: '2026-11' });
});

test('updateRecord keeps archived-since employees and signatories with their saved details', async () => {
  const r = (await create({ employeeIds: [ids.emps[0]] })).data;
  await updateEmployee(pool, { id: ids.emps[0], fullName: 'Renamed', designation: 'X', employmentStatus: 'Casual', officeId: ids.officeId });
  await archiveEmployee(pool, { id: ids.emps[0] });
  await updateSignatory(pool, { id: ids.appr, name: 'NEW MAYOR NAME', title: 'MUNICIPAL MAYOR', role: 'approving' });
  await archiveSignatory(pool, { id: ids.appr });
  expect((await edit(r.id, { employeeIds: [ids.emps[0], ids.emps[1]], destination: 'Manila' })).ok).toBe(true);
  const [emps] = await pool.query('SELECT full_name, designation, employment_status FROM record_employees WHERE record_id = ? ORDER BY position', [r.id]);
  expect(emps).toEqual([
    { full_name: 'Emp 1', designation: 'Desig 1', employment_status: 'Permanent' },
    { full_name: 'Emp 2', designation: 'Desig 2', employment_status: 'Permanent' },
  ]);
  expect(await row(r.id)).toMatchObject({ approving_id: ids.appr, approving_name: 'MAYOR', destination: 'Manila' });
});

test('updateRecord: newly added people and signatories must be active and take current details', async () => {
  const r = (await create({})).data;
  await archiveEmployee(pool, { id: ids.emps[2] });
  expect((await edit(r.id, { employeeIds: [ids.emps[0], ids.emps[2]] })).errors).toEqual({ employees: 'Choose active employees' });
  const gone = (await createSignatory(pool, { name: 'OLD', title: 'OIC', role: 'approving' })).data.id;
  await archiveSignatory(pool, { id: gone });
  expect((await edit(r.id, { approvingId: gone, recommendingId: ids.appr })).errors).toEqual({
    approvingId: 'Choose an active approving signatory', recommendingId: 'Choose an active recommending signatory',
  });
  const acting = (await createSignatory(pool, { name: 'ACTING', title: 'ACTING MAYOR', role: 'approving' })).data.id;
  expect((await edit(r.id, { approvingId: acting })).ok).toBe(true);
  expect(await row(r.id)).toMatchObject({ approving_id: acting, approving_name: 'ACTING', approving_title: 'ACTING MAYOR', destination: 'Provincial Capitol' });
  expect(await savedNames(r.id)).toEqual(['Emp 1']);
});

test('updateRecord uses the US-5 validation', async () => {
  const r = (await create({})).data;
  expect((await edit(r.id, { destination: '', purpose: 'a'.repeat(361), departureAt: '2026-11-20T08:00', returnAt: '2026-11-20T07:00', employeeIds: [] })).errors).toEqual({
    destination: 'Required', purpose: 'At most 360 characters', returnAt: 'Return is before departure', employees: 'Add at least one employee',
  });
  expect(await row(r.id)).toMatchObject({ destination: 'Provincial Capitol' });
});

test('updateRecord overlap ignores the record itself and warns for others', async () => {
  const r = (await create({ inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22' })).data;
  expect((await edit(r.id, { inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-23' })).ok).toBe(true);
  await create({ employeeIds: [ids.emps[1]], inclusiveFrom: '2026-11-25', inclusiveTo: '2026-11-25' });
  const res = await edit(r.id, { employeeIds: [ids.emps[0], ids.emps[1]], inclusiveFrom: '2026-11-25', inclusiveTo: '2026-11-26' });
  expect(res.error).toBe('Overlapping records');
  expect(res.overlaps.map((o) => `${o.employeeName} ${o.number}`)).toEqual(['Emp 2 2026-11-2']);
  expect(await savedNames(r.id)).toEqual(['Emp 1']);
  expect((await edit(r.id, { employeeIds: [ids.emps[0], ids.emps[1]], inclusiveFrom: '2026-11-25', inclusiveTo: '2026-11-26', confirmOverlap: true })).ok).toBe(true);
  expect(await savedNames(r.id)).toEqual(['Emp 1', 'Emp 2']);
});

test('updateRecord refuses archived, blank and missing records', async () => {
  const refused = { ok: false, error: 'This record can no longer be edited.' };
  const r = (await create({})).data;
  await archiveRecord(pool, { id: r.id });
  expect(await edit(r.id, { destination: 'Manila' })).toEqual(refused);
  expect((await row(r.id)).destination).toBe('Provincial Capitol');
  expect(await edit((await blank()).data.id)).toEqual(refused);
  expect(await edit(99999)).toEqual(refused);
});

test('archive and restore; archived numbers are never reused; blanks can be archived', async () => {
  const r = (await create({})).data;
  expect(await archiveRecord(pool, { id: r.id })).toEqual({ ok: true, data: { id: r.id, number: '2026-11-1' } });
  expect(await numbers({})).toEqual([]);
  expect(await numbers({ status: 'archived' })).toEqual(['2026-11-1']);
  expect(await numberOf({ employeeIds: [ids.emps[1]] })).toBe('2026-11-2');
  expect(await restoreRecord(pool, { id: r.id })).toEqual({ ok: true, data: { id: r.id, number: '2026-11-1' } });
  expect(await numbers({})).toEqual(['2026-11-2', '2026-11-1']);
  const b = (await blank()).data;
  expect((await archiveRecord(pool, { id: b.id })).ok).toBe(true);
  expect(await numbers({ status: 'archived' })).toEqual(['2026-11-3']);
  expect((await blank()).data.number).toBe('2026-11-4');
  expect(await archiveRecord(pool, { id: 99999 })).toEqual({ ok: false, error: 'Record not found' });
  expect(await restoreRecord(pool, { id: 99999 })).toEqual({ ok: false, error: 'Record not found' });
});
