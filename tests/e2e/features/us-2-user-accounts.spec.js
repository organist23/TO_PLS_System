import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, login, NEW_PASSWORD, invoke } from '../helpers.js';

test.describe('US-2 Manage user accounts (admin)', () => {
  let app, page, pool;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
    await page.getByRole('navigation').getByRole('button', { name: 'Users' }).click();
    await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const button = (name) => page.getByRole('button', { name, exact: true });
  const row = (username) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: username, exact: true }) });

  async function addUser({ username = 'encoder1', fullName = 'Ana Cruz', role = 'Encoder', password = 'Temp-pass-1' } = {}) {
    await button('Add user').click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Full name').fill(fullName);
    await page.getByLabel('Role').selectOption({ label: role });
    await page.getByLabel('Temporary password').fill(password);
    await button('Save').click();
  }
  async function logout() {
    await button('Log out').click();
    await button('Sign in').waitFor();
  }
  // Logs in with a temporary password and sets a new one (the US-1 screen).
  async function firstLogin(username, temp, next) {
    await login(page, username, temp);
    await page.getByLabel('New password', { exact: true }).fill(next);
    await page.getByLabel('Confirm new password').fill(next);
    await button('Save password').click();
    await page.getByRole('heading', { name: 'Out today' }).waitFor();
  }

  test('admin adds a user; fields are checked; a duplicate username is refused', async () => {
    await button('Add user').click();
    await button('Save').click();
    await expect(page.locator('#usr-username-error')).toHaveText('Required');
    await expect(page.locator('#usr-fullName-error')).toHaveText('Required');
    await expect(page.locator('#usr-password-error')).toHaveText('At least 8 characters');
    await button('Cancel').click();
    await addUser();
    await expect(page.getByRole('status')).toHaveText('Added encoder1. They must choose a new password at the first login.');
    await expect(row('encoder1').getByRole('cell')).toHaveText(['encoder1', 'Ana Cruz', 'Encoder', 'ActiveMust change password', /Reset password/]);
    await addUser({ username: ' Encoder1 ', fullName: 'Someone Else' });
    await expect(page.locator('#usr-username-error')).toHaveText('Username already taken');
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
    expect(n).toBe(2);
  });

  test('a new encoder must set a password, sees no Users page and no Restore, and admin routes refuse them', async () => {
    await addUser();
    await logout();
    await firstLogin('encoder1', 'Temp-pass-1', 'Encoder-pass-1');
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Users' })).toHaveCount(0);
    await page.getByRole('navigation').getByRole('button', { name: 'Backup' }).click();
    await expect(button('Back up now')).toBeVisible();
    await expect(button('Restore from a backup')).toHaveCount(0);
    expect(await invoke(page, 'users:list')).toEqual({ ok: false, error: 'Admins only' });
    expect(await invoke(page, 'backup:restore')).toEqual({ ok: false, error: 'Admins only' });
  });

  test('a reset password is temporary: the user must choose a new one at the next login', async () => {
    await addUser();
    await pool.query("UPDATE users SET must_change_password = 0 WHERE username = 'encoder1'"); // as if they already chose one
    await row('encoder1').getByRole('button', { name: 'Reset password of encoder1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset the password of Ana Cruz?' });
    await dialog.getByLabel('Temporary password').fill('short');
    await dialog.getByRole('button', { name: 'Reset password' }).click();
    await expect(dialog.locator('#reset-password-error')).toHaveText('At least 8 characters');
    await dialog.getByLabel('Temporary password').fill('Reset-pass-2');
    await dialog.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('status')).toHaveText('Password reset. encoder1 must choose a new one at the next login.');
    await logout();
    await login(page, 'encoder1', 'Temp-pass-1');
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
    await login(page, 'encoder1', 'Reset-pass-2');
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible(); // the US-1 change screen, not the app
  });

  test('disable after a named confirmation (Cancel changes nothing); a disabled user cannot log in; enable restores access', async () => {
    await addUser();
    await row('encoder1').getByRole('button', { name: 'Disable encoder1' }).click();
    const dialog = page.getByRole('dialog', { name: 'Disable Ana Cruz (encoder1)?' });
    await expect(dialog).toContainText('They will not be able to log in, and any open session ends now. You can enable them again later.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const active = async () => (await pool.query("SELECT active FROM users WHERE username = 'encoder1'"))[0][0].active;
    expect(await active()).toBe(1);
    await row('encoder1').getByRole('button', { name: 'Disable encoder1' }).click();
    await dialog.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Disabled Ana Cruz (encoder1)');
    await expect(row('encoder1')).toContainText('Disabled');
    expect(await active()).toBe(0);
    await logout();
    await login(page, 'encoder1', 'Temp-pass-1');
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
    await login(page, 'admin', NEW_PASSWORD);
    await page.getByRole('navigation').getByRole('button', { name: 'Users' }).click();
    await row('encoder1').getByRole('button', { name: 'Enable encoder1' }).click();
    await page.getByRole('dialog', { name: 'Enable Ana Cruz (encoder1)?' }).getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Enabled Ana Cruz (encoder1)');
    await logout();
    await login(page, 'encoder1', 'Temp-pass-1');
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  });

  test('an admin cannot disable their own account or the last active admin', async () => {
    await expect(row('admin').getByRole('button')).toHaveCount(0); // no actions on your own row
    const [[me]] = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    expect(await invoke(page, 'users:setActive', { id: me.id, active: false })).toEqual({ ok: false, error: 'You cannot disable your own account.' });
    // A second admin disables the first; then the last active admin cannot be disabled by anyone.
    await addUser({ username: 'admin2', fullName: 'Second Admin', role: 'Admin' });
    await logout();
    await firstLogin('admin2', 'Temp-pass-1', 'Admin2-pass-1');
    await page.getByRole('navigation').getByRole('button', { name: 'Users' }).click();
    await row('admin').getByRole('button', { name: 'Disable admin' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Disabled Administrator (admin)');
    const [[a2]] = await pool.query("SELECT id FROM users WHERE username = 'admin2'");
    expect(await invoke(page, 'users:setActive', { id: a2.id, active: false })).toEqual({ ok: false, error: 'You cannot disable your own account.' });
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1");
    expect(n).toBe(1);
  });
});
