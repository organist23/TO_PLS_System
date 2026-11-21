import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, seedRecord, invoke, thisMonth, listNumbers } from '../helpers.js';

test.describe('US-9 Archive and restore a record', () => {
  let app, page, pool, m, seed, rec;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    m = thisMonth();
    seed = await seedDirectory(page, ['Ana Cruz']);
    rec = await seedRecord(page, seed); // M-1
    await page.getByRole('navigation').getByRole('button', { name: 'Records' }).click();
    await expect(listNumbers(page)).toHaveText([`${m}-1`]);
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });
  const archivedAt = async (id) => (await pool.query('SELECT archived_at FROM records WHERE id = ?', [id]))[0][0].archived_at;

  async function archiveOpen(number) {
    await page.getByRole('button', { name: `Open ${number}` }).click();
    await button('Archive').click();
    return page.getByRole('dialog', { name: new RegExp(`^Archive .* ${number}\\?$`) });
  }

  test('Archive asks for confirmation naming the record number; Cancel changes nothing', async () => {
    const dialog = await archiveOpen(`${m}-1`);
    await expect(dialog.getByRole('heading')).toHaveText(`Archive PLS ${m}-1?`);
    await expect(dialog).toContainText('It will be hidden from lists, reports and "out today". Its number is never reused. You can restore it from Archived.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await archivedAt(rec.id)).toBeNull();
    await expect(button('Archive')).toBeVisible();
  });

  test('archiving hides it from the default list; Archived shows it; Restore brings it back', async () => {
    const dialog = await archiveOpen(`${m}-1`);
    await dialog.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('status')).toHaveText(`Archived ${m}-1`);
    await expect(page.getByText('No records found')).toBeVisible();
    expect(await archivedAt(rec.id)).not.toBeNull();
    await page.getByLabel('Status').selectOption({ label: 'Archived' });
    await expect(listNumbers(page)).toHaveText([`${m}-1`]);
    await expect(page.locator('table tbody tr td').nth(6)).toHaveText('Archived');
    await page.getByRole('button', { name: `Open ${m}-1` }).click();
    for (const name of ['Edit', 'Print', 'Archive', 'Fill in']) await expect(button(name)).toHaveCount(0);
    await button('Restore').click();
    await expect(page.getByRole('status')).toHaveText(`Restored ${m}-1`);
    await expect(button('Edit')).toBeVisible();
    expect(await archivedAt(rec.id)).toBeNull();
    await button('Back to list').click();
    await page.getByLabel('Status').selectOption({ label: 'Active' });
    await expect(listNumbers(page)).toHaveText([`${m}-1`]);
  });

  test('restoring a filled record warns on overlap; Cancel keeps it archived; Restore anyway restores', async () => {
    const dialog = await archiveOpen(`${m}-1`); // Ana Cruz, 2026-11-20
    await dialog.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('status')).toHaveText(`Archived ${m}-1`);
    await seedRecord(page, seed); // M-2: Ana Cruz, 2026-11-20
    await page.getByLabel('Status').selectOption({ label: 'Archived' });
    await page.getByRole('button', { name: `Open ${m}-1` }).click();
    await button('Restore').click();
    const warn = page.getByRole('dialog', { name: 'Possible overlap' });
    await expect(warn).toContainText(`Ana Cruz already has PLS ${m}-2 on 2026-11-20 to 2026-11-20`);
    await warn.getByRole('button', { name: 'Cancel' }).click();
    await expect(warn).toBeHidden();
    expect(await archivedAt(rec.id)).not.toBeNull();
    await expect(button('Restore')).toBeVisible();
    await button('Restore').click();
    await warn.getByRole('button', { name: 'Restore anyway' }).click();
    await expect(page.getByRole('status')).toHaveText(`Restored ${m}-1`);
    expect(await archivedAt(rec.id)).toBeNull();
  });

  test("an archived record's number is never reused", async () => {
    const dialog = await archiveOpen(`${m}-1`);
    await dialog.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('status')).toHaveText(`Archived ${m}-1`);
    expect((await seedRecord(page, seed)).number).toBe(`${m}-2`);
  });

  test('a Blank issued form can be archived and its number stays reserved', async () => {
    const issued = (await invoke(page, 'records:issueBlank', { formType: 'PLS', issuingOffice: 'MAYOR', recommendingId: seed.signatories.deptHead, approvingId: seed.signatories.mayor })).data;
    const blank = { id: issued.ids[0], number: issued.numbers[0] };
    expect(blank.number).toBe(`${m}-2`);
    await page.getByLabel('Search').fill(`${m}-2`);
    await expect(listNumbers(page)).toHaveText([`${m}-2`]);
    const dialog = await archiveOpen(`${m}-2`);
    await dialog.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('status')).toHaveText(`Archived ${m}-2`);
    expect(await archivedAt(blank.id)).not.toBeNull();
    expect((await seedRecord(page, seed, { inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21' })).number).toBe(`${m}-3`);
  });

  test('no permanent delete exists', async () => {
    await expect(page.getByRole('button', { name: /delete|remove/i })).toHaveCount(0);
    await page.getByRole('button', { name: `Open ${m}-1` }).click();
    await expect(button('Edit')).toBeVisible();
    await expect(page.getByRole('button', { name: /delete|remove/i })).toHaveCount(0);
    expect(await invoke(page, 'records:delete', { id: rec.id }).catch((e) => e.message)).toMatch(/Channel not allowed/);
  });
});
