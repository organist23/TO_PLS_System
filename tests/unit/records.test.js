import { test, expect, beforeEach, afterEach } from 'vitest';
import { freshTestDb, testConfig } from '../helpers/testDb.js';
import { ensureAdmin } from '../../src/main/auth.js';
import { createOffice, createEmployee, archiveEmployee, updateEmployee } from '../../src/main/directory.js';
import { createSignatory, archiveSignatory, updateSignatory } from '../../src/main/signatories.js';
import { createRecord, formatNumber, periodOf, issueBlank, listBlank, fillBlank } from '../../src/main/records.js';

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
