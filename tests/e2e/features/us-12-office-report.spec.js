import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchApp, loginAsChangedAdmin, seedDirectory, seedRecord, invoke, thisMonth, tableRows, mockSaveDialog, mockOpenPath, openedPaths } from '../helpers.js';

const ExcelJS = createRequire(import.meta.url)('exceljs'); // Playwright's ESM loader cannot import exceljs directly

test.describe('US-12 Per-office report and Excel export', () => {
  let app, page, pool, m;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    m = thisMonth();
    const seed = await seedDirectory(page, ['Ana Cruz', 'Ben Reyes', 'Carla Diaz']);
    const rhu = (await invoke(page, 'offices:create', { name: 'RHU' })).data.id;
    const pena = (await invoke(page, 'employees:create', { fullName: 'MARIA PEÑA', designation: 'Nurse', employmentStatus: 'Casual', officeId: rhu })).data.id;
    const e = seed.employees;
    const at = (from, to) => ({ inclusiveFrom: from, inclusiveTo: to, departureAt: `${from}T08:00` });
    // M-1 PLS: Ana + MARIA PEÑA, Nov 10-12. TO M-1: Ben, Nov 11. M-2 blank. M-3: Carla Nov 11, archived. M-4: Carla Dec 5.
    await seedRecord(page, seed, { employeeIds: [e['Ana Cruz'], pena], ...at('2026-11-10', '2026-11-12'), destination: 'Provincial Capitol' });
    await seedRecord(page, seed, { formType: 'TO', employeeIds: [e['Ben Reyes']], ...at('2026-11-11', '2026-11-11'), destination: 'Manila' });
    await invoke(page, 'records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', recommendingId: seed.signatories.deptHead, approvingId: seed.signatories.mayor });
    const archived = await seedRecord(page, seed, { employeeIds: [e['Carla Diaz']], ...at('2026-11-11', '2026-11-11'), destination: 'Cebu' });
    await invoke(page, 'records:archive', { id: archived.id });
    await seedRecord(page, seed, { employeeIds: [e['Carla Diaz']], ...at('2026-12-05', '2026-12-05'), destination: 'Baguio' });
    await page.getByRole('navigation').getByRole('button', { name: 'Reports' }).click();
    await page.getByRole('heading', { name: 'Reports' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const counts = () => page.getByRole('table', { name: 'Count per office' });
  const rows = () => page.getByRole('table', { name: 'Records' });
  const range = async (from, to) => {
    await page.getByLabel('Travel from').fill(from);
    await page.getByLabel('Travel to').fill(to);
  };
  const NOV = () => [
    `MHO | Ana Cruz | PLS | ${m}-1 | 2026-11-20 | 2026-11-10 to 2026-11-12 | Provincial Capitol`,
    `MHO | Ben Reyes | TO | ${m}-1 | 2026-11-20 | 2026-11-11 to 2026-11-11 | Manila`,
    `RHU | MARIA PEÑA | PLS | ${m}-1 | 2026-11-20 | 2026-11-10 to 2026-11-12 | Provincial Capitol`,
  ];

  test('the range defaults to the current month', async () => {
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    await expect(page.getByLabel('Travel from')).toHaveValue(`${ym}-01`);
    await expect(page.getByLabel('Travel to')).toHaveValue(`${ym}-${String(last).padStart(2, '0')}`);
  });

  test("the report shows each employee's records and a count per office and form type; archived and blank excluded", async () => {
    await range('2026-11-01', '2026-11-30');
    await expect.poll(() => tableRows(rows())).toEqual(NOV());
    await expect.poll(() => tableRows(counts())).toEqual(['MHO | 1 | 1', 'RHU | 1 | 0']);
    await expect(rows()).not.toContainText('Carla Diaz');
  });

  test('filters: office, form type, date range', async () => {
    await range('2026-11-01', '2026-11-30');
    await page.getByLabel('Form').selectOption('TO');
    await expect.poll(() => tableRows(rows())).toEqual([NOV()[1]]);
    await expect.poll(() => tableRows(counts())).toEqual(['MHO | 0 | 1']);
    await page.getByLabel('Form').selectOption('');
    await page.getByLabel('Office', { exact: true }).selectOption({ label: 'RHU' });
    await expect.poll(() => tableRows(rows())).toEqual([NOV()[2]]);
    await page.getByLabel('Office', { exact: true }).selectOption({ label: 'All' });
    await range('2026-12-01', '2026-12-31');
    await expect.poll(() => tableRows(rows())).toEqual([`MHO | Carla Diaz | PLS | ${m}-4 | 2026-11-20 | 2026-12-05 to 2026-12-05 | Baguio`]);
    await range('2026-11-12', '2026-11-12');
    await expect.poll(() => tableRows(rows())).toEqual([NOV()[0], NOV()[2]]);
  });

  test('a date range with end before start is rejected', async () => {
    await range('2026-11-12', '2026-11-11');
    await expect(page.locator('#rep-to-error')).toHaveText('End date is before start date');
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export to Excel' })).toBeDisabled();
  });

  test('a range with no records shows "No records found" and cannot be exported', async () => {
    await range('2026-10-01', '2026-10-31');
    await expect(page.getByText('No records found')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export to Excel' })).toBeDisabled();
  });

  test('Export saves the same rows as an .xlsx and Open file opens exactly that file', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-us12-')), 'report.xlsx');
    await mockSaveDialog(app, file);
    await mockOpenPath(app);
    await range('2026-11-01', '2026-11-30');
    await expect.poll(() => tableRows(rows())).toEqual(NOV());
    await page.getByRole('button', { name: 'Export to Excel' }).click();
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    const line = (n, cols) => Array.from({ length: cols }, (_, i) => ws.getRow(n).getCell(i + 1).text).join(' | ');
    expect(ws.getCell('A1').text).toBe('PLS and TO report, 2026-11-01 to 2026-11-30');
    expect([5, 6, 7].map((n) => line(n, 7))).toEqual(NOV());
    expect([11, 12].map((n) => line(n, 3))).toEqual(['MHO | 1 | 1', 'RHU | 1 | 0']);
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect.poll(() => openedPaths(app)).toEqual([file]);
  });
});
