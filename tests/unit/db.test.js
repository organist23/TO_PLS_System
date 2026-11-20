import { test, expect, afterAll } from 'vitest';
import { freshTestDb, testConfig } from '../helpers/testDb.js';
import { migrate } from '../../src/main/db.js';

let pool;
afterAll(() => pool?.end());

test('freshTestDb creates the 3 tables', async () => {
  pool = await freshTestDb();
  const [rows] = await pool.query('SHOW TABLES');
  expect(rows.map((r) => Object.values(r)[0]).sort()).toEqual(['employees', 'offices', 'users']);
});

test('migrate is idempotent', async () => {
  await expect(migrate(testConfig())).resolves.toBeUndefined();
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
  expect(rows.map((r) => r.c)).toEqual(['utf8mb4_unicode_ci', 'utf8mb4_unicode_ci', 'utf8mb4_unicode_ci']);
});
