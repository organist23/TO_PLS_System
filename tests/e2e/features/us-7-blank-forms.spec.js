import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(import.meta.url)('exceljs'); // Playwright's ESM loader cannot import exceljs directly
import { launchApp, loginAsChangedAdmin, seedDirectory, thisMonth, mockSaveDialog, mockOpenPath, saveFromPreview } from '../helpers.js';

test.describe('US-7 Issue a numbered blank form', () => {
  let app, page, pool, file;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-us7-')), 'blank.xlsx');
    await loginAsChangedAdmin(page);
    await seedDirectory(page);
    await mockSaveDialog(app, file);
    await mockOpenPath(app);
    await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
    await page.getByRole('heading', { name: 'New record' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });
  const count = async (sql = 'SELECT COUNT(*) AS n FROM records') => (await pool.query(sql))[0][0].n;
  const blanksTable = () => page.getByRole('region', { name: 'Blank forms to fill' });

  async function issue() {
    await button('Issue blank form').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Issue blank' }).click();
    await saveFromPreview(page);
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
  }

  test('Issue blank asks first; Cancel reserves nothing', async () => {
    await page.getByRole('radio', { name: 'TO', exact: true }).check();
    await page.getByRole('radio', { name: 'Sangguniang Bayan' }).check();
    await button('Issue blank form').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText('Issue a blank TO for Sangguniang Bayan?');
    await expect(dialog).toContainText('This reserves the next number.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await count()).toBe(0);
  });

  test('issuing takes the next number and prints number and signatories only', async () => {
    await issue();
    await expect(page.getByRole('status')).toHaveText(`Issued blank PLS ${thisMonth()}-1`);
    const [[r]] = await pool.query('SELECT number, status FROM records');
    expect(r).toEqual({ number: `${thisMonth()}-1`, status: 'blank' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A12').text).toBe(`PLS NO: ${thisMonth()}-1`);
    expect(ws.getCell('H12').text).toMatch(/^DATE:_+$/);
    expect(ws.getCell('A14').text).toBe('');
    expect(ws.getCell('A20').text).toBe('DESTINATION:');
    // US-7 changed 2026-11-21: empty Department Head line, as on the official PLS paper.
    expect([ws.getCell('A31').text, ws.getCell('A32').text, ws.getCell('A37').text]).toEqual(['', 'DEPARTMENT HEAD', 'VINCENT E. HERMOSO']);
  });

  test('the blank form is listed with Fill in and Print again', async () => {
    await issue();
    const row = blanksTable().getByRole('row', { name: new RegExp(`${thisMonth()}-1`) });
    await expect(row).toContainText("Mayor's Office");
    await expect(row.getByRole('button', { name: `Fill in ${thisMonth()}-1` })).toBeVisible();
    await expect(row.getByRole('button', { name: `Print again ${thisMonth()}-1` })).toBeVisible();
  });

  test('filling in keeps the number and printed signatories, and the record becomes filled', async () => {
    await issue();
    await blanksTable().getByRole('button', { name: `Fill in ${thisMonth()}-1` }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Fill in PLS ${thisMonth()}-1`);
    await expect(page.getByRole('radio', { name: 'TO', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Sangguniang Bayan' })).toBeDisabled();
    await expect(page.getByLabel('Approved by')).toHaveCount(0);
    await expect(page.getByText('VINCENT E. HERMOSO — OIC - MUNICIPAL MAYOR', { exact: true })).toBeVisible();

    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ana Cruz — MHO' });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Treasury');
    await page.getByLabel('Departure').fill('2026-11-21T09:00');
    await page.getByLabel('Purpose').fill('Errand');
    // US-7 changed: the Department Head who signed is required and has no default.
    await expect(page.getByLabel('Recommending approval (Department Head who signed)')).toHaveValue('');
    await button('Save').click();
    await expect(page.locator('#rec-recommendingId-error')).toHaveText('Choose an active recommending signatory');
    await page.getByLabel('Recommending approval (Department Head who signed)').selectOption({ label: 'JUAN P. SANTOS — DEPARTMENT HEAD' });
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${thisMonth()}-1`);
    const [[r]] = await pool.query('SELECT number, status, destination, approving_name, recommending_name FROM records');
    expect(r).toEqual({ number: `${thisMonth()}-1`, status: 'filled', destination: 'Treasury', approving_name: 'VINCENT E. HERMOSO', recommending_name: 'JUAN P. SANTOS' });
    await expect(blanksTable()).toContainText('No blank forms waiting');
  });

  test('Print again shows no banner about another record and prints the blank', async () => {
    await issue(); // blank <ym>-1
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ana Cruz — MHO' });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Capitol');
    await page.getByLabel('Departure').fill('2026-11-21T08:00');
    await page.getByLabel('Purpose').fill('Meeting');
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${thisMonth()}-2`);

    await blanksTable().getByRole('button', { name: `Print again ${thisMonth()}-1` }).click();
    await saveFromPreview(page);
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets[0].getCell('A12').text).toBe(`PLS NO: ${thisMonth()}-1`);
  });

  test('filling in applies the overlap warning', async () => {
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ana Cruz — MHO' });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Capitol');
    await page.getByLabel('Inclusive from').fill('2026-11-10');
    await page.getByLabel('Inclusive to').fill('2026-11-12');
    await page.getByLabel('Departure').fill('2026-11-10T08:00');
    await page.getByLabel('Purpose').fill('Meeting');
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${thisMonth()}-1`);

    await issue();
    await blanksTable().getByRole('button', { name: `Fill in ${thisMonth()}-2` }).click();
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ana Cruz — MHO' });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Treasury');
    await page.getByLabel('Inclusive from').fill('2026-11-11');
    await page.getByLabel('Inclusive to').fill('2026-11-11');
    await page.getByLabel('Departure').fill('2026-11-11T09:00');
    await page.getByLabel('Purpose').fill('Errand');
    await page.getByLabel('Recommending approval (Department Head who signed)').selectOption({ label: 'JUAN P. SANTOS — DEPARTMENT HEAD' });
    await button('Save').click();
    await expect(page.getByRole('dialog')).toContainText(`Ana Cruz already has PLS ${thisMonth()}-1 on 2026-11-10 to 2026-11-12`);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(await count("SELECT COUNT(*) AS n FROM records WHERE status = 'blank'")).toBe(1);
  });
});
