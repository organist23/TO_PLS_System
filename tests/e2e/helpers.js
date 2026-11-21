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
  await page.getByRole('heading', { name: 'Out today' }).waitFor(); // the dashboard opens after login (US-1)
}

export const invoke = (page, channel, payload) => page.evaluate(([c, p]) => window.api.invoke(c, p), [channel, payload]);

// Setup through the real IPC handlers (not the UI under test): office MHO, employees, 2 signatories per role, MAYOR+SB defaults.
export async function seedDirectory(page, employeeNames = ['Ana Cruz', 'Ben Reyes', 'Carla Diaz', 'Dino Lim', 'Ela Santos', 'Fe Ramos']) {
  const officeId = (await invoke(page, 'offices:create', { name: 'MHO' })).data.id;
  const employees = {};
  for (const fullName of employeeNames) {
    employees[fullName] = (await invoke(page, 'employees:create', { fullName, designation: 'Clerk', employmentStatus: 'Permanent', officeId })).data.id;
  }
  const sig = async (name, title, role) => (await invoke(page, 'signatories:create', { name, title, role })).data.id;
  const s = {
    deptHead: await sig('JUAN P. SANTOS', 'DEPARTMENT HEAD', 'recommending'),
    sbSec: await sig('GLENDA P. MINA', 'SB SECRETARY', 'recommending'),
    mayor: await sig('VINCENT E. HERMOSO', 'OIC - MUNICIPAL MAYOR', 'approving'),
    viceMayor: await sig('RIC RONELSON D. ASUNCION', 'MUNICIPAL VICE MAYOR', 'approving'),
  };
  for (const [issuingOffice, role, signatoryId] of [
    ['MAYOR', 'recommending', s.deptHead], ['MAYOR', 'approving', s.mayor],
    ['SB', 'recommending', s.sbSec], ['SB', 'approving', s.viceMayor],
  ]) await invoke(page, 'signatories:setDefault', { issuingOffice, role, signatoryId });
  return { officeId, employees, signatories: s };
}

// Local YYYY-MM of the test machine's clock (hand-derived expectation, not the app's code).
export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// OS boundary fakes: the save dialog returns filePath (or cancels), shell.openPath records what it was asked to open.
export const mockSaveDialog = (app, filePath) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => (f ? { canceled: false, filePath: f } : { canceled: true });
  }, filePath ?? null);

export const mockOpenPath = (app) =>
  app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openPath = async (f) => { globalThis.__opened.push(f); return ''; };
  });

export const openedPaths = (app) => app.evaluate(() => globalThis.__opened);

// Print/Issue blank open the preview first (US-15); this confirms it.
export async function saveFromPreview(page) {
  const preview = page.getByRole('dialog', { name: /^Preview / });
  await preview.getByRole('button', { name: 'Save as Excel' }).click();
}

// A filled record the real way (setup, not the UI under test): issue a blank, then fill it in (US-5 changed: paper first).
// seed = seedDirectory's result. Returns { id, number, formType } like the old direct create.
export async function seedRecord(page, seed, over = {}) {
  const v = {
    formType: 'PLS', issuingOffice: 'MAYOR', dateFiled: '2026-11-20', employeeIds: [Object.values(seed.employees)[0]],
    destination: 'Provincial Capitol', vehicle: '', inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-20',
    departureAt: '2026-11-20T08:00', returnAt: '', purpose: 'Submit reports',
    recommendingId: seed.signatories.deptHead, approvingId: seed.signatories.mayor, ...over,
  };
  const issued = await invoke(page, 'records:issueBlank', { formType: v.formType, issuingOffice: v.issuingOffice, recommendingId: v.recommendingId, approvingId: v.approvingId });
  return (await invoke(page, 'records:fillBlank', { ...v, id: issued.data.ids[0] })).data;
}

// Records page: the Number column of the list, in order (retries until it matches).
export const listNumbers = (page) => page.locator('table tbody tr td:first-child');

// Local YYYY-MM-DD of the test machine's clock, offset by whole days (hand-derived, not the app's code).
export const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Text of each body row of a table, cells joined by " | ".
export const tableRows = (table) =>
  table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent).join(' | ')));

// Forms page: the "Print blank forms" section, which has its own form, office and signatory choices.
export const blankFormsSection = (page) => page.getByRole('region', { name: 'Print blank forms' });
// Forms page: the record form (Fill in or Edit), as opposed to the Print blank forms section.
export const recordForm = (page) => page.locator('#record-form');

// Paper first through the UI: issues one blank in Print blank forms, closes its preview, and opens it through
// Encode a returned form. Leaves the Fill in form open; returns the number. A Mayor's Office blank needs the
// Department Head who signed, chosen with pickDepartmentHead().
export async function openReturnedBlank(page) {
  await page.getByLabel('How many').fill('1');
  await page.getByRole('button', { name: 'Issue blank form', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue blank', exact: true }).click();
  const preview = page.getByRole('dialog', { name: /^Preview / });
  const number = (await preview.getByRole('heading').first().textContent()).replace(/^Preview (PLS|TO) /, '').trim();
  await preview.getByRole('button', { name: 'Close' }).click();
  await page.getByLabel('Number on the returned form').fill(number);
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await page.getByRole('heading', { name: /^Fill in / }).waitFor();
  return number;
}

export const pickDepartmentHead = (page, label = 'JUAN P. SANTOS — DEPARTMENT HEAD') =>
  page.getByLabel('Recommending approval (Department Head who signed)').selectOption({ label });
