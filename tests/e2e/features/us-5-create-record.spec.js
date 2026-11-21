import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, thisMonth, recordForm, blankFormsSection } from '../helpers.js';

test.describe('US-5 Create a PLS or TO record', () => {
  let app, page, pool;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    await seedDirectory(page);
    await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
    await page.getByRole('heading', { name: 'New record' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });
  const count = async () => (await pool.query('SELECT COUNT(*) AS n FROM records'))[0][0].n;
  const success = () => page.getByRole('status');

  async function addEmployee(name) {
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: `${name} — MHO` });
    await button('Add').click();
  }

  // Fills a complete record. Dates default to a fixed November week so tests do not overlap each other.
  async function fill({ employees = ['Ana Cruz'], from = '2026-11-02', to = from, departure = `${from}T08:00`, ret = '' } = {}) {
    for (const e of employees) await addEmployee(e);
    await page.getByLabel('Destination').fill('Provincial Capitol');
    await page.getByLabel('Inclusive from').fill(from);
    await page.getByLabel('Inclusive to').fill(to);
    await page.getByLabel('Departure').fill(departure);
    if (ret) await page.getByLabel('Return (optional)').fill(ret);
    await page.getByLabel('Purpose').fill('Submit reports');
  }

  test('numbers per form type and office in the current month', async () => {
    const ym = thisMonth();
    await fill({ from: '2026-11-02' });
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS ${ym}-1`);
    await fill({ from: '2026-11-03' });
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS ${ym}-2`);
    await recordForm(page).getByRole('radio', { name: 'TO', exact: true }).check();
    await fill({ from: '2026-11-04' });
    await button('Save').click();
    await expect(success()).toHaveText(`Saved TO ${ym}-1`);
    await recordForm(page).getByRole('radio', { name: 'PLS', exact: true }).check();
    await recordForm(page).getByRole('radio', { name: 'Sangguniang Bayan' }).check();
    await fill({ from: '2026-11-05' });
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS SB ${ym}-1`);
  });

  test('signatories pre-fill from the office defaults and switch with the office', async () => {
    await expect(recordForm(page).getByLabel('Recommending approval').locator('option:checked')).toHaveText('JUAN P. SANTOS — DEPARTMENT HEAD');
    await expect(recordForm(page).getByLabel('Approved by').locator('option:checked')).toHaveText('VINCENT E. HERMOSO — OIC - MUNICIPAL MAYOR');
    await recordForm(page).getByRole('radio', { name: 'Sangguniang Bayan' }).check();
    await expect(recordForm(page).getByLabel('Recommending approval').locator('option:checked')).toHaveText('GLENDA P. MINA — SB SECRETARY');
    await expect(recordForm(page).getByLabel('Approved by').locator('option:checked')).toHaveText('RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR');
  });

  test('a signatory can be changed for one record', async () => {
    await fill();
    await recordForm(page).getByLabel('Approved by').selectOption({ label: 'RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR' });
    await button('Save').click();
    await expect(success()).toContainText('Saved PLS');
    const [[r]] = await pool.query('SELECT approving_name AS n FROM records');
    expect(r.n).toBe('RIC RONELSON D. ASUNCION');
  });

  test('a 6th employee cannot be added', async () => {
    for (const e of ['Ana Cruz', 'Ben Reyes', 'Carla Diaz', 'Dino Lim', 'Ela Santos']) await addEmployee(e);
    await expect(page.getByLabel('Employee', { exact: true })).toBeDisabled();
    await expect(button('Add')).toBeDisabled();
    await expect(page.getByText('At most 5 employees')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Employees on this record' }).getByRole('listitem')).toHaveCount(5);
  });

  test('missing required fields show messages and save nothing', async () => {
    await page.getByLabel('Inclusive from').fill('');
    await button('Save').click();
    await expect(page.locator('#rec-employees-error')).toHaveText('Add at least one employee');
    await expect(page.locator('#rec-destination-error')).toHaveText('Required');
    await expect(page.locator('#rec-inclusiveFrom-error')).toHaveText('Required');
    await expect(page.locator('#rec-departureAt-error')).toHaveText('Required');
    await expect(page.locator('#rec-purpose-error')).toHaveText('Required');
    expect(await count()).toBe(0);
  });

  test('return before departure is rejected', async () => {
    await fill({ departure: '2026-11-02T08:00', ret: '2026-11-02T07:00' });
    await button('Save').click();
    await expect(page.locator('#rec-returnAt-error')).toHaveText('Return is before departure');
    expect(await count()).toBe(0);
  });

  test('inclusive end before start is rejected', async () => {
    await fill({ from: '2026-11-05', to: '2026-11-04' });
    await button('Save').click();
    await expect(page.locator('#rec-inclusiveTo-error')).toHaveText('End date is before start date');
    expect(await count()).toBe(0);
  });

  test('vehicle and return may be empty', async () => {
    await fill();
    await button('Save').click();
    await expect(success()).toContainText('Saved PLS');
    const [[r]] = await pool.query('SELECT vehicle, return_at FROM records');
    expect(r).toEqual({ vehicle: '', return_at: null });
  });

  test('double-clicking Save creates one record', async () => {
    await fill();
    await button('Save').dblclick();
    await expect(success()).toContainText('Saved PLS');
    expect(await count()).toBe(1);
  });

  test('date filed is editable and does not change the number month', async () => {
    await page.getByLabel('Date filed').fill('2026-01-15');
    await fill();
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS ${thisMonth()}-1`);
    const [[r]] = await pool.query('SELECT date_filed AS d FROM records');
    expect(r.d).toBe('2026-01-15');
  });

  test('employee details are kept as they were at save time', async () => {
    await fill();
    await button('Save').click();
    await expect(success()).toContainText('Saved PLS');
    await pool.query("UPDATE employees SET designation = 'Changed later' WHERE full_name = 'Ana Cruz'");
    const [[r]] = await pool.query('SELECT designation FROM record_employees');
    expect(r.designation).toBe('Clerk');
  });

  test('a purpose longer than 360 characters is rejected', async () => {
    await fill();
    await page.getByLabel('Purpose').fill('a'.repeat(361));
    await button('Save').click();
    await expect(page.locator('#rec-purpose-error')).toHaveText('At most 360 characters');
    expect(await count()).toBe(0);
  });

  test('overlap shows a warning; Cancel saves nothing; Save anyway saves the next number', async () => {
    const ym = thisMonth();
    await fill({ from: '2026-11-10', to: '2026-11-12' });
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS ${ym}-1`);

    await fill({ from: '2026-11-11' });
    await button('Save').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Possible overlap');
    await expect(dialog.getByRole('listitem')).toHaveText([`Ana Cruz already has PLS ${ym}-1 on 2026-11-10 to 2026-11-12`]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await count()).toBe(1);
    await expect(page.getByLabel('Destination')).toHaveValue('Provincial Capitol');

    await button('Save').click();
    await dialog.getByRole('button', { name: 'Save anyway' }).click();
    await expect(success()).toHaveText(`Saved PLS ${ym}-2`);
    expect(await count()).toBe(2);
  });
});

test.describe('US-5 empty pick lists', () => {
  test('explains what to add when there are no employees or signatories', async () => {
    const { app, page, pool } = await launchApp();
    try {
      await loginAsChangedAdmin(page);
      await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
      await expect(page.getByText('No active employees. Add them on Employees.')).toBeVisible();
      await expect(page.getByText('No active recommending signatories. Add them on Signatories.')).toBeVisible();
      await expect(recordForm(page).getByText('No active approving signatories. Add them on Signatories.')).toBeVisible();
      await expect(blankFormsSection(page).getByText('No active approving signatories. Add them on Signatories.')).toBeVisible();
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
