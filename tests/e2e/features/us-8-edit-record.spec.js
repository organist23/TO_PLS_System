import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(import.meta.url)('exceljs'); // Playwright's ESM loader cannot import exceljs directly
import { launchApp, loginAsChangedAdmin, seedDirectory, seedRecord, invoke, thisMonth, listNumbers, mockSaveDialog, saveFromPreview } from '../helpers.js';

test.describe('US-8 Edit a record', () => {
  let app, page, pool, m, seed, rec, oldMayor;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    m = thisMonth();
    seed = await seedDirectory(page, ['Ana Cruz', 'Ben Reyes', 'Carla Diaz']);
    oldMayor = (await invoke(page, 'signatories:create', { name: 'PEDRO L. GOMEZ', title: 'MUNICIPAL MAYOR', role: 'approving' })).data.id;
    rec = await seedRecord(page, seed, { inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22', approvingId: oldMayor }); // M-1, Ana
    await page.getByRole('navigation').getByRole('button', { name: 'Records' }).click();
    await expect(listNumbers(page)).toHaveText([`${m}-1`]);
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });
  const row = async () => (await pool.query('SELECT * FROM records WHERE id = ?', [rec.id]))[0][0];
  async function openEdit(number = `${m}-1`) {
    await page.getByRole('button', { name: `Open ${number}` }).click();
    await button('Edit').click();
    await expect(page.getByRole('heading', { name: `Edit PLS ${number}` })).toBeVisible();
  }

  test('edited values show in the list and on the next print', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-us8-'));
    const file = path.join(dir, 'out.xlsx');
    await mockSaveDialog(app, file);
    await openEdit();
    await expect(page.getByLabel('Destination')).toHaveValue('Provincial Capitol');
    await expect(page.getByLabel('Departure')).toHaveValue('2026-11-20T08:00');
    await page.getByLabel('Destination').fill('Manila');
    await page.getByLabel('Purpose').fill('Training on records');
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ben Reyes — MHO' });
    await button('Add').click();
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-1`);
    await expect(page.locator('dl').getByText('Manila', { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Employees on this record' }).getByRole('listitem')).toHaveCount(2);
    await button('Print').click();
    await saveFromPreview(page);
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A12').text).toBe(`PLS NO: ${m}-1`);
    expect(ws.getCell('A20').text).toBe('DESTINATION: Manila');
    expect(ws.getCell('A24').text).toBe('PURPOSE(S): Training on records');
    expect([ws.getCell('A14').text, ws.getCell('A15').text]).toEqual(['Ana Cruz', 'Ben Reyes']);
    await button('Back to list').click();
    await expect(page.locator('table tbody tr td').nth(3)).toHaveText('Ana Cruz, Ben Reyes');
    await expect(page.locator('table tbody tr td').nth(4)).toHaveText('Manila');
  });

  test('number, form type and issuing office cannot be changed', async () => {
    await openEdit();
    for (const name of ['PLS', 'TO', "Mayor's Office", 'Sangguniang Bayan']) await expect(page.getByRole('radio', { name })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'PLS' })).toBeChecked();
    await expect(page.getByRole('radio', { name: "Mayor's Office" })).toBeChecked();
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-1`);
    expect(await row()).toMatchObject({ number: `${m}-1`, form_type: 'PLS', issuing_office: 'MAYOR', status: 'filled' });
  });

  test('employees and signatories archived since keep their saved details; new ones must be active', async () => {
    await invoke(page, 'employees:update', { id: seed.employees['Ana Cruz'], fullName: 'Ana Cruz-Lopez', designation: 'Clerk', employmentStatus: 'Permanent', officeId: seed.officeId });
    expect((await invoke(page, 'employees:archive', { id: seed.employees['Ana Cruz'] })).ok).toBe(true);
    expect((await invoke(page, 'signatories:archive', { id: oldMayor })).ok).toBe(true);
    await openEdit();
    await expect(page.getByRole('list', { name: 'Employees on this record' })).toContainText('Ana Cruz · Clerk · Permanent');
    await expect(page.getByLabel('Approved by')).toHaveValue(String(oldMayor));
    await expect(page.getByLabel('Approved by').locator('option:checked')).toHaveText('PEDRO L. GOMEZ — MUNICIPAL MAYOR (archived)');
    await page.getByLabel('Destination').fill('Manila');
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-1`);
    const [emps] = await pool.query('SELECT full_name FROM record_employees WHERE record_id = ?', [rec.id]);
    expect(emps).toEqual([{ full_name: 'Ana Cruz' }]);
    expect(await row()).toMatchObject({ approving_id: oldMayor, approving_name: 'PEDRO L. GOMEZ', destination: 'Manila' });
    // switching to another (active) signatory takes its current details
    await button('Edit').click();
    await page.getByLabel('Approved by').selectOption({ label: 'VINCENT E. HERMOSO — OIC - MUNICIPAL MAYOR' });
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-1`);
    expect(await row()).toMatchObject({ approving_id: seed.signatories.mayor, approving_name: 'VINCENT E. HERMOSO', approving_title: 'OIC - MUNICIPAL MAYOR' });
  });

  test('the same validation as US-5 applies', async () => {
    await openEdit();
    await page.getByLabel('Destination').fill('  ');
    await page.getByLabel('Purpose').fill('a'.repeat(361));
    await button('Save').click();
    await expect(page.locator('#rec-destination-error')).toHaveText('Required');
    await expect(page.locator('#rec-purpose-error')).toHaveText('At most 360 characters');
    await page.getByRole('button', { name: 'Remove Ana Cruz' }).click();
    await page.getByLabel('Purpose').fill('ok');
    await page.getByLabel('Destination').fill('Manila');
    await button('Save').click();
    await expect(page.locator('#rec-employees-error')).toHaveText('Add at least one employee');
    expect(await row()).toMatchObject({ destination: 'Provincial Capitol', purpose: 'Submit reports' });
  });

  test('the overlap warning ignores the record being edited and warns for others', async () => {
    await openEdit();
    await page.getByLabel('Inclusive to').fill('2026-11-23');
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-1`);
    expect((await row()).inclusive_to).toBe('2026-11-23');
    await seedRecord(page, seed, { employeeIds: [seed.employees['Ben Reyes']], inclusiveFrom: '2026-11-25', inclusiveTo: '2026-11-25' }); // M-2
    await button('Edit').click();
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ben Reyes — MHO' });
    await button('Add').click();
    await page.getByLabel('Inclusive to').fill('2026-11-25');
    await button('Save').click();
    const dialog = page.getByRole('dialog', { name: 'Possible overlap' });
    await expect(dialog).toContainText(`Ben Reyes already has PLS ${m}-2 on 2026-11-25 to 2026-11-25`);
    await expect(dialog).not.toContainText(`${m}-1`);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect((await row()).inclusive_to).toBe('2026-11-23');
    await button('Save').click();
    await dialog.getByRole('button', { name: 'Save anyway' }).click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-1`);
    expect((await row()).inclusive_to).toBe('2026-11-25');
  });

  test('a Blank issued record offers Fill in, not Edit', async () => {
    await invoke(page, 'records:issueBlank', { formType: 'TO', issuingOffice: 'SB', recommendingId: seed.signatories.sbSec, approvingId: seed.signatories.viceMayor });
    await page.getByLabel('Status').selectOption({ label: 'Blank issued' });
    await page.getByRole('button', { name: `Open SB ${m}-1` }).click();
    await expect(button('Edit')).toHaveCount(0);
    await button('Fill in').click();
    await expect(page.getByRole('heading', { name: `Fill in TO SB ${m}-1` })).toBeVisible();
    await expect(page.getByText('GLENDA P. MINA — SB SECRETARY')).toBeVisible();
    await button('Cancel').click();
    await expect(page.getByRole('heading', { name: `TO SB ${m}-1` })).toBeVisible();
  });

  test('Cancel leaves the record unchanged', async () => {
    await openEdit();
    await page.getByLabel('Destination').fill('Manila');
    await button('Cancel').click();
    await expect(page.getByRole('heading', { name: `PLS ${m}-1` })).toBeVisible();
    expect((await row()).destination).toBe('Provincial Capitol');
  });
});
