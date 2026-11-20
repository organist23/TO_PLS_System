import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../../src/main/config.js';
import { createPool, migrate, assertDbName } from '../../src/main/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function testConfig() {
  const database = process.env.TEST_DB_NAME ?? 'pls_to_test';
  if (!database.endsWith('_test')) throw new Error(`Refusing to run tests against ${database}`);
  return { ...loadConfig(path.join(root, '.env')), database };
}

// Drops and recreates the test database, then returns a pool on it.
export async function freshTestDb() {
  const config = testConfig();
  assertDbName(config.database);
  const { database, ...server } = config;
  const conn = await mysql.createConnection(server);
  await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await conn.end();
  await migrate(config);
  return createPool(config);
}
