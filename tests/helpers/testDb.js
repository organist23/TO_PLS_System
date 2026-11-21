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

let rebuilt = false; // per test file (each file gets its own module instance)

// Returns a pool on an empty, fully migrated test database. The first call per file drops and recreates it;
// later calls only delete rows, because repeated DROP/CREATE on WAMP MySQL took 1-5 s and timed tests out.
export async function freshTestDb() {
  const config = testConfig();
  assertDbName(config.database);
  const { database, ...server } = config;
  if (!rebuilt) {
    const conn = await mysql.createConnection(server);
    await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await conn.end();
    rebuilt = true;
  }
  await migrate(config); // also repairs a schema a db.test case altered
  const conn = await mysql.createConnection(config);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await conn.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> 'schema_version'", [database]);
    for (const { t } of tables) await conn.query(`DELETE FROM \`${t}\``);
  } finally {
    await conn.end();
  }
  return createPool(config);
}
