import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchApp, loginAsChangedAdmin, seedDirectory, seedRecord, thisMonth, mockSaveDialog, saveFromPreview, blankFormsSection, recordForm } from '../helpers.js';

const ExcelJS = createRequire(import.meta.url)('exceljs'); // Playwright's ESM loader cannot import exceljs directly

test.describe('US-16 Print a stack of blank forms', () => {
  let app, page, pool, m, seed, file;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    m = thisMonth();
    seed = await seedDirectory(page, ['Ana Cruz']);
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-us16-')), 'stack.xlsx');
    await mockSaveDialog(app, file);
    await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
    await page.getByRole('heading', { name: 'New record' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });
  const count = async () => (await pool.query('SELECT COUNT(*) AS n FROM records'))[0][0].n;
  const sheets = async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    return wb.worksheets;
  };

  test('the confirmation names count, numbers and the chosen signatories before anything is reserved; Cancel reserves nothing', async () => {
    await seedRecord(page, seed); // <m>-1 already used
    // The Save form keeps its own choices; only the section's are used for blanks.
    await recordForm(page).getByRole('radio', { name: 'TO', exact: true }).check();
    await recordForm(page).getByRole('radio', { name: 'Sangguniang Bayan' }).check();
    await recordForm(page).getByLabel('Approved by').selectOption({ label: 'VINCENT E. HERMOSO — OIC - MUNICIPAL MAYOR' }); // differs from the section's choice below
    await blankFormsSection(page).getByLabel('Approved by').selectOption({ label: 'RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR' }); // e.g. an Acting Mayor
    await expect(blankFormsSection(page)).toContainText('Left empty: the Department Head of whoever takes the form signs the paper.');
    await page.getByLabel('How many').fill('5');
    await button('Issue blank form').click();
    const dialog = page.getByRole('dialog', { name: "Issue 5 blank PLS for Mayor's Office?" });
    await expect(dialog).toContainText(`Numbers: ${m}-2 to ${m}-6`);
    await expect(dialog).toContainText('Recommending approval: Department Head (signs on the paper)');
    await expect(dialog).toContainText('Approved by: RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR');
    await expect(dialog).toContainText('This reserves 5 numbers.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await count()).toBe(1);
  });

  test('confirming reserves consecutive numbers and saves one file with one page per form', async () => {
    await blankFormsSection(page).getByLabel('Approved by').selectOption({ label: 'RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR' });
    await page.getByLabel('How many').fill('5');
    await button('Issue blank form').click();
    await button('Issue 5 blanks').click();
    await expect(page.getByRole('status')).toHaveText(`Issued 5 blank PLS: ${m}-1 to ${m}-5`);
    const preview = page.getByRole('dialog', { name: `Preview PLS ${m}-1` });
    await expect(preview).toContainText(`Showing ${m}-1. The file has 5 forms.`);
    await saveFromPreview(page);
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    const ws = await sheets();
    expect(ws.map((w) => w.name)).toEqual([1, 2, 3, 4, 5].map((n) => `${m}-${n}`));
    ws.forEach((w, i) => {
      expect(w.getCell('A12').text).toBe(`PLS NO: ${m}-${i + 1}`);
      expect([w.getCell('A31').text, w.getCell('A32').text]).toEqual(['', 'DEPARTMENT HEAD']);
      expect(w.getCell('A37').text).toBe('RIC RONELSON D. ASUNCION');
      expect(w.getImages()).toHaveLength(1);
    });
    const [rows] = await pool.query("SELECT number FROM records WHERE status = 'blank' ORDER BY seq");
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4, 5].map((n) => `${m}-${n}`));
  });

  test('a count below 1 or above 50 is refused and nothing is reserved', async () => {
    for (const n of ['0', '51']) {
      await page.getByLabel('How many').fill(n);
      await button('Issue blank form').click();
      await expect(page.locator('#rec-count-error')).toHaveText('Enter a number from 1 to 50');
      await expect(page.getByRole('dialog')).toHaveCount(0); // refused before the confirmation, so it never shows a wrong range
    }
    expect(await count()).toBe(0);
  });

  test('an SB stack prints the SB Secretary and the Vice Mayor', async () => {
    await blankFormsSection(page).getByRole('radio', { name: 'Sangguniang Bayan' }).check();
    await page.getByLabel('How many').fill('2');
    await button('Issue blank form').click();
    const dialog = page.getByRole('dialog', { name: 'Issue 2 blank PLS for Sangguniang Bayan?' });
    await expect(dialog).toContainText('Recommending approval: GLENDA P. MINA — SB SECRETARY');
    await dialog.getByRole('button', { name: 'Issue 2 blanks' }).click();
    await saveFromPreview(page);
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    const ws = await sheets();
    expect(ws.map((w) => w.name)).toEqual([`SB ${m}-1`, `SB ${m}-2`]);
    for (const w of ws) expect([w.getCell('A29').text, w.getCell('A36').text]).toEqual(['GLENDA P. MINA', 'RIC RONELSON D. ASUNCION']);
  });
});
