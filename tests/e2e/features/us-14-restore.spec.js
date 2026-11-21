import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, loginAsChangedAdmin, login, NEW_PASSWORD, seedDirectory, seedRecord, invoke, mockOpenDialog } from '../helpers.js';

test.describe('US-14 Restore from a backup', () => {
  let app, page, pool, backupDir, dir, backupFile;
  test.beforeEach(async () => {
    ({ app, page, pool, backupDir } = await launchApp());
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-us14-'));
    await loginAsChangedAdmin(page);
    const seed = await seedDirectory(page, ['Ana Cruz']);
    await seedRecord(page, seed); // one record in the backup
    await mockOpenDialog(app, dir);
    backupFile = (await invoke(page, 'backup:create')).data.path;
    await invoke(page, 'offices:create', { name: 'ADDED AFTER BACKUP' }); // current data that a restore replaces
    await page.getByRole('navigation').getByRole('button', { name: 'Backup' }).click();
    await page.getByRole('heading', { name: 'Backup', exact: true }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const offices = async () => (await pool.query('SELECT name FROM offices ORDER BY name'))[0].map((r) => r.name);
  async function pick(file) {
    await mockOpenDialog(app, file);
    await page.getByRole('button', { name: 'Restore from a backup' }).click();
  }

  test('the confirmation names the file and that all data is replaced; Cancel changes nothing', async () => {
    await pick(backupFile);
    const dialog = page.getByRole('dialog', { name: `Restore ${path.basename(backupFile)}?` });
    await expect(dialog).toContainText('All current data will be replaced by this backup. A backup of the current data is saved first.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await offices()).toEqual(['ADDED AFTER BACKUP', 'MHO']);
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  test('restore saves the current data first, replaces it, and logs everyone out', async () => {
    await pick(backupFile);
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
    const notice = page.getByRole('status');
    await expect(notice).toContainText(`Data restored from ${path.basename(backupFile)}. A backup of the previous data was saved to ${backupDir}`);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    const [auto] = fs.readdirSync(backupDir);
    expect(auto).toMatch(/^pls-to-backup-\d{4}-\d{2}-\d{2}-\d{4}-before-restore\.sql$/);
    await expect(notice).toHaveText(`Data restored from ${path.basename(backupFile)}. A backup of the previous data was saved to ${path.join(backupDir, auto)}. Please log in again.`);
    expect(fs.readFileSync(path.join(backupDir, auto), 'utf8')).toContain('ADDED AFTER BACKUP');
    expect(await offices()).toEqual(['MHO']);
    expect(await invoke(page, 'offices:list', {})).toEqual({ ok: false, error: 'Not logged in' }); // the session really ended
    await login(page, 'admin', NEW_PASSWORD); // the restored users table
    await expect(page.getByRole('heading', { name: 'Out today' })).toBeVisible();
  });

  test('a file that is not a backup is rejected, data unchanged, still logged in', async () => {
    const bad = path.join(dir, 'not-a-backup.sql');
    fs.writeFileSync(bad, 'DROP TABLE records;\n');
    await pick(bad);
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('This file is not a backup of the PLS-TO Records System. Nothing was changed.');
    expect(await offices()).toEqual(['ADDED AFTER BACKUP', 'MHO']);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM records');
    expect(n).toBe(1);
    await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  });
});
