import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { freshTestDb } from '../helpers/testDb.js';
import { ensureAdmin } from '../../src/main/auth.js';
import { registerIpc, CHANNELS } from '../../src/main/ipc.js';

let pool, call;
beforeEach(async () => {
  pool = await freshTestDb();
  await ensureAdmin(pool);
  const handlers = {};
  registerIpc({ handle: (ch, fn) => (handlers[ch] = fn) }, pool);
  call = (sender, channel, payload) => handlers[channel]({ sender: { id: sender } }, payload);
});
afterEach(() => pool.end());

const loginChanged = async (sender) => {
  await call(sender, 'auth:login', { username: 'admin', password: 'admin' });
  return call(sender, 'auth:changePassword', { newPassword: 'Test-pass-123' });
};

test('preload allowlist matches CHANNELS', () => {
  const src = fs.readFileSync(new URL('../../src/main/preload.cjs', import.meta.url), 'utf8');
  const allowed = [...src.match(/const ALLOWED = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(allowed.sort()).toEqual([...CHANNELS].sort());
});

test('employees:list without login → Not logged in', async () => {
  expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Not logged in' });
});

test('bad login → Invalid username or password', async () => {
  expect(await call(1, 'auth:login', { username: 'admin', password: 'x' })).toEqual({
    ok: false, error: 'Invalid username or password',
  });
});

test('before password change → Change your password first', async () => {
  const res = await call(1, 'auth:login', { username: 'admin', password: 'admin' });
  expect(res.data.mustChangePassword).toBe(true);
  expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Change your password first' });
});

test('after changePassword, employees:list ok and me reflects it', async () => {
  expect(await loginChanged(1)).toEqual({ ok: true });
  expect(await call(1, 'employees:list', {})).toEqual({ ok: true, data: [] });
  expect((await call(1, 'auth:me')).data.mustChangePassword).toBe(false);
});

test('logout then employees:list → Not logged in', async () => {
  await loginChanged(1);
  await call(1, 'auth:logout');
  expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Not logged in' });
  expect(await call(1, 'auth:me')).toEqual({ ok: true, data: null });
});

test('sessions are per sender', async () => {
  await loginChanged(1);
  expect(await call(2, 'employees:list', {})).toEqual({ ok: false, error: 'Not logged in' });
});

test('changePassword without login → Not logged in', async () => {
  expect(await call(1, 'auth:changePassword', { newPassword: 'Test-pass-123' })).toEqual({
    ok: false, error: 'Not logged in',
  });
});

test('thrown error → generic message', async () => {
  await loginChanged(1);
  await pool.query('RENAME TABLE employees TO employees_gone'); // breaks the query; FKs block DROP
  const orig = console.error;
  console.error = () => {};
  try {
    expect(await call(1, 'employees:list', {})).toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
  } finally {
    console.error = orig;
    await pool.query('RENAME TABLE employees_gone TO employees'); // later tests reuse this database
  }
});

test('records:create needs a changed password, then saves with the session user', async () => {
  await call(1, 'auth:login', { username: 'admin', password: 'admin' });
  expect(await call(1, 'records:create', {})).toEqual({ ok: false, error: 'Change your password first' });
  await call(1, 'auth:changePassword', { newPassword: 'Test-pass-123' });
  const officeId = (await call(1, 'offices:create', { name: 'MHO' })).data.id;
  const emp = (await call(1, 'employees:create', { fullName: 'Ana', employmentStatus: 'Casual', officeId })).data.id;
  const rec = (await call(1, 'signatories:create', { name: 'R', title: 'DEPARTMENT HEAD', role: 'recommending' })).data.id;
  const appr = (await call(1, 'signatories:create', { name: 'A', title: 'MUNICIPAL MAYOR', role: 'approving' })).data.id;
  await call(1, 'signatories:setDefault', { issuingOffice: 'MAYOR', role: 'approving', signatoryId: appr });
  expect((await call(1, 'signatories:defaults')).data.MAYOR.approving).toBe(appr);
  const res = await call(1, 'records:create', {
    formType: 'TO', issuingOffice: 'MAYOR', dateFiled: '2026-11-20', employeeIds: [emp], destination: 'Capitol',
    inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-20', departureAt: '2026-11-20T08:00', purpose: 'Meeting',
    recommendingId: rec, approvingId: appr,
  });
  expect(res.data.number).toMatch(/^\d{4}-\d{2}-1$/);
  const [[row]] = await pool.query('SELECT created_by FROM records');
  const [[admin]] = await pool.query("SELECT id FROM users WHERE username = 'admin'");
  expect(row.created_by).toBe(admin.id);
});

// ---------- Phase 2: printing and blank forms (dialog/shell faked at the OS boundary) ----------

async function printSetup({ dialogResult } = {}) {
  const os2 = await import('node:os');
  const pathMod = await import('node:path');
  const fsMod = await import('node:fs');
  const dir = fsMod.mkdtempSync(pathMod.join(os2.tmpdir(), 'plsto-print-'));
  const opened = [];
  const dialogs = [];
  const handlers = {};
  registerIpc({ handle: (ch, fn) => (handlers[ch] = fn) }, pool, {
    documentsDir: dir,
    showSaveDialog: async (opts) => {
      dialogs.push(opts);
      return dialogResult ?? { canceled: false, filePath: pathMod.join(dir, 'out.xlsx') };
    },
    openPath: async (f) => { opened.push(f); return ''; },
  });
  const c = (channel, payload) => handlers[channel]({ sender: { id: 1 } }, payload);
  await c('auth:login', { username: 'admin', password: 'admin' });
  await c('auth:changePassword', { newPassword: 'Test-pass-123' });
  const officeId = (await c('offices:create', { name: 'MHO' })).data.id;
  const emp = (await c('employees:create', { fullName: 'Ana', employmentStatus: 'Casual', officeId })).data.id;
  const rec = (await c('signatories:create', { name: 'R', title: 'DEPARTMENT HEAD', role: 'recommending' })).data.id;
  const appr = (await c('signatories:create', { name: 'A', title: 'MUNICIPAL MAYOR', role: 'approving' })).data.id;
  const saved = await c('records:create', {
    formType: 'PLS', issuingOffice: 'MAYOR', dateFiled: '2026-11-20', employeeIds: [emp], destination: 'Capitol',
    inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-20', departureAt: '2026-11-20T08:00', purpose: 'Meeting',
    recommendingId: rec, approvingId: appr,
  });
  return { c, dir, opened, dialogs, recordId: saved.data.id, number: saved.data.number, rec, appr, fsMod, pathMod };
}

test('records:print writes a readable xlsx to the chosen path and openExport opens exactly that file', async () => {
  const { c, dir, opened, dialogs, recordId, number, fsMod, pathMod } = await printSetup();
  const res = await c('records:print', { id: recordId });
  const file = pathMod.join(dir, 'out.xlsx');
  expect(res).toEqual({ ok: true, data: { path: file } });
  expect(dialogs[0].defaultPath).toBe(pathMod.join(dir, `PLS ${number}.xlsx`));
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fsMod.readFileSync(file));
  expect(wb.worksheets[0].getCell('A12').text).toBe(`PLS NO: ${number}`);
  expect(await c('records:openExport', { path: 'C:/Windows/System32/calc.exe' })).toEqual({ ok: true });
  expect(opened).toEqual([file]);
});

test('records:openExport before any print → Nothing to open yet.', async () => {
  const { c, opened } = await printSetup();
  expect(await c('records:openExport', {})).toEqual({ ok: false, error: 'Nothing to open yet.' });
  expect(opened).toEqual([]);
});

test('records:print cancelled writes nothing', async () => {
  const { c, dir, recordId, fsMod } = await printSetup({ dialogResult: { canceled: true } });
  expect(await c('records:print', { id: recordId })).toEqual({ ok: true, data: { canceled: true } });
  expect(fsMod.readdirSync(dir)).toEqual([]);
});

test('records:print write failure gives the exact message and leaves the record unchanged', async () => {
  const { c, recordId } = await printSetup({ dialogResult: { canceled: false, filePath: 'Z:/no/such/folder/out.xlsx' } });
  const [[before]] = await pool.query('SELECT * FROM records WHERE id = ?', [recordId]);
  expect(await c('records:print', { id: recordId })).toEqual({
    ok: false, error: 'Could not save the file. If it is open in Excel, close it and try again.',
  });
  const [[after]] = await pool.query('SELECT * FROM records WHERE id = ?', [recordId]);
  expect(after).toEqual(before);
});

test('records:print refuses an archived record', async () => {
  const { c, recordId, dialogs } = await printSetup();
  await pool.query('UPDATE records SET archived_at = NOW()');
  expect(await c('records:print', { id: recordId })).toEqual({ ok: false, error: 'Restore this record before printing.' });
  expect(dialogs).toEqual([]);
});

test('blank-form routes issue, list and fill', async () => {
  const { c, rec, appr } = await printSetup();
  const issued = await c('records:issueBlank', { formType: 'TO', issuingOffice: 'SB', recommendingId: rec, approvingId: appr });
  expect(issued.data.numbers).toEqual([expect.stringMatching(/^SB \d{4}-\d{2}-1$/)]);
  expect((await c('records:listBlank')).data.map((r) => r.id)).toEqual(issued.data.ids);
});

test('records:preview returns the form for a saved record and refuses an archived one', async () => {
  const { c, recordId } = await printSetup();
  const res = await c('records:preview', { id: recordId });
  expect(res.ok).toBe(true);
  expect(res.data.rows).toHaveLength(48);
  await pool.query('UPDATE records SET archived_at = NOW()');
  expect(await c('records:preview', { id: recordId })).toEqual({ ok: false, error: 'Restore this record before printing.' });
});

// ---------- Phase 3: browse, edit, archive ----------

test('browse and edit routes need a changed password', async () => {
  await call(1, 'auth:login', { username: 'admin', password: 'admin' });
  for (const ch of ['records:list', 'records:get', 'records:update', 'records:archive', 'records:restore']) {
    expect(await call(1, ch, {})).toEqual({ ok: false, error: 'Change your password first' });
  }
});

test('records list, get, update, archive and restore round trip', async () => {
  const { c, recordId, number, rec, appr } = await printSetup();
  expect((await c('records:list', {})).data.rows.map((r) => r.number)).toEqual([number]);
  const got = (await c('records:get', { id: recordId })).data;
  expect(got.employees.map((e) => e.full_name)).toEqual(['Ana']);
  const upd = await c('records:update', {
    id: recordId, dateFiled: '2026-11-20', employeeIds: [got.employees[0].employee_id], destination: 'Manila',
    inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-20', departureAt: '2026-11-20T08:00', purpose: 'Meeting',
    recommendingId: rec, approvingId: appr,
  });
  expect(upd).toEqual({ ok: true, data: { id: recordId, number, formType: 'PLS' } });
  expect((await c('records:list', { search: 'manila' })).data.rows.map((r) => r.id)).toEqual([recordId]);
  expect((await c('records:archive', { id: recordId })).ok).toBe(true);
  expect((await c('records:list', {})).data.rows).toEqual([]);
  expect((await c('records:restore', { id: recordId })).ok).toBe(true);
  expect((await c('records:list', {})).data.rows.map((r) => r.id)).toEqual([recordId]);
});

// ---------- Phase 4: out today and reports ----------

test('report routes need a changed password', async () => {
  await call(1, 'auth:login', { username: 'admin', password: 'admin' });
  for (const ch of ['reports:out', 'reports:office', 'reports:export']) {
    expect(await call(1, ch, {})).toEqual({ ok: false, error: 'Change your password first' });
  }
});

test('reports:out and reports:office return the saved record', async () => {
  const { c, number } = await printSetup();
  expect((await c('reports:out', { date: '2026-11-20' })).data.map((r) => r.number)).toEqual([number]);
  expect((await c('reports:office', { from: '2026-11-01', to: '2026-11-30' })).data.counts).toEqual([{ officeName: 'MHO', PLS: 1, TO: 0 }]);
});

test('reports:export writes a readable file that openExport then opens; cancel and bad range write nothing', async () => {
  const { c, dir, opened, dialogs, fsMod, pathMod } = await printSetup();
  const res = await c('reports:export', { from: '2026-11-01', to: '2026-11-30' });
  expect(res).toEqual({ ok: true, data: { path: pathMod.join(dir, 'out.xlsx') } });
  expect(pathMod.basename(dialogs[0].defaultPath)).toBe('PLS-TO report 2026-11-01 to 2026-11-30.xlsx');
  expect(fsMod.readFileSync(res.data.path).subarray(0, 2).toString()).toBe('PK');
  expect(await c('records:openExport')).toEqual({ ok: true });
  expect(opened).toEqual([res.data.path]);
  expect((await c('reports:export', { from: '2026-11-02', to: '2026-11-01' })).errors).toEqual({ to: 'End date is before start date' });
  expect(dialogs).toHaveLength(1);
});

test('reports:export cancelled writes nothing', async () => {
  const { c, dir, fsMod } = await printSetup({ dialogResult: { canceled: true } });
  expect(await c('reports:export', { from: '2026-11-01', to: '2026-11-30' })).toEqual({ ok: true, data: { canceled: true } });
  expect(fsMod.readdirSync(dir)).toEqual([]);
});

// ---------- Phase 8: blank stacks ----------

test('blank stack routes need a changed password', async () => {
  await call(1, 'auth:login', { username: 'admin', password: 'admin' });
  for (const ch of ['records:nextNumbers', 'records:findBlank', 'records:unusedBlanks', 'records:deleteUnusedBlanks']) {
    expect(await call(1, ch, {})).toEqual({ ok: false, error: 'Change your password first' });
  }
});

test('issue a stack, see the estimate, find a number, print all pages into one file', async () => {
  const { c, appr, dialogs, fsMod, pathMod } = await printSetup(); // one filled PLS already: <month>-1
  const est = (await c('records:nextNumbers', { formType: 'PLS', issuingOffice: 'MAYOR', count: 3 })).data;
  const issued = await c('records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', approvingId: appr, count: 3 });
  expect(issued.data.numbers).toEqual([est.first, issued.data.numbers[1], est.last]);
  expect((await c('records:findBlank', { formType: 'PLS', number: issued.data.numbers[1] })).data.id).toBe(issued.data.ids[1]);
  const res = await c('records:print', { ids: issued.data.ids });
  expect(pathMod.basename(dialogs[0].defaultPath)).toBe(`PLS ${est.first} to ${est.last}.xlsx`);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fsMod.readFileSync(res.data.path));
  expect(wb.worksheets.map((w) => w.name)).toEqual(issued.data.numbers);
});

test('records:print refuses a stack with an archived record, and more than 50 ids, before any dialog', async () => {
  const { c, appr, dialogs } = await printSetup();
  const { ids } = (await c('records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', approvingId: appr, count: 2 })).data;
  await c('records:archive', { id: ids[1] });
  expect(await c('records:print', { ids })).toEqual({ ok: false, error: 'Restore this record before printing.' });
  expect(await c('records:print', { ids: Array(51).fill(ids[0]) })).toEqual({ ok: false, error: 'Choose 1 to 50 forms to print.' });
  expect(dialogs).toHaveLength(0);
});

test('unused blanks of the current month are listed nowhere and cannot be deleted', async () => {
  const { c, appr } = await printSetup();
  await c('records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', approvingId: appr, count: 2 });
  expect(await c('records:unusedBlanks', {})).toEqual({ ok: true, data: [] });
  const d = new Date();
  const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  expect(await c('records:deleteUnusedBlanks', { period })).toEqual({ ok: false, error: 'Only blanks of a past month can be deleted.' });
});
