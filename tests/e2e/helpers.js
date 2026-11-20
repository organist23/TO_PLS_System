import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { freshTestDb, testConfig } from '../helpers/testDb.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const NEW_PASSWORD = 'Test-pass-123'; // test database only

// Fresh pls_to_test database, then the app pointed at it. E2E_EXE runs the packaged build instead of source.
export async function launchApp({ env = {} } = {}) {
  const { database } = testConfig(); // throws unless the name ends in _test
  const pool = await freshTestDb();
  const appEnv = { ...process.env, DB_NAME: database, PLS_TO_ENV_FILE: path.join(root, '.env'), ...env };
  delete appEnv.ELECTRON_RUN_AS_NODE; // set by VS Code terminals; makes Electron start as plain Node
  const app = await electron.launch({
    ...(process.env.E2E_EXE ? { executablePath: process.env.E2E_EXE, args: [] } : { args: [root] }),
    env: appEnv,
  });
  const page = await app.firstWindow();
  return { app, page, pool };
}

export async function login(page, username = 'admin', password = 'admin') {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function loginAsChangedAdmin(page) {
  await login(page);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();
  await page.getByRole('heading', { name: 'Employees' }).waitFor();
}

export const invoke = (page, channel, payload) => page.evaluate(([c, p]) => window.api.invoke(c, p), [channel, payload]);
