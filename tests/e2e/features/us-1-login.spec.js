import { test, expect } from '@playwright/test';
import { launchApp, login, loginAsChangedAdmin, invoke, NEW_PASSWORD } from '../helpers.js';

test.describe('US-1 Log in and log out', () => {
  let app, page, pool;
  test.beforeEach(async () => ({ app, page, pool } = await launchApp()));
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const alert = () => page.getByRole('alert');

  test('valid login, after the forced change, opens the dashboard', async () => {
    await loginAsChangedAdmin(page);
    await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
    await expect(page.getByText('Administrator')).toBeVisible();
  });

  test('first run forces a password change and rejects a short one', async () => {
    await login(page);
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill('short');
    await page.getByLabel('Confirm new password').fill('short');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('At least 8 characters')).toBeVisible();
  });

  test('mismatched confirmation is rejected before saving', async () => {
    await login(page);
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm new password').fill('Other-pass-123');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
    const [[{ m }]] = await pool.query("SELECT must_change_password AS m FROM users WHERE username='admin'");
    expect(m).toBe(1);
  });

  test('wrong password shows the generic message', async () => {
    await login(page, 'admin', 'wrong-pass');
    await expect(alert()).toHaveText('Invalid username or password');
  });

  test('unknown username shows the same generic message', async () => {
    await login(page, 'nobody', 'admin');
    await expect(alert()).toHaveText('Invalid username or password');
  });

  test('disabled account cannot log in', async () => {
    await pool.query("UPDATE users SET active = 0 WHERE username = 'admin'");
    await login(page);
    await expect(alert()).toHaveText('Invalid username or password');
  });

  test('passwords are stored hashed', async () => {
    await loginAsChangedAdmin(page);
    const [[{ h }]] = await pool.query("SELECT password_hash AS h FROM users WHERE username='admin'");
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain(NEW_PASSWORD);
  });

  test('before the password change, data calls are refused', async () => {
    await login(page);
    await page.getByRole('heading', { name: 'Set a new password' }).waitFor();
    expect(await invoke(page, 'employees:list', {})).toEqual({ ok: false, error: 'Change your password first' });
  });

  test('logout ends the session; data calls are refused after it', async () => {
    await loginAsChangedAdmin(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(await invoke(page, 'employees:list', {})).toEqual({ ok: false, error: 'Not logged in' });
    expect(await invoke(page, 'auth:me')).toEqual({ ok: true, data: null });
  });

  test('a page cannot be opened without a session (reload stays on login)', async () => {
    await loginAsChangedAdmin(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('new password works and the default no longer does', async () => {
    await loginAsChangedAdmin(page);
    await page.getByRole('button', { name: 'Log out' }).click();
    await login(page, 'admin', 'admin');
    await expect(alert()).toHaveText('Invalid username or password');
    await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
  });

  test('double-clicking Sign in logs in once without error', async () => {
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).dblclick();
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    await expect(alert()).toHaveCount(0);
  });
});

test.describe('US-1 startup without a database', () => {
  test('shows a readable error with the config file path', async () => {
    const { app, page, pool } = await launchApp({ env: { DB_PORT: '1' } });
    try {
      await expect(page.getByRole('heading', { name: 'Cannot connect to the database' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Config file: .*\.env/)).toBeVisible();
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
