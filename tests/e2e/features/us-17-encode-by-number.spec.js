import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, invoke, thisMonth } from '../helpers.js';

test.describe('US-17 Encode a returned form by its number', () => {
  let app, page, pool, m, seed, pls, to;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    m = thisMonth();
    seed = await seedDirectory(page, ['Ana Cruz', 'Ben Reyes']);
    const issue = async (formType, count) => (await invoke(page, 'records:issueBlank', { formType, issuingOffice: 'MAYOR', approvingId: seed.signatories.mayor, count })).data;
    pls = await issue('PLS', 3); // PLS <m>-1..3
    to = await issue('TO', 1); // TO <m>-1
    await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
    await page.getByRole('heading', { name: 'New record' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const find = async (formType, number) => {
    await page.getByLabel('Form', { exact: true }).last().selectOption(formType);
    await page.getByLabel('Number on the returned form').fill(number);
    await page.getByRole('button', { name: 'Find' }).click();
  };
  const heading = () => page.getByRole('heading', { level: 1 });

  test('the number opens Fill in for that blank; PLS and TO with the same number are told apart', async () => {
    await find('TO', `${m}-1`);
    await expect(heading()).toHaveText(`Fill in TO ${m}-1`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await find('PLS', ` ${m}-1 `); // spaces around the number are ignored
    await expect(heading()).toHaveText(`Fill in PLS ${m}-1`);
  });

  test('filling in links the number to the employees on the paper and the Department Head who signed', async () => {
    await find('PLS', `${m}-2`);
    await expect(heading()).toHaveText(`Fill in PLS ${m}-2`);
    for (const name of ['Ana Cruz', 'Ben Reyes']) {
      await page.getByLabel('Employee', { exact: true }).selectOption({ label: `${name} — MHO` });
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await page.getByLabel('Destination').fill('Provincial Capitol');
    await page.getByLabel('Departure').fill('2026-11-21T08:00');
    await page.getByLabel('Purpose').fill('Submit reports');
    await page.getByLabel('Recommending approval (Department Head who signed)').selectOption({ label: 'JUAN P. SANTOS — DEPARTMENT HEAD' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-2`);
    const [[r]] = await pool.query('SELECT status, recommending_name FROM records WHERE id = ?', [pls.ids[1]]);
    expect(r).toEqual({ status: 'filled', recommending_name: 'JUAN P. SANTOS' });
    const [emps] = await pool.query('SELECT full_name, office_id FROM record_employees WHERE record_id = ? ORDER BY position', [pls.ids[1]]);
    expect(emps).toEqual([{ full_name: 'Ana Cruz', office_id: seed.officeId }, { full_name: 'Ben Reyes', office_id: seed.officeId }]);
  });

  test('an unknown number is refused with a message', async () => {
    await find('PLS', `${m}-99`);
    await expect(page.locator('#enc-number-error')).toHaveText('No blank form has this number. Check the number on the paper.');
    await expect(heading()).toHaveText('New record');
  });

  test('an encoded number says so and links to the record', async () => {
    await invoke(page, 'records:fillBlank', {
      id: pls.ids[0], recommendingId: seed.signatories.deptHead, dateFiled: '2026-11-21', employeeIds: [seed.employees['Ana Cruz']],
      destination: 'Capitol', vehicle: '', inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21', departureAt: '2026-11-21T08:00', returnAt: '', purpose: 'Meeting',
    });
    await find('PLS', `${m}-1`);
    await expect(page.locator('#enc-number-error')).toContainText(`${m}-1 is already encoded.`);
    await page.locator('#enc-number-error').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: `PLS ${m}-1` })).toBeVisible();
  });

  test('a voided number says so', async () => {
    await invoke(page, 'records:archive', { id: pls.ids[2] });
    await find('PLS', `${m}-3`);
    await expect(page.locator('#enc-number-error')).toHaveText(`${m}-3 was voided.`);
  });

  test('the Blank forms to fill list still works', async () => {
    await page.getByRole('button', { name: `Fill in ${m}-3` }).click();
    await expect(heading()).toHaveText(`Fill in PLS ${m}-3`);
    expect(to.numbers).toEqual([`${m}-1`]);
  });
});
