import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, seedRecord, invoke, thisMonth } from '../helpers.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Last month on the test machine's clock (hand-derived), e.g. '2026-10' and 'October 2026'.
const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
};

// Moves records into last month (setup: the app numbers only in the current month, so a past month cannot be made through it).
const moveToLastMonth = (pool, ids) => {
  const { period } = lastMonth();
  return pool.query('UPDATE records SET period = ?, number = CONCAT(?, \'-\', seq + 100), seq = seq + 100 WHERE id IN (?)', [period, period, ids]);
};

test.describe('US-18 Delete unused blanks of a past month', () => {
  let app, page, pool, m, last, blanks, filledOld;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    m = thisMonth();
    last = lastMonth();
    const seed = await seedDirectory(page, ['Ana Cruz']);
    blanks = (await invoke(page, 'records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', approvingId: seed.signatories.mayor, count: 3 })).data;
    filledOld = await seedRecord(page, seed);
    await moveToLastMonth(pool, [blanks.ids[0], blanks.ids[1], filledOld.id]); // 2 unused blanks + 1 filled record last month
    await invoke(page, 'records:archive', { id: blanks.ids[1] }); // a voided blank counts too
    await page.getByRole('navigation').getByRole('button', { name: 'New record' }).click();
    await page.getByRole('heading', { name: 'New record' }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const ids = async () => (await pool.query('SELECT id FROM records ORDER BY id'))[0].map((r) => r.id);
  const deleteButton = () => page.getByRole('button', { name: `Delete 2 unused blanks of ${last.label}` });

  test('a past month shows its unused count; the current month has no button', async () => {
    await expect(deleteButton()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete \d+ unused blanks of / })).toHaveCount(1);
  });

  test('the confirmation names month, count and that it cannot be undone; Cancel deletes nothing', async () => {
    await deleteButton().click();
    const dialog = page.getByRole('dialog', { name: `Delete 2 unused blanks of ${last.label}?` });
    await expect(dialog).toContainText('Their numbers were never used. This cannot be undone.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await ids()).toHaveLength(4);
  });

  test("Delete removes that month's unused blanks only", async () => {
    await deleteButton().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(`Deleted 2 unused blanks of ${last.label}`);
    expect(await ids()).toEqual([blanks.ids[2], filledOld.id].sort((a, b) => a - b));
    await expect(page.getByRole('button', { name: /^Delete \d+ unused blanks of / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Fill in ${m}-3` })).toBeVisible();
  });
});
