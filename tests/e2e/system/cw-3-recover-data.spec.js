import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, loginAsChangedAdmin, login, NEW_PASSWORD, seedDirectory, seedRecord, thisMonth, listNumbers, mockOpenDialog } from '../helpers.js';

// CW-3: US-13 → US-14 → US-1 → US-10. Asserts the hand-offs between stories, not each story's edge cases.
test('CW-3 recover data', async () => {
  const { app, page, pool } = await launchApp();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-cw3-'));
    await loginAsChangedAdmin(page);
    const seed = await seedDirectory(page, ['Ana Cruz']);
    const m = thisMonth();
    await seedRecord(page, seed); // <m>-1
    const nav = (name) => page.getByRole('navigation').getByRole('button', { name }).click();

    await mockOpenDialog(app, dir); // US-13: back up to a folder (USB)
    await nav('Backup');
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByRole('status')).toHaveText(/^Backup saved to /);
    const [file] = fs.readdirSync(dir);

    await seedRecord(page, seed, { inclusiveFrom: '2026-11-25', inclusiveTo: '2026-11-25', departureAt: '2026-11-25T08:00' }); // <m>-2, lost in the "failure"

    await mockOpenDialog(app, path.join(dir, file)); // US-14: restore it
    await page.getByRole('button', { name: 'Restore from a backup' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(`Data restored from ${file}.`);

    await login(page, 'admin', NEW_PASSWORD); // US-1: log in again with the restored account
    await nav('Records'); // US-10: the backed-up records, and only those
    await expect(listNumbers(page)).toHaveText([`${m}-1`]);
  } finally {
    await app.close();
    await pool.end();
  }
});
