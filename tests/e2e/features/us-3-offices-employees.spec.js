import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin } from '../helpers.js';

test.describe('US-3 Manage offices and employees', () => {
  let app, page, pool;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const nav = (name) => page.getByRole('navigation').getByRole('button', { name }).click();
  const button = (name) => page.getByRole('button', { name, exact: true });
  const row = (name) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
  const count = async (sql, params) => (await pool.query(sql, params))[0][0].n;

  async function addOffice(name) {
    await nav('Offices');
    await button('Add office').click();
    await page.getByLabel('Office name').fill(name);
    await button('Save').click();
    await expect(row(name)).toBeVisible();
  }

  async function addEmployee(fullName, office, { designation = 'Clerk', status } = {}) {
    await nav('Employees');
    await button('Add employee').click();
    await page.getByLabel('Full name').fill(fullName);
    await page.getByLabel('Designation').fill(designation);
    if (status) await page.getByLabel('Employment status').selectOption(status);
    if (office) await page.getByLabel('Office', { exact: true }).selectOption({ label: office });
    await button('Save').click();
  }

  test('add, edit and archive an office', async () => {
    await addOffice('MHO');
    await row('MHO').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Office name').fill('Municipal Health Office');
    await button('Save').click();
    await expect(row('Municipal Health Office')).toBeVisible();
    await row('Municipal Health Office').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('dialog')).toContainText('Archive Municipal Health Office?');
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('No offices found')).toBeVisible();
    expect(await count('SELECT COUNT(*) AS n FROM offices WHERE archived_at IS NOT NULL')).toBe(1);
  });

  test('add, edit and archive an employee; archived shows under Archived and restores', async () => {
    await addOffice('MHO');
    await addEmployee('Ana Cruz', 'MHO');
    await expect(row('Ana Cruz')).toBeVisible();
    await row('Ana Cruz').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Designation').fill('Nurse I');
    await button('Save').click();
    await expect(row('Ana Cruz')).toContainText('Nurse I');

    await row('Ana Cruz').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('No employees found')).toBeVisible();

    await button('Archived').click();
    await expect(row('Ana Cruz')).toBeVisible();
    await row('Ana Cruz').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('No employees found')).toBeVisible();
    await button('Active').click();
    await expect(row('Ana Cruz')).toBeVisible();
  });

  test('archived employee disappears from pick lists but keeps its record', async () => {
    await addOffice('MHO');
    await addEmployee('Ana Cruz', 'MHO');
    await row('Ana Cruz').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('No employees found')).toBeVisible();
    expect(await count("SELECT COUNT(*) AS n FROM employees WHERE full_name = 'Ana Cruz'")).toBe(1);
  });

  test('archived office disappears from the employee office pick list', async () => {
    await addOffice('MHO');
    await addOffice('OLD');
    await row('OLD').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await nav('Employees');
    await button('Add employee').click();
    const options = await page.getByLabel('Office', { exact: true }).locator('option').allTextContents();
    expect(options).toEqual(['Choose an office', 'MHO']);
  });

  test('search by name and filter by office', async () => {
    await addOffice('MHO');
    await addOffice('MEO');
    await addEmployee('Ana Cruz', 'MHO');
    await addEmployee('Ben Reyes', 'MEO');
    await page.getByLabel('Search name').fill('ben');
    await expect(row('Ben Reyes')).toBeVisible();
    await expect(row('Ana Cruz')).toHaveCount(0);
    await page.getByLabel('Search name').fill('');
    await page.getByLabel('Filter by office').selectOption({ label: 'MHO' });
    await expect(row('Ana Cruz')).toBeVisible();
    await expect(row('Ben Reyes')).toHaveCount(0);
  });

  test('search with no match shows the empty message', async () => {
    await addOffice('MHO');
    await addEmployee('Ana Cruz', 'MHO');
    await page.getByLabel('Search name').fill('%');
    await expect(page.getByText('No employees found')).toBeVisible();
  });

  test('employment status offers exactly the 5 values', async () => {
    await nav('Employees');
    await button('Add employee').click();
    const options = await page.getByLabel('Employment status').locator('option').allTextContents();
    expect(options).toEqual(['Permanent', 'Casual', 'Coterminous', 'Contractual', 'Job Order']);
  });

  test('missing name and office show field messages', async () => {
    await addEmployee('', null);
    await expect(page.locator('#emp-fullName-error')).toHaveText('Required');
    await expect(page.locator('#emp-officeId-error')).toHaveText('Required');
    expect(await count('SELECT COUNT(*) AS n FROM employees')).toBe(0);
  });

  test('missing office name shows a field message', async () => {
    await nav('Offices');
    await button('Add office').click();
    await button('Save').click();
    await expect(page.locator('#office-name-error')).toHaveText('Required');
  });

  test('duplicate employee in the same office is rejected', async () => {
    await addOffice('MHO');
    await addEmployee('Juan Dela Cruz', 'MHO');
    await addEmployee('  juan dela cruz ', 'MHO');
    await expect(page.locator('#emp-fullName-error')).toHaveText('This employee already exists in this office');
    expect(await count('SELECT COUNT(*) AS n FROM employees')).toBe(1);
  });

  test('Cancel on the archive dialog changes nothing', async () => {
    await addOffice('MHO');
    await addEmployee('Ana Cruz', 'MHO');
    await row('Ana Cruz').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(row('Ana Cruz')).toBeVisible();
    expect(await count('SELECT COUNT(*) AS n FROM employees WHERE archived_at IS NULL')).toBe(1);
  });

  test('Escape on the archive dialog changes nothing', async () => {
    await addOffice('MHO');
    await row('MHO').getByRole('button', { name: 'Archive' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await count('SELECT COUNT(*) AS n FROM offices WHERE archived_at IS NULL')).toBe(1);
  });

  test('office with active employees cannot be archived', async () => {
    await addOffice('MHO');
    await addEmployee('Ana Cruz', 'MHO');
    await addEmployee('Ben Reyes', 'MHO');
    await nav('Offices');
    await row('MHO').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Move or archive its 2 employees first.');
    expect(await count('SELECT COUNT(*) AS n FROM offices WHERE archived_at IS NULL')).toBe(1);
  });

  test('names with Ñ save and display unchanged', async () => {
    await addOffice('MHO');
    await addEmployee('MARIA PEÑA', 'MHO');
    await expect(row('MARIA PEÑA')).toBeVisible();
    expect(await count("SELECT COUNT(*) AS n FROM employees WHERE full_name = 'MARIA PEÑA'")).toBe(1);
  });

  test('double-clicking Save creates one employee', async () => {
    await addOffice('MHO');
    await nav('Employees');
    await button('Add employee').click();
    await page.getByLabel('Full name').fill('Ana Cruz');
    await page.getByLabel('Office', { exact: true }).selectOption({ label: 'MHO' });
    await button('Save').dblclick();
    await expect(row('Ana Cruz')).toBeVisible();
    expect(await count('SELECT COUNT(*) AS n FROM employees')).toBe(1);
  });
});
