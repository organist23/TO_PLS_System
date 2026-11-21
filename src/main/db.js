import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

// MIGRATIONS[i] upgrades the database to version i + 2. Append only; never edit a shipped entry.
const MIGRATIONS = [
  [
    // v2: blank forms (US-7) have no dates until they are filled in.
    `ALTER TABLE records ADD COLUMN status ENUM('filled','blank') NOT NULL DEFAULT 'filled' AFTER number,
       MODIFY date_filed DATE NULL, MODIFY inclusive_from DATE NULL, MODIFY inclusive_to DATE NULL,
       MODIFY departure_at DATETIME NULL`,
  ],
];

export function createPool(config) {
  return mysql.createPool({ ...config, charset: 'utf8mb4', dateStrings: true });
}

// The database name is interpolated into SQL, so it must be a plain identifier.
export function assertDbName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Invalid database name: ${name}`);
}

export async function migrate(config) {
  assertDbName(config.database);
  const { database, ...server } = config;
  const conn = await mysql.createConnection({ ...server, charset: 'utf8mb4' });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await conn.query(`USE \`${database}\``);
    const statements = fs.readFileSync(schemaPath, 'utf8').split(/;\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const sql of statements) await conn.query(sql);
    await conn.query(
      'CREATE TABLE IF NOT EXISTS schema_version (version INT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );
    let [[row]] = await conn.query('SELECT version FROM schema_version');
    if (!row) {
      await conn.query('INSERT INTO schema_version (version) VALUES (1)'); // schema.sql is v1
      row = { version: 1 };
    }
    for (let v = row.version + 1; v <= MIGRATIONS.length + 1; v++) {
      for (const sql of MIGRATIONS[v - 2]) await conn.query(sql);
      await conn.query('UPDATE schema_version SET version = ?', [v]);
    }
  } finally {
    await conn.end();
  }
}
