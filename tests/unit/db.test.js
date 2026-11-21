import { test, expect, afterAll } from 'vitest';
import { freshTestDb, testConfig } from '../helpers/testDb.js';
import { migrate } from '../../src/main/db.js';
import { ensureAdmin } from '../../src/main/auth.js';
import { createOffice, createEmployee } from '../../src/main/directory.js';
import { createSignatory } from '../../src/main/signatories.js';
import { createRecord } from '../../src/main/records.js';

let pool;
afterAll(() => pool?.end());

test('freshTestDb creates all tables', async () => {
  pool = await freshTestDb();
  const [rows] = await pool.query('SHOW TABLES');
  expect(rows.map((r) => Object.values(r)[0]).sort()).toEqual(['employees', 'offices', 'record_employees', 'records', 'schema_version', 'signatories', 'signatory_defaults', 'users']);
});

test('migrate twice keeps version 2', async () => {
  await expect(migrate(testConfig())).resolves.toBeUndefined();
  const [[{ version }]] = await pool.query('SELECT version FROM schema_version');
  expect(version).toBe(2);
  const [cols] = await pool.query("SHOW COLUMNS FROM records LIKE 'status'");
  expect(cols[0]).toMatchObject({ Type: "enum('filled','blank')", Default: 'filled' });
});

test('a v1 database with a record migrates intact', async () => {
  const p = await freshTestDb();
  try {
    await ensureAdmin(p);
    const officeId = (await createOffice(p, { name: 'MHO' })).data.id;
    const emp = (await createEmployee(p, { fullName: 'Ana', employmentStatus: 'Casual', officeId })).data.id;
    const rec = (await createSignatory(p, { name: 'R', title: 'T', role: 'recommending' })).data.id;
    const appr = (await createSignatory(p, { name: 'A', title: 'T', role: 'approving' })).data.id;
    const [[{ id: userId }]] = await p.query('SELECT id FROM users');
    await createRecord(p, {
      formType: 'TO', issuingOffice: 'SB', dateFiled: '2026-11-20', employeeIds: [emp], destination: 'Capitol', vehicle: '',
      inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-21', departureAt: '2026-11-20T08:00', returnAt: '', purpose: 'Meeting',
      recommendingId: rec, approvingId: appr,
    }, { userId, now: new Date(2026, 10, 20) });
    // Put the database back into its Phase 1 (v1) shape.
    await p.query(`ALTER TABLE records DROP COLUMN status, MODIFY date_filed DATE NOT NULL, MODIFY inclusive_from DATE NOT NULL,
      MODIFY inclusive_to DATE NOT NULL, MODIFY departure_at DATETIME NOT NULL`);
    await p.query('UPDATE schema_version SET version = 1');
    await migrate(testConfig());
    const [[r]] = await p.query('SELECT number, status, date_filed, inclusive_to, departure_at, purpose FROM records');
    expect(r).toEqual({ number: 'SB 2026-11-1', status: 'filled', date_filed: '2026-11-20', inclusive_to: '2026-11-21', departure_at: '2026-11-20 08:00:00', purpose: 'Meeting' });
    const [[{ version }]] = await p.query('SELECT version FROM schema_version');
    expect(version).toBe(2);
  } finally {
    await p.end();
  }
});

test('refuses non-test db', async () => {
  process.env.TEST_DB_NAME = 'zz_plsto_guard_probe'; // never a real database: the mutation check runs this without the guard
  try {
    await expect(freshTestDb()).rejects.toThrow('Refusing to run tests against zz_plsto_guard_probe');
  } finally {
    delete process.env.TEST_DB_NAME;
  }
});

test('rejects unsafe db name', async () => {
  await expect(migrate({ ...testConfig(), database: 'x; DROP' })).rejects.toThrow();
});

test('tables are utf8mb4 even inside a pre-existing latin1 database', async () => {
  const config = testConfig();
  const { database, ...server } = config;
  const mysql = (await import('mysql2/promise')).default;
  const conn = await mysql.createConnection(server);
  await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET latin1`);
  await conn.end();
  await migrate(config);
  const p = (await import('../../src/main/db.js')).createPool(config);
  const [rows] = await p.query('SELECT TABLE_NAME AS t, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [database]);
  await p.end();
  expect(rows.map((r) => r.c)).toEqual(Array(8).fill('utf8mb4_unicode_ci'));
});

test('a migration interrupted after its ALTER (version not yet updated) completes on the next start', async () => {
  const p = await freshTestDb(); // v2 schema, status column present
  try {
    await p.query('UPDATE schema_version SET version = 1'); // crash happened before the version update
    await expect(migrate(testConfig())).resolves.toBeUndefined();
    const [[{ version }]] = await p.query('SELECT version FROM schema_version');
    expect(version).toBe(2);
  } finally {
    await p.end();
  }
});
