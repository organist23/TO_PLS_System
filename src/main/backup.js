import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { assertDbName, migrate, SCHEMA_VERSION } from './db.js';

// Every table, parents before children.
export const TABLES = ['schema_version', 'users', 'offices', 'employees', 'signatories', 'signatory_defaults', 'records', 'record_employees'];
const HEADER = '-- PLS-TO Records System backup v1 schema ';
const END = '-- end of backup\n';
const ROWS_PER_INSERT = 500;
const INVALID = { ok: false, error: 'This file is not a backup of the PLS-TO Records System. Nothing was changed.' };

const pad = (n) => String(n).padStart(2, '0');
export const backupName = (d) =>
  `pls-to-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.sql`;

// A path in dir that does not exist yet: name.sql, else name-2.sql, name-3.sql… (never overwrite an earlier backup).
export async function freePath(dir, name) {
  for (let i = 1; ; i++) {
    const p = path.join(dir, i === 1 ? name : name.replace(/\.sql$/, `-${i}.sql`));
    if (!(await fs.access(p).then(() => true, () => false))) return p;
  }
}

// US-13. Statements end with ";\n". Values go through mysql2's escape, which turns newlines into \n, so a raw
// newline never appears inside a value and ";\n" only ever ends a statement. All tables are read on one connection
// in one consistent snapshot. Written to .part, renamed when complete.
export async function writeBackup(pool, filePath) {
  const part = `${filePath}.part`;
  const fh = await fs.open(part, 'w');
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const [[{ version }]] = await conn.query('SELECT version FROM schema_version');
    await fh.write(`${HEADER}${version}\nSET FOREIGN_KEY_CHECKS = 0;\n`);
    for (const t of TABLES) {
      const [[create]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
      await fh.write(`DROP TABLE IF EXISTS \`${t}\`;\n${create['Create Table']};\n`);
      const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
      for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
        const chunk = rows.slice(i, i + ROWS_PER_INSERT);
        const cols = Object.keys(chunk[0]);
        const values = chunk.map((r) => `(${cols.map((c) => conn.escape(r[c])).join(', ')})`).join(',\n');
        await fh.write(`INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES\n${values};\n`);
      }
    }
    await conn.query('COMMIT');
    await fh.write(`SET FOREIGN_KEY_CHECKS = 1;\n${END}`);
    await fh.close();
    await fs.rename(part, filePath);
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {});
    await fh.close().catch(() => {});
    await fs.rm(part, { force: true });
    throw e;
  } finally {
    conn.release();
  }
}

// Only the statement shapes writeBackup writes, on this app's own tables. A file with anything else (USE, another
// database, GRANT, CREATE ... SELECT, DATA DIRECTORY…) is refused before a single statement runs.
const own = (t) => TABLES.includes(t);
// The SQL around the quoted values: escaped text like 'Select candidates' must not count as a keyword.
const unquoted = (stmt) => stmt.replace(/'(?:[^'\\]|\\.)*'/g, "''");
function allowed(stmt) {
  if (/^SET FOREIGN_KEY_CHECKS = [01]$/.test(stmt)) return true;
  let m = stmt.match(/^DROP TABLE IF EXISTS `(\w+)`$/);
  if (m) return own(m[1]);
  m = stmt.match(/^CREATE TABLE `(\w+)` \(/);
  if (m) return own(m[1]) && !/\b(SELECT|DIRECTORY)\b/i.test(unquoted(stmt));
  m = stmt.match(/^INSERT INTO `(\w+)` \([^)]*\) VALUES\n\(/);
  if (m) return own(m[1]) && !/\bSELECT\b/i.test(unquoted(stmt));
  return false;
}

// Rows that point at a missing parent (loaded with FOREIGN_KEY_CHECKS = 0, so MySQL did not check them).
const ORPHANS = [
  ['employees', 'office_id', 'offices'], ['signatory_defaults', 'signatory_id', 'signatories'],
  ['records', 'created_by', 'users'], ['records', 'recommending_id', 'signatories'], ['records', 'approving_id', 'signatories'],
  ['record_employees', 'record_id', 'records'], ['record_employees', 'employee_id', 'employees'], ['record_employees', 'office_id', 'offices'],
];

// US-14. Checks every statement, loads the file into <db>_restore, checks the result, migrates it, then swaps every
// table in one RENAME TABLE. Live data is untouched until the swap, so a bad file changes nothing.
export async function restoreBackup(config, filePath) {
  assertDbName(config.database);
  // A copy that went through Windows line endings or an editor's BOM is still the same backup.
  const text = (await fs.readFile(filePath, 'utf8').catch(() => '')).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const head = text.match(/^-- PLS-TO Records System backup v1 schema (\d+)\n/);
  if (!head || !text.endsWith(END)) return INVALID;
  if (Number(head[1]) > SCHEMA_VERSION) return { ok: false, error: 'This backup was made by a newer version of the app. Nothing was changed.' };
  const statements = text.slice(head[0].length, -END.length).split(';\n').map((x) => x.trim()).filter(Boolean);
  if (!statements.every(allowed)) return INVALID;

  const { database, ...server } = config;
  const scratch = `${database}_restore`;
  const old = `${database}_old`;
  const conn = await mysql.createConnection({ ...server, charset: 'utf8mb4' });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
    await conn.query(`CREATE DATABASE \`${scratch}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${scratch}\``);
    try {
      for (const stmt of statements) await conn.query(stmt);
      const [tables] = await conn.query('SHOW TABLES');
      const names = tables.map((r) => Object.values(r)[0]);
      const [[row]] = await conn.query('SELECT version FROM schema_version');
      if (!TABLES.every((t) => names.includes(t)) || row?.version !== Number(head[1])) throw new Error('incomplete backup');
      for (const [child, col, parent] of ORPHANS) {
        const [[{ n }]] = await conn.query(
          `SELECT COUNT(*) AS n FROM \`${child}\` c LEFT JOIN \`${parent}\` p ON p.id = c.\`${col}\` WHERE c.\`${col}\` IS NOT NULL AND p.id IS NULL`,
        );
        if (n > 0) throw new Error(`${child}.${col} points at a missing ${parent}`);
      }
      await migrate({ ...config, database: scratch });
    } catch {
      await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
      return INVALID;
    }
    await conn.query(`DROP DATABASE IF EXISTS \`${old}\``);
    await conn.query(`CREATE DATABASE \`${old}\``);
    await conn.query(`RENAME TABLE ${TABLES.map((t) => `\`${database}\`.\`${t}\` TO \`${old}\`.\`${t}\`, \`${scratch}\`.\`${t}\` TO \`${database}\`.\`${t}\``).join(', ')}`);
    // The data is restored once RENAME succeeds; leftover scratch databases must not turn that into an error.
    for (const db of [old, scratch]) {
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``).catch((e) => console.error('[backup] cleanup', db, e));
    }
    return { ok: true };
  } finally {
    await conn.end().catch(() => {});
  }
}
