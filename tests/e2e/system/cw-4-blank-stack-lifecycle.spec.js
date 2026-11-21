import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, thisMonth, localDay, tableRows } from '../helpers.js';

// CW-4: US-16 → US-17 → US-11 → US-18. Asserts the hand-offs between stories, not each story's edge cases.
test('CW-4 blank stack lifecycle', async () => {
  const { app, page, pool } = await launchApp();
  try {
    await loginAsChangedAdmin(page);
    await seedDirectory(page, ['Ana Cruz']);
    const m = thisMonth();
    const nav = (name) => page.getByRole('navigation').getByRole('button', { name }).click();
    const button = (name) => page.getByRole('button', { name, exact: true });

    await nav('Forms'); // US-16: a stack of 3 on the desk
    await page.getByLabel('How many').fill('3');
    await button('Issue blank form').click();
    await button('Issue 3 blanks').click();
    await page.getByRole('dialog', { name: `Preview PLS ${m}-1` }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('status')).toHaveText(`Issued 3 blank PLS: ${m}-1 to ${m}-3`);

    // US-17: Ana took the middle paper; HR types its number
    await page.getByLabel('Number on the returned form').fill(`${m}-2`);
    await button('Find').click();
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ana Cruz — MHO' });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Provincial Capitol');
    await page.getByLabel('Inclusive from').fill(localDay(0));
    await page.getByLabel('Inclusive to').fill(localDay(0));
    await page.getByLabel('Departure').fill(`${localDay(0)}T08:00`);
    await page.getByLabel('Purpose').fill('Submit reports');
    await page.getByLabel('Recommending approval (Department Head who signed)').selectOption({ label: 'JUAN P. SANTOS — DEPARTMENT HEAD' });
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-2`);

    await nav('Out today'); // US-11: the encoded paper shows who is out, under its printed number
    await expect.poll(() => tableRows(page.getByRole('table'))).toEqual([
      `MHO | Ana Cruz | PLS | ${m}-2 | Provincial Capitol | ${localDay(0)} to ${localDay(0)} | —`,
    ]);

    // The month ends with two papers unused (moved to last month: the app only numbers in the current month).
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    await pool.query("UPDATE records SET period = ?, number = CONCAT(?, '-', seq + 100), seq = seq + 100 WHERE status = 'blank'", [period, period]);

    await nav('Forms'); // US-18: the unused papers are deleted, the encoded one stays
    await page.getByRole('button', { name: /^Delete 2 unused blanks of / }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(/^Deleted 2 unused blanks of /);
    const [rows] = await pool.query('SELECT number, status FROM records');
    expect(rows).toEqual([{ number: `${m}-2`, status: 'filled' }]);
  } finally {
    await app.close();
    await pool.end();
  }
});
