import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, loginAsChangedAdmin, seedDirectory, seedRecord, mockOpenDialog } from '../helpers.js';

test.describe('US-13 Back up the database', () => {
  let app, page, pool, dir;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-us13-'));
    await loginAsChangedAdmin(page);
    const seed = await seedDirectory(page, ['MARIA PEÑA']);
    await seedRecord(page, seed);
    await page.getByRole('navigation').getByRole('button', { name: 'Backup' }).click();
    await page.getByRole('heading', { name: 'Backup', exact: true }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  test('Back up writes a .sql named with date and time to the chosen folder and shows its path', async () => {
    await mockOpenDialog(app, dir);
    const before = new Date();
    await page.getByRole('button', { name: 'Back up now' }).click();
    const status = page.getByRole('status');
    await expect(status).toHaveText(/^Backup saved to /);
    const [file] = fs.readdirSync(dir);
    // Hand-derived name: the minute the click happened (or the next, if the minute turned during the backup).
    const pad = (n) => String(n).padStart(2, '0');
    const nameAt = (d) => `pls-to-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.sql`;
    expect([nameAt(before), nameAt(new Date(before.getTime() + 60000))]).toContain(file);
    await expect(status).toHaveText(`Backup saved to ${path.join(dir, file)}`);
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    expect(text).toMatch(/^-- PLS-TO Records System backup v1 schema \d+\n/);
    expect(text).toContain('MARIA PEÑA');
    expect(text.endsWith('-- end of backup\n')).toBe(true);
  });

  test('a failed backup shows the error and leaves no file', async () => {
    const gone = path.join(dir, 'unplugged-usb');
    await mockOpenDialog(app, gone);
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByRole('alert')).toHaveText(/^Could not save the backup: /);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test('cancelling the folder choice writes nothing and shows nothing', async () => {
    await mockOpenDialog(app, null);
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByRole('button', { name: 'Back up now' })).toBeEnabled();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
