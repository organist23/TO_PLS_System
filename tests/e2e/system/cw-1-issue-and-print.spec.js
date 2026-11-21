import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchApp, loginAsChangedAdmin, thisMonth, mockSaveDialog, saveFromPreview, openReturnedBlank, pickDepartmentHead, blankFormsSection } from '../helpers.js';

const ExcelJS = createRequire(import.meta.url)('exceljs');

// CW-1: US-1 → US-3 → US-4 → US-16 → US-17 → US-6 (changed 2026-11-21: paper first). Asserts the hand-offs between stories, not each story's edge cases.
test('CW-1 issue and print a record', async () => {
  const { app, page, pool } = await launchApp();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-cw1-')), 'cw1.xlsx');
  try {
    await loginAsChangedAdmin(page); // US-1
    await mockSaveDialog(app, file);
    const nav = (name) => page.getByRole('navigation').getByRole('button', { name }).click();
    const button = (name) => page.getByRole('button', { name, exact: true });

    await nav('Offices'); // US-3
    await button('Add office').click();
    await page.getByLabel('Office name').fill('Municipal Health Office');
    await button('Save').click();
    await nav('Employees');
    await button('Add employee').click();
    await page.getByLabel('Full name').fill('Ana Cruz');
    await page.getByLabel('Designation').fill('Nurse I');
    await page.getByLabel('Office', { exact: true }).selectOption({ label: 'Municipal Health Office' });
    await button('Save').click();
    await expect(page.getByRole('cell', { name: 'Ana Cruz' })).toBeVisible();

    await nav('Signatories'); // US-4
    for (const [name, title, role] of [['JUAN P. SANTOS', 'DEPARTMENT HEAD', 'recommending'], ['VINCENT E. HERMOSO', 'OIC - MUNICIPAL MAYOR', 'approving']]) {
      await button('Add signatory').click();
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByLabel('Title').fill(title);
      await page.getByLabel('Role').selectOption(role);
      await button('Save').click();
      await expect(page.getByRole('cell', { name })).toBeVisible();
    }
    await page.getByLabel("Mayor's Office — recommending").selectOption({ label: 'JUAN P. SANTOS — DEPARTMENT HEAD' });
    await expect(page.getByLabel("Mayor's Office — recommending")).toBeEnabled();
    await page.getByLabel("Mayor's Office — approving").selectOption({ label: 'VINCENT E. HERMOSO — OIC - MUNICIPAL MAYOR' });
    await expect(page.getByLabel("Mayor's Office — approving")).toBeEnabled();

    await nav('Forms'); // US-16: the default approver from US-4 arrives in Print blank forms
    await expect(blankFormsSection(page).getByLabel('Approved by').locator('option:checked')).toHaveText('VINCENT E. HERMOSO — OIC - MUNICIPAL MAYOR');
    expect(await openReturnedBlank(page)).toBe(`${thisMonth()}-1`); // US-17: the returned paper, by its number
    await pickDepartmentHead(page); // the US-4 Department Head who signed
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ana Cruz — Municipal Health Office' });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Provincial Capitol');
    await page.getByLabel('Departure').fill('2026-11-21T08:00');
    await page.getByLabel('Purpose').fill('Submit reports');
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${thisMonth()}-1`);

    await button('Print').click(); // US-6: the saved number and people reach the printed file
    await saveFromPreview(page); // US-15
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A12').text).toBe(`PLS NO: ${thisMonth()}-1`);
    expect([ws.getCell('A14').text, ws.getCell('E14').text]).toEqual(['Ana Cruz', 'Nurse I']);
    expect([ws.getCell('A31').text, ws.getCell('A37').text]).toEqual(['JUAN P. SANTOS', 'VINCENT E. HERMOSO']);
  } finally {
    await app.close();
    await pool.end();
  }
});
