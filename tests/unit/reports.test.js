import { test, expect, beforeEach, afterEach } from 'vitest';
import { freshTestDb } from '../helpers/testDb.js';
import { ensureAdmin } from '../../src/main/auth.js';
import { createOffice, createEmployee, archiveEmployee, updateEmployee, archiveOffice } from '../../src/main/directory.js';
import { createSignatory } from '../../src/main/signatories.js';
import { createRecord, issueBlank, archiveRecord } from '../../src/main/records.js';
import { outOn, officeReport } from '../../src/main/reports.js';

let pool, ids;
const NOV = new Date(2026, 10, 20, 9, 0);

// MHO: Ana, Ben. RHU: Carla.
// A = PLS 2026-11-1, Ana + Carla, 11-20..11-22, return 11-22 17:00. B = TO 2026-11-1, Ben, 11-21.
// C = blank PLS 2026-11-2. D = PLS 2026-11-3, Ben, 11-21, archived.
beforeEach(async () => {
  pool = await freshTestDb();
  await ensureAdmin(pool);
  const mho = (await createOffice(pool, { name: 'MHO' })).data.id;
  const rhu = (await createOffice(pool, { name: 'RHU' })).data.id;
  const emp = async (fullName, officeId) => (await createEmployee(pool, { fullName, designation: 'Clerk', employmentStatus: 'Permanent', officeId })).data.id;
  const ana = await emp('Ana', mho);
  const ben = await emp('Ben', mho);
  const carla = await emp('Carla', rhu);
  const rec = (await createSignatory(pool, { name: 'HEAD', title: 'DEPARTMENT HEAD', role: 'recommending' })).data.id;
  const appr = (await createSignatory(pool, { name: 'MAYOR', title: 'MUNICIPAL MAYOR', role: 'approving' })).data.id;
  const [[{ id: userId }]] = await pool.query('SELECT id FROM users');
  const create = async (over) => (await createRecord(pool, {
    formType: 'PLS', issuingOffice: 'MAYOR', dateFiled: '2026-11-19', destination: 'Capitol', vehicle: '',
    inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21', departureAt: '2026-11-21T08:00', returnAt: '', purpose: 'Meeting',
    recommendingId: rec, approvingId: appr, confirmOverlap: true, ...over,
  }, { userId, now: NOV })).data;
  const a = await create({ employeeIds: [ana, carla], inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22', returnAt: '2026-11-22T17:00', destination: 'Provincial Capitol' });
  const b = await create({ formType: 'TO', employeeIds: [ben], destination: 'Manila' });
  const c = (await issueBlank(pool, { formType: 'PLS', issuingOffice: 'MAYOR', recommendingId: rec, approvingId: appr }, { userId, now: NOV })).data;
  const d = await create({ employeeIds: [ben], destination: 'Cebu' });
  await archiveRecord(pool, { id: d.id });
  ids = { mho, rhu, ana, ben, carla, a, b, c, d };
});
afterEach(() => pool.end());

const who = async (date, officeId) => (await outOn(pool, { date, officeId })).data.map((r) => `${r.officeName} ${r.fullName} ${r.formType} ${r.number}`);

test('outOn lists every employee on an active filled record that includes the date, by office then name', async () => {
  expect(await who('2026-11-21')).toEqual(['MHO Ana PLS 2026-11-1', 'MHO Ben TO 2026-11-1', 'RHU Carla PLS 2026-11-1']);
  const [ana] = (await outOn(pool, { date: '2026-11-21' })).data;
  expect(ana).toEqual({
    recordId: ids.a.id, number: '2026-11-1', formType: 'PLS', fullName: 'Ana', officeId: ids.mho, officeName: 'MHO',
    destination: 'Provincial Capitol', returnAt: '2026-11-22 17:00:00', inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22',
  });
  expect((await outOn(pool, { date: '2026-11-21' })).data[1].returnAt).toBeNull();
});

test('outOn covers the first, middle and last day only', async () => {
  expect(await who('2026-11-19')).toEqual([]);
  expect(await who('2026-11-20')).toEqual(['MHO Ana PLS 2026-11-1', 'RHU Carla PLS 2026-11-1']);
  expect(await who('2026-11-22')).toEqual(['MHO Ana PLS 2026-11-1', 'RHU Carla PLS 2026-11-1']);
  expect(await who('2026-11-23')).toEqual([]);
});

test('outOn office filter keeps only that office; bad ids mean no filter', async () => {
  expect(await who('2026-11-21', ids.rhu)).toEqual(['RHU Carla PLS 2026-11-1']);
  expect(await who('2026-11-21', 'x')).toHaveLength(3);
});

test('outOn keeps saved names after the employee is renamed and archived, and archived offices', async () => {
  await updateEmployee(pool, { id: ids.ana, fullName: 'Ana X', designation: 'Clerk', employmentStatus: 'Permanent', officeId: ids.mho });
  await archiveEmployee(pool, { id: ids.ana });
  await archiveEmployee(pool, { id: ids.carla });
  await archiveOffice(pool, { id: ids.rhu });
  expect(await who('2026-11-21')).toEqual(['MHO Ana PLS 2026-11-1', 'MHO Ben TO 2026-11-1', 'RHU Carla PLS 2026-11-1']);
});

test('outOn rejects an invalid date', async () => {
  expect(await outOn(pool, { date: '2026-02-30' })).toEqual({ ok: false, error: 'Check the highlighted fields', errors: { date: 'Enter a valid date' } });
  expect((await outOn(pool, {})).errors).toEqual({ date: 'Enter a valid date' });
});

const report = (over = {}) => officeReport(pool, { from: '2026-11-01', to: '2026-11-30', ...over });
const lines = (rows) => rows.map((r) => `${r.officeName} ${r.fullName} ${r.formType} ${r.number}`);

test('officeReport rows per employee and record, counts per office and form type', async () => {
  const { data } = await report();
  expect(lines(data.rows)).toEqual(['MHO Ana PLS 2026-11-1', 'MHO Ben TO 2026-11-1', 'RHU Carla PLS 2026-11-1']);
  expect(data.rows[0]).toEqual({
    recordId: ids.a.id, number: '2026-11-1', formType: 'PLS', fullName: 'Ana', officeName: 'MHO', dateFiled: '2026-11-19',
    inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22', destination: 'Provincial Capitol',
  });
  expect(data.counts).toEqual([{ officeName: 'MHO', PLS: 1, TO: 1 }, { officeName: 'RHU', PLS: 1, TO: 0 }]);
});

test('officeReport filters by form type, office and travel-date overlap', async () => {
  let { data } = await report({ formType: 'TO' });
  expect(lines(data.rows)).toEqual(['MHO Ben TO 2026-11-1']);
  expect(data.counts).toEqual([{ officeName: 'MHO', PLS: 0, TO: 1 }]);
  ({ data } = await report({ officeId: ids.rhu }));
  expect(lines(data.rows)).toEqual(['RHU Carla PLS 2026-11-1']);
  ({ data } = await report({ from: '2026-11-22', to: '2026-11-30' }));
  expect(lines(data.rows)).toEqual(['MHO Ana PLS 2026-11-1', 'RHU Carla PLS 2026-11-1']);
  expect(await report({ from: '2026-11-23', to: '2026-11-30' })).toEqual({ ok: true, data: { rows: [], counts: [] } });
});

test('officeReport counts a record with two employees of one office once', async () => {
  await pool.query('UPDATE record_employees SET office_id = ? WHERE record_id = ?', [ids.mho, ids.a.id]);
  expect((await report()).data.counts).toEqual([{ officeName: 'MHO', PLS: 1, TO: 1 }]);
});

test('officeReport rejects a missing, invalid or reversed range', async () => {
  expect((await officeReport(pool, {})).errors).toEqual({ from: 'Required', to: 'Required' });
  expect((await report({ from: '2026-13-01' })).errors).toEqual({ from: 'Enter a valid date' });
  expect(await report({ from: '2026-11-22', to: '2026-11-21' })).toEqual({
    ok: false, error: 'Check the highlighted fields', errors: { to: 'End date is before start date' },
  });
});
