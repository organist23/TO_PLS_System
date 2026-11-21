import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, seedRecord, invoke, thisMonth, localDay, tableRows } from '../helpers.js';

test.describe('US-11 See who is out today', () => {
  let app, page, pool, m, rhu;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    m = thisMonth();
    const seed = await seedDirectory(page, ['Ana Cruz', 'Ben Reyes', 'Carla Diaz']);
    rhu = (await invoke(page, 'offices:create', { name: 'RHU' })).data.id;
    const pena = (await invoke(page, 'employees:create', { fullName: 'MARIA PEÑA', designation: 'Nurse', employmentStatus: 'Casual', officeId: rhu })).data.id;
    const e = seed.employees;
    // M-1 PLS: Ana + MARIA PEÑA, yesterday..tomorrow, return tomorrow 17:00. TO M-1: Ben today.
    // M-2 blank. M-3: Carla today, archived. M-4: Carla in 2 days.
    await seedRecord(page, seed, {
      employeeIds: [e['Ana Cruz'], pena], inclusiveFrom: localDay(-1), inclusiveTo: localDay(1), departureAt: `${localDay(-1)}T08:00`,
      returnAt: `${localDay(1)}T17:00`, destination: 'Provincial Capitol',
    });
    await seedRecord(page, seed, { formType: 'TO', employeeIds: [e['Ben Reyes']], inclusiveFrom: localDay(0), inclusiveTo: localDay(0), departureAt: `${localDay(0)}T08:00`, destination: 'Manila' });
    await invoke(page, 'records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', recommendingId: seed.signatories.deptHead, approvingId: seed.signatories.mayor });
    const archived = await seedRecord(page, seed, { employeeIds: [e['Carla Diaz']], inclusiveFrom: localDay(0), inclusiveTo: localDay(0), departureAt: `${localDay(0)}T08:00`, destination: 'Cebu' });
    await invoke(page, 'records:archive', { id: archived.id });
    await seedRecord(page, seed, { employeeIds: [e['Carla Diaz']], inclusiveFrom: localDay(2), inclusiveTo: localDay(2), departureAt: `${localDay(2)}T08:00`, destination: 'Baguio' });
    await page.getByRole('navigation').getByRole('button', { name: 'Out today' }).click(); // reload with the seeded records
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const table = () => page.getByRole('table');
  const range = (a, b) => `${localDay(a)} to ${localDay(b)}`;

  test('after login the dashboard lists everyone out today with office, form, number, destination and return', async () => {
    await expect(page.getByRole('heading', { name: 'Out today' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Out today' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByLabel('Date')).toHaveValue(localDay(0));
    await expect(table().locator('thead th')).toHaveText(['Office', 'Employee', 'Form', 'Number', 'Destination', 'Travel dates', 'Return']);
    await expect.poll(() => tableRows(table())).toEqual([
      `MHO | Ana Cruz | PLS | ${m}-1 | Provincial Capitol | ${range(-1, 1)} | ${localDay(1)} 17:00`,
      `MHO | Ben Reyes | TO | ${m}-1 | Manila | ${range(0, 0)} | —`,
      `RHU | MARIA PEÑA | PLS | ${m}-1 | Provincial Capitol | ${range(-1, 1)} | ${localDay(1)} 17:00`,
    ]);
  });

  test('archived and blank issued records do not appear', async () => {
    await expect.poll(() => tableRows(table())).toHaveLength(3);
    await expect(table()).not.toContainText('Carla Diaz');
    const numbers = await table().locator('tbody tr td:nth-child(4)').allTextContents();
    expect(numbers.filter((n) => n === `${m}-2` || n === `${m}-3`)).toEqual([]);
  });

  test('staff can pick another date', async () => {
    await page.getByLabel('Date').fill(localDay(2));
    await expect.poll(() => tableRows(table())).toEqual([`MHO | Carla Diaz | PLS | ${m}-4 | Baguio | ${range(2, 2)} | —`]);
    await page.getByLabel('Date').fill(localDay(1));
    await expect.poll(() => tableRows(table())).toHaveLength(2);
    await page.getByLabel('Date').fill(localDay(-2));
    await expect(page.getByText('No one is out on this date')).toBeVisible();
    await expect(table()).toHaveCount(0);
  });

  test('the list filters by office', async () => {
    await page.getByLabel('Office').selectOption({ label: 'RHU' });
    await expect.poll(() => tableRows(table())).toEqual([
      `RHU | MARIA PEÑA | PLS | ${m}-1 | Provincial Capitol | ${range(-1, 1)} | ${localDay(1)} 17:00`,
    ]);
    await page.getByLabel('Office').selectOption({ label: 'All' });
    await expect.poll(() => tableRows(table())).toHaveLength(3);
  });
});
