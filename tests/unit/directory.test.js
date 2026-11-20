import { test, expect, beforeEach, afterEach } from 'vitest';
import { freshTestDb } from '../helpers/testDb.js';
import * as d from '../../src/main/directory.js';

let pool;
beforeEach(async () => (pool = await freshTestDb()));
afterEach(() => pool.end());

const office = async (name) => (await d.createOffice(pool, { name })).data.id;
const emp = (officeId, fullName, extra = {}) =>
  d.createEmployee(pool, { fullName, designation: 'Clerk', employmentStatus: 'Permanent', officeId, ...extra });
const names = (res) => res.data.map((r) => r.fullName ?? r.name);

test('office name required', async () => {
  expect(await d.createOffice(pool, { name: '  ' })).toEqual({ ok: false, error: 'Check the highlighted fields', errors: { name: 'Required' } });
});

test('office duplicate ignores case and spaces', async () => {
  await office('MHO');
  for (const name of ['MHO', ' mho ']) {
    expect((await d.createOffice(pool, { name })).errors).toEqual({ name: 'An office with this name already exists' });
  }
});

test('office rename', async () => {
  const id = await office('MHO');
  expect((await d.updateOffice(pool, { id, name: 'Municipal Health Office' })).ok).toBe(true);
  expect(names(await d.listOffices(pool, {}))).toEqual(['Municipal Health Office']);
});

test('office archive blocked while it has active employees', async () => {
  const id = await office('MHO');
  const a = (await emp(id, 'Ana Cruz')).data.id;
  const b = (await emp(id, 'Ben Reyes')).data.id;
  expect(await d.archiveOffice(pool, { id })).toEqual({ ok: false, error: 'Move or archive its 2 employees first.' });
  await d.archiveEmployee(pool, { id: a });
  await d.archiveEmployee(pool, { id: b });
  expect((await d.archiveOffice(pool, { id })).ok).toBe(true);
  expect(names(await d.listOffices(pool, {}))).toEqual([]);
  expect(names(await d.listOffices(pool, { archived: true }))).toEqual(['MHO']);
  await d.restoreOffice(pool, { id });
  expect(names(await d.listOffices(pool, {}))).toEqual(['MHO']);
});

test('listOffices counts active employees', async () => {
  const id = await office('MHO');
  await emp(id, 'Ana Cruz');
  expect((await d.listOffices(pool, {})).data[0].activeEmployees).toBe(1);
});

test('employee validation messages', async () => {
  const id = await office('MHO');
  const archived = await office('OLD');
  await d.archiveOffice(pool, { id: archived });
  expect((await emp(id, '  ')).errors).toEqual({ fullName: 'Required' });
  expect((await emp(null, 'Ana')).errors).toEqual({ officeId: 'Required' });
  expect((await emp(archived, 'Ana')).errors).toEqual({ officeId: 'Choose an active office' });
  expect((await emp(id, 'Ana', { employmentStatus: 'Regular' })).errors).toEqual({ employmentStatus: 'Choose a status' });
});

test('all 5 employment statuses accepted', async () => {
  const id = await office('MHO');
  for (const s of ['Permanent', 'Casual', 'Coterminous', 'Contractual', 'Job Order']) {
    expect((await emp(id, `Emp ${s}`, { employmentStatus: s })).ok).toBe(true);
  }
});

test('employee duplicate ignores case and spaces, same name in another office ok', async () => {
  const a = await office('MHO');
  const b = await office('MEO');
  await emp(a, 'Juan Dela Cruz');
  expect((await emp(a, '  JUAN DELA CRUZ ')).errors).toEqual({ fullName: 'This employee already exists in this office' });
  expect((await emp(b, 'Juan Dela Cruz')).ok).toBe(true);
});

test('update employee', async () => {
  const id = await office('MHO');
  const e = (await emp(id, 'Ana Cruz')).data.id;
  const res = await d.updateEmployee(pool, { id: e, fullName: 'Ana Cruz-Lim', designation: 'Nurse', employmentStatus: 'Casual', officeId: id });
  expect(res.ok).toBe(true);
  expect((await d.listEmployees(pool, {})).data[0]).toMatchObject({
    fullName: 'Ana Cruz-Lim', designation: 'Nurse', employmentStatus: 'Casual', officeName: 'MHO',
  });
});

test('ñ round-trip and case-insensitive search', async () => {
  const id = await office('MHO');
  await emp(id, 'MARIA PEÑA');
  await emp(id, 'Pedro Santos');
  expect(names(await d.listEmployees(pool, { search: 'peña' }))).toEqual(['MARIA PEÑA']);
});

test('search treats % _ and quotes literally', async () => {
  const id = await office('MHO');
  await emp(id, 'A%B');
  await emp(id, 'AXB');
  expect(names(await d.listEmployees(pool, { search: '%' }))).toEqual(['A%B']);
  expect(names(await d.listEmployees(pool, { search: '_' }))).toEqual([]);
  expect(names(await d.listEmployees(pool, { search: "O'Brien" }))).toEqual([]);
});

test('filter by office', async () => {
  const a = await office('MHO');
  const b = await office('MEO');
  await emp(a, 'Ana Cruz');
  await emp(b, 'Ben Reyes');
  expect(names(await d.listEmployees(pool, { officeId: b }))).toEqual(['Ben Reyes']);
});

test('archive and restore employee', async () => {
  const id = await office('MHO');
  const e = (await emp(id, 'Ana Cruz')).data.id;
  await d.archiveEmployee(pool, { id: e });
  expect(names(await d.listEmployees(pool, {}))).toEqual([]);
  expect(names(await d.listEmployees(pool, { archived: true }))).toEqual(['Ana Cruz']);
  await d.restoreEmployee(pool, { id: e });
  expect(names(await d.listEmployees(pool, {}))).toEqual(['Ana Cruz']);
});

test('restore employee blocked while office archived', async () => {
  const id = await office('MHO');
  const e = (await emp(id, 'Ana Cruz')).data.id;
  await d.archiveEmployee(pool, { id: e });
  await d.archiveOffice(pool, { id });
  expect(await d.restoreEmployee(pool, { id: e })).toEqual({ ok: false, error: 'Restore its office first.' });
});

test('archived employee row keeps its office (archive is not delete)', async () => {
  const id = await office('MHO');
  const e = (await emp(id, 'Ana Cruz')).data.id;
  await d.archiveEmployee(pool, { id: e });
  const [[row]] = await pool.query('SELECT office_id, archived_at FROM employees WHERE id = ?', [e]);
  expect(row.office_id).toBe(id);
  expect(row.archived_at).not.toBeNull();
});
