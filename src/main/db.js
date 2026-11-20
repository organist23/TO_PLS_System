import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

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
  } finally {
    await conn.end();
  }
}
