import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, seedRecord, invoke, thisMonth, listNumbers } from '../helpers.js';

test.describe('US-10 Browse, search, and filter records', () => {
  let app, page, pool, m, rhu;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    m = thisMonth();
    const seed = await seedDirectory(page, ['Ana Cruz', 'Ben Reyes']);
    rhu = (await invoke(page, 'offices:create', { name: 'RHU' })).data.id;
    const pena = (await invoke(page, 'employees:create', { fullName: 'MARIA PEÑA', designation: 'Nurse', employmentStatus: 'Casual', officeId: rhu })).data.id;
    // M-1: PLS Mayor, Ana. SB M-1: TO SB, MARIA PEÑA. M-2: blank. M-3: archived.
    await seedRecord(page, seed, { inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22', purpose: 'Submit 100% reports' });
    await seedRecord(page, seed, {
      formType: 'TO', issuingOffice: 'SB', employeeIds: [pena], destination: 'Manila', inclusiveFrom: '2026-11-23', inclusiveTo: '2026-11-24',
      purpose: 'Seminar', recommendingId: seed.signatories.sbSec, approvingId: seed.signatories.viceMayor,
    });
    await invoke(page, 'records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', recommendingId: seed.signatories.deptHead, approvingId: seed.signatories.mayor });
    const archived = await seedRecord(page, seed, { employeeIds: [seed.employees['Ben Reyes']], destination: 'Cebu', inclusiveFrom: '2026-11-25', inclusiveTo: '2026-11-25' });
    await invoke(page, 'records:archive', { id: archived.id });
    await page.getByRole('navigation').getByRole('button', { name: 'Records' }).click();
    await page.getByRole('heading', { name: 'Records' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const all = () => [`${m}-2`, `SB ${m}-1`, `${m}-1`];

  test('the list shows number, form, office, names, destination and travel dates, newest first', async () => {
    await expect(page.locator('table thead th')).toHaveText(['Number', 'Form', 'Office', 'Names', 'Destination', 'Travel dates', 'Status', 'Actions']);
    await expect(listNumbers(page)).toHaveText(all());
    await expect(page.locator('table tbody tr').nth(1).locator('td')).toHaveText([
      `SB ${m}-1`, 'TO', 'Sangguniang Bayan', 'MARIA PEÑA', 'Manila', '2026-11-23 to 2026-11-24', 'Filled', 'Open',
    ]);
    await expect(page.locator('table tbody tr').nth(0).locator('td')).toHaveText([`${m}-2`, 'PLS', "Mayor's Office", '—', '—', '—', 'Blank issued', 'Open']);
  });

  test('search matches number, employee name, destination and purpose', async () => {
    const search = page.getByLabel('Search');
    for (const [q, expected] of [
      [`SB ${m}`, [`SB ${m}-1`]],
      ['peña', [`SB ${m}-1`]],
      ['ana cruz', [`${m}-1`]],
      ['manila', [`SB ${m}-1`]],
      ['seminar', [`SB ${m}-1`]],
      ['100%', [`${m}-1`]],
    ]) {
      await search.fill(q);
      await expect(listNumbers(page)).toHaveText(expected);
    }
  });

  test('filters: form type, issuing office, employee office, status', async () => {
    await page.getByLabel('Form', { exact: true }).selectOption('TO');
    await expect(listNumbers(page)).toHaveText([`SB ${m}-1`]);
    await page.getByLabel('Form', { exact: true }).selectOption('');
    await page.getByLabel('Issuing office').selectOption('MAYOR');
    await expect(listNumbers(page)).toHaveText([`${m}-2`, `${m}-1`]);
    await page.getByLabel('Issuing office').selectOption('');
    await page.getByLabel('Employee office').selectOption({ label: 'RHU' });
    await expect(listNumbers(page)).toHaveText([`SB ${m}-1`]);
    await page.getByLabel('Employee office').selectOption('');
    const status = page.getByLabel('Status');
    await status.selectOption({ label: 'Filled' });
    await expect(listNumbers(page)).toHaveText([`SB ${m}-1`, `${m}-1`]);
    await status.selectOption({ label: 'Blank issued' });
    await expect(listNumbers(page)).toHaveText([`${m}-2`]);
    await status.selectOption({ label: 'Archived' });
    await expect(listNumbers(page)).toHaveText([`${m}-3`]);
    await status.selectOption({ label: 'Active' });
    await expect(listNumbers(page)).toHaveText(all());
  });

  test('the travel date range shows records whose inclusive dates overlap it', async () => {
    await page.getByLabel('Travel from').fill('2026-11-21');
    await page.getByLabel('Travel to').fill('2026-11-21');
    await expect(listNumbers(page)).toHaveText([`${m}-1`]);
    await page.getByLabel('Travel to').fill('2026-11-23');
    await expect(listNumbers(page)).toHaveText([`SB ${m}-1`, `${m}-1`]);
    await page.getByLabel('Travel from').fill('2026-11-24');
    await page.getByLabel('Travel to').fill('2026-11-23');
    await expect(page.getByText('End date is before start date')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
  });

  test('a search with no results shows "No records found", not an empty table', async () => {
    await page.getByLabel('Search').fill('zzz-nothing');
    await expect(page.getByText('No records found')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
  });

  test('opening a record shows all its details with Edit, Print and Archive', async () => {
    await page.getByRole('button', { name: `Open SB ${m}-1` }).click();
    await expect(page.getByRole('heading', { name: `TO SB ${m}-1` })).toBeVisible();
    const dl = page.locator('dl');
    for (const text of ['Filled', 'Sangguniang Bayan', '2026-11-20', 'Manila', '2026-11-23 to 2026-11-24', '2026-11-20 08:00', 'Seminar',
      'GLENDA P. MINA — SB SECRETARY', 'RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR']) {
      await expect(dl.getByText(text, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('list', { name: 'Employees on this record' })).toHaveText('MARIA PEÑA · Nurse · Casual');
    for (const name of ['Edit', 'Print', 'Archive']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to list' }).click();
    await expect(listNumbers(page)).toHaveText(all());
  });
});
