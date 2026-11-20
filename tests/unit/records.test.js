import { test, expect, beforeEach, afterEach } from 'vitest';
import { freshTestDb } from '../helpers/testDb.js';
import { ensureAdmin } from '../../src/main/auth.js';
import { createOffice, createEmployee, archiveEmployee, updateEmployee } from '../../src/main/directory.js';
import { createSignatory, archiveSignatory, updateSignatory } from '../../src/main/signatories.js';
import { createRecord, formatNumber, periodOf } from '../../src/main/records.js';

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
