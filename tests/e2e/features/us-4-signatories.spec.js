import { test, expect } from '@playwright/test';
import { launchApp, loginAsChangedAdmin, seedDirectory, invoke } from '../helpers.js';

test.describe('US-4 Manage signatories', () => {
  let app, page, pool;
  test.beforeEach(async () => {
    ({ app, page, pool } = await launchApp());
    await loginAsChangedAdmin(page);
  });
  test.afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const nav = (name) => page.getByRole('navigation').getByRole('button', { name }).click();
  const button = (name) => page.getByRole('button', { name, exact: true });
  const row = (name) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
  const count = async (sql) => (await pool.query(sql))[0][0].n;

  async function addSignatory(name, title, role) {
    await button('Add signatory').click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Role').selectOption(role);
    await button('Save').click();
  }

  test('add a signatory with name, title and role; edit it', async () => {
    await nav('Signatories');
    await addSignatory('VINCENT E. HERMOSO', 'OIC - MUNICIPAL MAYOR', 'approving');
    await expect(row('VINCENT E. HERMOSO')).toContainText('Approving');
    await row('VINCENT E. HERMOSO').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill('ACTING MUNICIPAL MAYOR');
    await button('Save').click();
    await expect(row('VINCENT E. HERMOSO')).toContainText('ACTING MUNICIPAL MAYOR');
  });

  test('name and title are required', async () => {
    await nav('Signatories');
    await addSignatory('', '', 'approving');
    await expect(page.locator('#sig-name-error')).toHaveText('Required');
    await expect(page.locator('#sig-title-error')).toHaveText('Required');
    expect(await count('SELECT COUNT(*) AS n FROM signatories')).toBe(0);
  });

  test('set all 4 office defaults', async () => {
    await nav('Signatories');
    await addSignatory('JUAN P. SANTOS', 'DEPARTMENT HEAD', 'recommending');
    await addSignatory('GLENDA P. MINA', 'SB SECRETARY', 'recommending');
    await addSignatory('VINCENT E. HERMOSO', 'OIC - MUNICIPAL MAYOR', 'approving');
    await addSignatory('RIC RONELSON D. ASUNCION', 'MUNICIPAL VICE MAYOR', 'approving');
    await expect(row('RIC RONELSON D. ASUNCION')).toBeVisible();
    const pickDefault = async (label, option) => {
      await page.getByLabel(label).selectOption({ label: option });
      await expect(page.getByLabel(label)).toBeEnabled();
    };
    await pickDefault("Mayor's Office — recommending", 'JUAN P. SANTOS — DEPARTMENT HEAD');
    await pickDefault("Mayor's Office — approving", 'VINCENT E. HERMOSO — OIC - MUNICIPAL MAYOR');
    await pickDefault('Sangguniang Bayan — recommending', 'GLENDA P. MINA — SB SECRETARY');
    await pickDefault('Sangguniang Bayan — approving', 'RIC RONELSON D. ASUNCION — MUNICIPAL VICE MAYOR');
    await expect.poll(async () => {
      const [rows] = await pool.query(
        'SELECT d.issuing_office AS o, d.role AS r, s.name FROM signatory_defaults d JOIN signatories s ON s.id = d.signatory_id ORDER BY o, r',
      );
      return rows.map((x) => `${x.o}/${x.r}/${x.name}`);
    }).toEqual([ // ENUM columns sort by declared position: recommending before approving
      'MAYOR/recommending/JUAN P. SANTOS', 'MAYOR/approving/VINCENT E. HERMOSO',
      'SB/recommending/GLENDA P. MINA', 'SB/approving/RIC RONELSON D. ASUNCION',
    ]);
  });

  test('a default signatory cannot be archived', async () => {
    await seedDirectory(page);
    await nav('Signatories');
    await row('GLENDA P. MINA').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('dialog')).toContainText('Archive GLENDA P. MINA?');
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
      'It is the default for Sangguniang Bayan. Choose another default first.',
    );
    expect(await count('SELECT COUNT(*) AS n FROM signatories WHERE archived_at IS NOT NULL')).toBe(0);
  });

  test('archive Cancel changes nothing', async () => {
    await nav('Signatories');
    await addSignatory('ARNEL A. HERRERA', 'OIC-MUNICIPAL VICE MAYOR', 'approving');
    await row('ARNEL A. HERRERA').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await count('SELECT COUNT(*) AS n FROM signatories WHERE archived_at IS NULL')).toBe(1);
  });

  test('archive, find under Archived, restore; archived is not pickable on new records', async () => {
    await seedDirectory(page);
    await nav('Signatories');
    await addSignatory('ARNEL A. HERRERA', 'OIC-MUNICIPAL VICE MAYOR', 'approving');
    await row('ARNEL A. HERRERA').getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(row('ARNEL A. HERRERA')).toHaveCount(0);

    await nav('New record');
    const options = await page.getByLabel('Approved by').locator('option').allTextContents();
    expect(options.some((o) => o.includes('ARNEL'))).toBe(false);

    await nav('Signatories');
    await button('Archived').click();
    await row('ARNEL A. HERRERA').getByRole('button', { name: 'Restore' }).click();
    await button('Active').click();
    await expect(row('ARNEL A. HERRERA')).toBeVisible();
  });

  test('a saved record keeps the signatory name and title after the signatory is edited', async () => {
    const { employees, signatories } = await seedDirectory(page);
    await invoke(page, 'records:create', {
      formType: 'PLS', issuingOffice: 'MAYOR', dateFiled: '2026-11-21', employeeIds: [employees['Ana Cruz']],
      destination: 'Capitol', inclusiveFrom: '2026-11-21', inclusiveTo: '2026-11-21', departureAt: '2026-11-21T08:00',
      purpose: 'Reports', recommendingId: signatories.deptHead, approvingId: signatories.mayor,
    });
    await nav('Signatories');
    await row('VINCENT E. HERMOSO').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Name', { exact: true }).fill('BRENDALIE C. PARAGAS');
    await button('Save').click();
    await expect(row('BRENDALIE C. PARAGAS')).toBeVisible();
    const [[r]] = await pool.query('SELECT approving_name AS n, approving_title AS t FROM records');
    expect(r).toEqual({ n: 'VINCENT E. HERMOSO', t: 'OIC - MUNICIPAL MAYOR' });
  });
});
