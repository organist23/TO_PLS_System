import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, invoke, thisMonth, recordForm, blankFormsSection } from '../helpers.js';

// US-5 changed 2026-11-21 (paper first): a record is an issued blank (US-16) encoded from the returned paper (US-17).
// The number and signatories are set when the blank is issued; the details are checked when it is encoded.
test.describe('US-5 Create a PLS or TO record', () => {
  let app, page, pool, seed;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    seed = await seedDirectory(page);
    await page.getByRole('navigation').getByRole('button', { name: 'Forms' }).click();
    await page.getByRole('heading', { name: 'Forms', exact: true }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });
  const filled = async () => (await pool.query("SELECT COUNT(*) AS n FROM records WHERE status = 'filled'"))[0][0].n;
  const success = () => page.getByRole('status');
  const section = () => blankFormsSection(page);

  // Issues one blank through Print blank forms and closes its preview.
  async function issue({ form = 'PLS', office = "Mayor's Office" } = {}) {
    await section().getByRole('radio', { name: form, exact: true }).check();
    await section().getByRole('radio', { name: office }).check();
    await page.getByLabel('How many').fill('1');
    await button('Issue blank form').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Issue blank' }).click();
    await page.getByRole('dialog', { name: /^Preview / }).getByRole('button', { name: 'Close' }).click();
  }

  // Opens a returned paper through Encode a returned form.
  async function encode(number, form = 'PLS') {
    await page.getByLabel('Form', { exact: true }).last().selectOption(form);
    await page.getByLabel('Number on the returned form').fill(number);
    await button('Find').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Fill in ${form} ${number}`);
  }

  // A Mayor's Office PLS blank issued in setup, opened for encoding (the UI under test is the encoding).
  async function openNew() {
    const { numbers } = (await invoke(page, 'records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', approvingId: seed.signatories.mayor })).data;
    await encode(numbers[0]);
    return numbers[0];
  }

  async function addEmployee(name) {
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: `${name} — MHO` });
    await button('Add').click();
  }

  // Fills a complete form. Dates default to a fixed November week so tests do not overlap each other.
  async function fill({ employees = ['Ana Cruz'], from = '2026-11-02', to = from, departure = `${from}T08:00`, ret = '', head = true } = {}) {
    for (const e of employees) await addEmployee(e);
    await page.getByLabel('Destination').fill('Provincial Capitol');
    await page.getByLabel('Inclusive from').fill(from);
    await page.getByLabel('Inclusive to').fill(to);
    await page.getByLabel('Departure').fill(departure);
    if (ret) await page.getByLabel('Return (optional)').fill(ret);
    await page.getByLabel('Purpose').fill('Submit reports');
    const dept = page.getByLabel('Recommending approval (Department Head who signed)');
    if (head && await dept.count()) await dept.selectOption({ label: 'JUAN P. SANTOS — DEPARTMENT HEAD' });
  }

  test('no direct input: the Forms page has no record form until a returned blank is opened', async () => {
    await expect(page.getByLabel('Employee', { exact: true })).toHaveCount(0);
    await expect(button('Save')).toHaveCount(0);
    await expect(page.locator('#record-form')).toHaveCount(0);
    expect(await invoke(page, 'records:create', {}).catch((e) => e.message)).toMatch(/Channel not allowed: records:create/);
    await openNew();
    await expect(page.locator('#record-form')).toBeVisible();
  });

  test('numbers per form type and office in the current month, kept when encoded', async () => {
    const ym = thisMonth();
    await issue();
    await expect(success()).toHaveText(`Issued blank PLS ${ym}-1`);
    await issue();
    await expect(success()).toHaveText(`Issued blank PLS ${ym}-2`);
    await issue({ form: 'TO' });
    await expect(success()).toHaveText(`Issued blank TO ${ym}-1`);
    await issue({ office: 'Sangguniang Bayan' });
    await expect(success()).toHaveText(`Issued blank PLS SB ${ym}-1`);
    await encode(`${ym}-2`);
    await fill();
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS ${ym}-2`);
  });

  test('signatories pre-fill from the office defaults and switch with the office', async () => {
    await expect(section().getByLabel('Approved by').locator('option:checked')).toHaveText('VINCENT E. HERMOSO — OIC - MUNICIPAL MAYOR');
    await section().getByRole('radio', { name: 'Sangguniang Bayan' }).check();
    await expect(section().getByLabel('Recommending approval').locator('option:checked')).toHaveText('GLENDA P. MINA — SB SECRETARY');
    await expect(section().getByLabel('Approved by').locator('option:checked')).toHaveText('RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR');
  });

  test('a signatory can be changed for one record', async () => {
    const ym = thisMonth();
    await section().getByLabel('Approved by').selectOption({ label: 'RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR' });
    await issue();
    await encode(`${ym}-1`);
    await fill();
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS ${ym}-1`);
    const [[r]] = await pool.query('SELECT approving_name AS a, recommending_name AS r FROM records');
    expect(r).toEqual({ a: 'RIC RONELSON D. ASUNCION', r: 'JUAN P. SANTOS' });
  });

  test('a 6th employee cannot be added', async () => {
    await openNew();
    for (const e of ['Ana Cruz', 'Ben Reyes', 'Carla Diaz', 'Dino Lim', 'Ela Santos']) await addEmployee(e);
    await expect(page.getByLabel('Employee', { exact: true })).toBeDisabled();
    await expect(button('Add')).toBeDisabled();
    await expect(page.getByText('At most 5 employees')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Employees on this record' }).getByRole('listitem')).toHaveCount(5);
  });

  test('missing required fields show messages and save nothing', async () => {
    await openNew();
    await page.getByLabel('Inclusive from').fill('');
    await button('Save').click();
    await expect(page.locator('#rec-employees-error')).toHaveText('Add at least one employee');
    await expect(page.locator('#rec-destination-error')).toHaveText('Required');
    await expect(page.locator('#rec-inclusiveFrom-error')).toHaveText('Required');
    await expect(page.locator('#rec-departureAt-error')).toHaveText('Required');
    await expect(page.locator('#rec-purpose-error')).toHaveText('Required');
    await expect(page.locator('#rec-recommendingId-error')).toHaveText('Choose an active recommending signatory');
    expect(await filled()).toBe(0);
  });

  test('return before departure is rejected', async () => {
    await openNew();
    await fill({ departure: '2026-11-02T08:00', ret: '2026-11-02T07:00' });
    await button('Save').click();
    await expect(page.locator('#rec-returnAt-error')).toHaveText('Return is before departure');
    expect(await filled()).toBe(0);
  });

  test('inclusive end before start is rejected', async () => {
    await openNew();
    await fill({ from: '2026-11-05', to: '2026-11-04' });
    await button('Save').click();
    await expect(page.locator('#rec-inclusiveTo-error')).toHaveText('End date is before start date');
    expect(await filled()).toBe(0);
  });

  test('vehicle and return may be empty', async () => {
    await openNew();
    await fill();
    await button('Save').click();
    await expect(success()).toContainText('Saved PLS');
    const [[r]] = await pool.query('SELECT vehicle, return_at FROM records');
    expect(r).toEqual({ vehicle: '', return_at: null });
  });

  test('double-clicking Save encodes once', async () => {
    const number = await openNew();
    await fill();
    await button('Save').dblclick();
    await expect(success()).toHaveText(`Saved PLS ${number}`);
    expect(await filled()).toBe(1);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM record_employees');
    expect(n).toBe(1);
  });

  test('date filed is editable and does not change the number month', async () => {
    const number = await openNew();
    await page.getByLabel('Date filed').fill('2026-01-15');
    await fill();
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS ${number}`);
    expect(number.startsWith(thisMonth())).toBe(true);
    const [[r]] = await pool.query('SELECT date_filed AS d FROM records');
    expect(r.d).toBe('2026-01-15');
  });

  test('employee details are kept as they were at save time', async () => {
    await openNew();
    await fill();
    await button('Save').click();
    await expect(success()).toContainText('Saved PLS');
    await pool.query("UPDATE employees SET designation = 'Changed later' WHERE full_name = 'Ana Cruz'");
    const [[r]] = await pool.query('SELECT designation FROM record_employees');
    expect(r.designation).toBe('Clerk');
  });

  test('a purpose longer than 360 characters is rejected', async () => {
    await openNew();
    await fill();
    await page.getByLabel('Purpose').fill('a'.repeat(361));
    await button('Save').click();
    await expect(page.locator('#rec-purpose-error')).toHaveText('At most 360 characters');
    expect(await filled()).toBe(0);
  });

  test('overlap shows a warning; Cancel saves nothing; Save anyway saves under its own number', async () => {
    const ym = thisMonth();
    const first = await openNew();
    await fill({ from: '2026-11-10', to: '2026-11-12' });
    await button('Save').click();
    await expect(success()).toHaveText(`Saved PLS ${first}`);

    const second = await openNew();
    await fill({ from: '2026-11-11' });
    await button('Save').click();
    const dialog = page.getByRole('dialog', { name: 'Possible overlap' });
    await expect(dialog.getByRole('listitem')).toHaveText([`Ana Cruz already has PLS ${ym}-1 on 2026-11-10 to 2026-11-12`]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await filled()).toBe(1);
    await expect(page.getByLabel('Destination')).toHaveValue('Provincial Capitol');

    await button('Save').click();
    await dialog.getByRole('button', { name: 'Save anyway' }).click();
    await expect(success()).toHaveText(`Saved PLS ${second}`);
    expect(second).toBe(`${ym}-2`);
    expect(await filled()).toBe(2);
  });
});

test.describe('US-5 empty pick lists', () => {
  test('explains what to add when there are no employees or signatories', async () => {
    const { app, page, pool } = await launchApp();
    try {
      await loginAsChangedAdmin(page);
      await page.getByRole('navigation').getByRole('button', { name: 'Forms' }).click();
      await expect(blankFormsSection(page).getByText('No active approving signatories. Add them on Signatories.')).toBeVisible();
      await expect(blankFormsSection(page).getByText("Left empty: the Department Head of whoever takes the form signs the paper.")).toBeVisible();
      // The record form (with its employee and signatory hints) appears only when a returned blank is encoded.
      await expect(recordForm(page)).toHaveCount(0);
      const appr = (await invoke(page, 'signatories:create', { name: 'MAYOR', title: 'MUNICIPAL MAYOR', role: 'approving' })).data.id;
      const { numbers } = (await invoke(page, 'records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', approvingId: appr })).data;
      await page.getByLabel('Number on the returned form').fill(numbers[0]);
      await page.getByRole('button', { name: 'Find', exact: true }).click();
      await expect(recordForm(page).getByText('No active employees. Add them on Employees.')).toBeVisible();
      await expect(recordForm(page).getByText('No active recommending signatories. Add them on Signatories.')).toBeVisible();
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
