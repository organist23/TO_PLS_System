import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchApp, loginAsChangedAdmin, seedDirectory, thisMonth, mockSaveDialog, invoke } from '../helpers.js';

const ExcelJS = createRequire(import.meta.url)('exceljs'); // Playwright's ESM loader cannot import exceljs directly

test.describe('US-15 Preview a form before saving it', () => {
  let app, page, pool, dir, file, seed;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-us15-'));
    file = path.join(dir, 'out.xlsx');
    await loginAsChangedAdmin(page);
    seed = await seedDirectory(page);
    await mockSaveDialog(app, file);
    await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
    await page.getByRole('heading', { name: 'New record' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });
  const preview = () => page.getByRole('dialog', { name: /^Preview / });

  async function saveRecord({ name = 'Ana Cruz', purpose = 'Submit quarterly reports' } = {}) {
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: `${name} — MHO` });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Provincial Capitol');
    await page.getByLabel('Departure').fill('2026-11-21T08:00');
    await page.getByLabel('Purpose').fill(purpose);
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${thisMonth()}-1`);
  }

  test('Print opens the preview with the form values and saves nothing yet', async () => {
    await saveRecord();
    await button('Print').click();
    await expect(preview().getByRole('heading')).toHaveText(`Preview PLS ${thisMonth()}-1`);
    await expect(preview().getByText('PERSONNEL LOCATOR SLIP')).toBeVisible();
    await expect(preview().getByText(`${thisMonth()}-`, { exact: false }).first()).toBeVisible();
    await expect(preview().getByText('Ana Cruz', { exact: true })).toBeVisible();
    await expect(preview().getByText('VINCENT E. HERMOSO', { exact: true })).toBeVisible();
    await expect(preview().getByText('PURPOSE(S): Submit quarterly reports')).toBeVisible();
    await expect(preview().locator('img')).toHaveCount(1);
    await expect.poll(() => preview().locator('img').evaluate((img) => img.complete && img.naturalWidth)).toBeGreaterThan(0); // the logo really loads
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test('focus is on Save as Excel once the preview has loaded, so Enter saves', async () => {
    await saveRecord();
    await button('Print').click();
    await preview().locator('table[data-preview]').waitFor();
    await expect(preview().getByRole('button', { name: 'Save as Excel' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
  });

  test('Save as Excel writes the file with the previewed number', async () => {
    await saveRecord();
    await button('Print').click();
    await preview().getByRole('button', { name: 'Save as Excel' }).click();
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    await expect(preview()).toBeHidden();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets[0].getCell('A12').text).toBe(`PLS NO: ${thisMonth()}-1`);
  });

  test('Close and Escape write nothing and Print still works', async () => {
    await saveRecord();
    await button('Print').click();
    await preview().getByRole('button', { name: 'Close' }).click();
    await expect(preview()).toBeHidden();
    await button('Print').click();
    await expect(preview()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview()).toBeHidden();
    expect(fs.readdirSync(dir)).toEqual([]);
    await button('Print').click();
    await preview().getByRole('button', { name: 'Save as Excel' }).click();
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
  });

  test('an archived record cannot be previewed', async () => {
    await saveRecord();
    await pool.query('UPDATE records SET archived_at = NOW()');
    await button('Print').click();
    await expect(page.getByRole('alert')).toHaveText('Restore this record before printing.');
    await expect(page.locator('table[data-preview]')).toHaveCount(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test('Issue blank previews the number and signatories with no names', async () => {
    await button('Issue blank form').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Issue blank' }).click();
    await expect(preview().getByRole('heading')).toHaveText(`Preview PLS ${thisMonth()}-1`);
    // US-7 changed 2026-11-21: a Mayor's Office blank leaves the Department Head to whoever signs the paper.
    await expect(preview().getByText('VINCENT E. HERMOSO', { exact: true })).toBeVisible();
    await expect(preview().getByText('DEPARTMENT HEAD', { exact: true })).toBeVisible();
    await expect(preview().getByText('JUAN P. SANTOS', { exact: true })).toHaveCount(0);
    await expect(preview().getByText('Ana Cruz')).toHaveCount(0);
    await expect(preview().getByText(/^DATE:_+$/)).toBeVisible();
  });

  test('record text shows literally and never runs as page code', async () => {
    const { officeId } = seed;
    await invoke(page, 'employees:create', { fullName: '<script>window.__pwned=1</script>', employmentStatus: 'Casual', officeId });
    await page.getByRole('navigation').getByRole('button', { name: 'Employees' }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
    await saveRecord({ name: '<script>window.__pwned=1</script>', purpose: '<img src=x onerror="window.__pwned=2">' });
    await button('Print').click();
    await expect(preview().getByText('<script>window.__pwned=1</script>', { exact: true })).toBeVisible();
    await expect(preview().getByText('PURPOSE(S): <img src=x onerror="window.__pwned=2">')).toBeVisible();
    await expect(preview().locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});
