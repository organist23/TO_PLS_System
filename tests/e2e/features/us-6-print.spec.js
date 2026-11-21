import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(import.meta.url)('exceljs'); // Playwright's ESM loader cannot import exceljs directly
import { launchApp, loginAsChangedAdmin, seedDirectory, thisMonth, mockSaveDialog, mockOpenPath, openedPaths } from '../helpers.js';

const readSheet = async (file) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets[0];
};

test.describe('US-6 Print a filled form as .xlsx', () => {
  let app, page, pool, dir;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-us6-'));
    await loginAsChangedAdmin(page);
    await seedDirectory(page, ['MARIA PEÑA']);
    await mockOpenPath(app);
    await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
    await page.getByRole('heading', { name: 'New record' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });

  async function saveRecord() {
    await page.getByLabel('Date filed').fill('2026-11-21');
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'MARIA PEÑA — MHO' });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Provincial Capitol, Bayombong');
    await page.getByLabel('Inclusive from').fill('2026-11-20');
    await page.getByLabel('Inclusive to').fill('2026-11-22');
    await page.getByLabel('Departure').fill('2026-11-20T08:00');
    await page.getByLabel('Purpose').fill('Submit quarterly reports');
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${thisMonth()}-1`);
  }

  test('Print writes the record into the official template at the chosen path', async () => {
    const file = path.join(dir, 'out.xlsx');
    await mockSaveDialog(app, file);
    await saveRecord();
    await button('Print').click();
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    const ws = await readSheet(file);
    const t = (a) => ws.getCell(a).text;
    expect(t('A12')).toBe(`PLS NO: ${thisMonth()}-1`);
    expect(t('H12')).toBe('DATE: November 21, 2026');
    expect([t('A14'), t('E14'), t('H14')]).toEqual(['MARIA PEÑA', 'Clerk', 'Permanent']);
    expect(t('A20')).toBe('DESTINATION: Provincial Capitol, Bayombong');
    expect(t('A21')).toBe('INCLUSIVE DATE(S): November 20-22, 2026');
    expect(t('A22')).toBe('DEPARTURE: November 20, 2026');
    expect(t('G22')).toBe('TIME: 8:00 AM');
    expect(t('A24')).toBe('PURPOSE(S): Submit quarterly reports');
    expect([t('A31'), t('A32')]).toEqual(['JUAN P. SANTOS', 'DEPARTMENT HEAD']);
    expect([t('A37'), t('A38')]).toEqual(['VINCENT E. HERMOSO', 'OIC - MUNICIPAL MAYOR']);
    expect(ws.getImages()).toHaveLength(1);
    expect(ws.pageSetup).toMatchObject({ fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9, orientation: 'portrait' });
  });

  test('empty vehicle and return keep the blank lines', async () => {
    const file = path.join(dir, 'out.xlsx');
    await mockSaveDialog(app, file);
    await saveRecord();
    await button('Print').click();
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    const ws = await readSheet(file);
    expect(ws.getCell('F21').text).toBe('VEHICLE:');
    expect(ws.getCell('A23').text).toMatch(/^ RETURN:_+$/);
    expect(ws.getCell('G23').text).toMatch(/^TIME:_+$/);
  });

  test('Open file opens exactly the saved file', async () => {
    const file = path.join(dir, 'out.xlsx');
    await mockSaveDialog(app, file);
    await saveRecord();
    await button('Print').click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect.poll(() => openedPaths(app)).toEqual([file]);
  });

  test('cancelling the save dialog writes nothing and shows no path', async () => {
    await mockSaveDialog(app, null);
    await saveRecord();
    await button('Print').click();
    await expect(button('Print')).toBeEnabled();
    await expect(page.getByText(/Saved to/)).toHaveCount(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test('a failed save shows the error and does not change the record', async () => {
    await mockSaveDialog(app, path.join(dir, 'missing-folder', 'out.xlsx'));
    await saveRecord();
    const [[before]] = await pool.query('SELECT * FROM records');
    await button('Print').click();
    await expect(page.getByRole('alert')).toHaveText('Could not save the file. If it is open in Excel, close it and try again.');
    const [[after]] = await pool.query('SELECT * FROM records');
    expect(after).toEqual(before);
  });

  test('an archived record cannot be printed', async () => {
    await mockSaveDialog(app, path.join(dir, 'out.xlsx'));
    await saveRecord();
    await pool.query('UPDATE records SET archived_at = NOW()');
    await button('Print').click();
    await expect(page.getByRole('alert')).toHaveText('Restore this record before printing.');
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
