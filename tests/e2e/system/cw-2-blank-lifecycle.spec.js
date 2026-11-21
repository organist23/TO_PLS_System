import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, thisMonth, localDay, tableRows } from '../helpers.js';

// CW-2: US-1 → US-7 → US-8 → US-11. Asserts the hand-offs between stories, not each story's edge cases.
test('CW-2 blank form lifecycle', async () => {
  const { app, page, pool } = await launchApp();
  try {
    await loginAsChangedAdmin(page); // US-1
    await seedDirectory(page, ['Ana Cruz']);
    const m = thisMonth();
    const nav = (name) => page.getByRole('navigation').getByRole('button', { name }).click();
    const button = (name) => page.getByRole('button', { name, exact: true });
    const outRows = () => tableRows(page.getByRole('table'));

    await nav('Forms'); // US-7: issue a numbered blank
    await button('Issue blank form').click();
    await page.getByRole('dialog', { name: /^Issue a blank PLS/ }).getByRole('button', { name: 'Issue blank' }).click();
    const preview = page.getByRole('dialog', { name: `Preview PLS ${m}-1` });
    await preview.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('status')).toHaveText(`Issued blank PLS ${m}-1`);

    await nav('Out today'); // a blank is not "out"
    await expect(page.getByText('No one is out on this date')).toBeVisible();

    await nav('Records'); // US-7 fill in, reached from the record list
    await page.getByLabel('Status').selectOption({ label: 'Blank issued' });
    await page.getByRole('button', { name: `Open ${m}-1` }).click();
    await button('Fill in').click();
    await page.getByLabel('Employee', { exact: true }).selectOption({ label: 'Ana Cruz — MHO' });
    await button('Add').click();
    await page.getByLabel('Destination').fill('Provincial Capitol');
    await page.getByLabel('Inclusive from').fill(localDay(0));
    await page.getByLabel('Inclusive to').fill(localDay(0));
    await page.getByLabel('Departure').fill(`${localDay(0)}T08:00`);
    await page.getByLabel('Purpose').fill('Submit reports');
    await page.getByLabel('Recommending approval (Department Head who signed)').selectOption({ label: 'JUAN P. SANTOS — DEPARTMENT HEAD' });
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-1`);

    await nav('Out today'); // US-11: the filled form is out today, same number
    await expect.poll(outRows).toEqual([`MHO | Ana Cruz | PLS | ${m}-1 | Provincial Capitol | ${localDay(0)} to ${localDay(0)} | —`]);

    await nav('Records'); // US-8: move the travel to tomorrow
    await page.getByRole('button', { name: `Open ${m}-1` }).click();
    await button('Edit').click();
    await page.getByLabel('Inclusive to').fill(localDay(1));
    await page.getByLabel('Inclusive from').fill(localDay(1));
    await button('Save').click();
    await expect(page.getByRole('status')).toHaveText(`Saved PLS ${m}-1`);

    await nav('Out today'); // US-11 follows the edit
    await expect(page.getByText('No one is out on this date')).toBeVisible();
    await page.getByLabel('Date').fill(localDay(1));
    await expect.poll(outRows).toEqual([`MHO | Ana Cruz | PLS | ${m}-1 | Provincial Capitol | ${localDay(1)} to ${localDay(1)} | —`]);
  } finally {
    await app.close();
    await pool.end();
  }
});
