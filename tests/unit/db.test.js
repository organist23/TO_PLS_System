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
