import fs from 'node:fs/promises';
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

// US-13. Statements end with ";\n". Values go through mysql2's escape, which turns newlines into \n, so a raw
// newline never appears inside a value and ";\n" only ever ends a statement. Written to .part, renamed when complete.
export async function writeBackup(pool, filePath) {
  const part = `${filePath}.part`;
  const fh = await fs.open(part, 'w');
  try {
    const [[{ version }]] = await pool.query('SELECT version FROM schema_version');
    await fh.write(`${HEADER}${version}\nSET FOREIGN_KEY_CHECKS = 0;\n`);
    for (const t of TABLES) {
      const [[create]] = await pool.query(`SHOW CREATE TABLE \`${t}\``);
      await fh.write(`DROP TABLE IF EXISTS \`${t}\`;\n${create['Create Table']};\n`);
      const [rows] = await pool.query(`SELECT * FROM \`${t}\``);
      for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
        const chunk = rows.slice(i, i + ROWS_PER_INSERT);
        const cols = Object.keys(chunk[0]);
        const values = chunk.map((r) => `(${cols.map((c) => pool.escape(r[c])).join(', ')})`).join(',\n');
        await fh.write(`INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES\n${values};\n`);
      }
    }
    await fh.write(`SET FOREIGN_KEY_CHECKS = 1;\n${END}`);
    await fh.close();
    await fs.rename(part, filePath);
  } catch (e) {
    await fh.close().catch(() => {});
    await fs.rm(part, { force: true });
    throw e;
  }
}

// US-14. Loads the file into <db>_restore, checks it, migrates it, then swaps every table in one RENAME TABLE.
// Live data is untouched until the swap, so a bad file changes nothing.
export async function restoreBackup(config, filePath) {
  assertDbName(config.database);
  const text = await fs.readFile(filePath, 'utf8').catch(() => '');
  const head = text.match(/^-- PLS-TO Records System backup v1 schema (\d+)\n/);
  if (!head || !text.endsWith(END)) return INVALID;
  if (Number(head[1]) > SCHEMA_VERSION) return { ok: false, error: 'This backup was made by a newer version of the app. Nothing was changed.' };

  const { database, ...server } = config;
  const scratch = `${database}_restore`;
  const old = `${database}_old`;
  const conn = await mysql.createConnection({ ...server, charset: 'utf8mb4' });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
    await conn.query(`CREATE DATABASE \`${scratch}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${scratch}\``);
    try {
      for (const stmt of text.slice(head[0].length, -END.length).split(';\n')) {
        if (stmt.trim()) await conn.query(stmt);
      }
      const [tables] = await conn.query('SHOW TABLES');
      const names = tables.map((r) => Object.values(r)[0]);
      const [[row]] = await conn.query('SELECT version FROM schema_version');
      if (!TABLES.every((t) => names.includes(t)) || row?.version !== Number(head[1])) throw new Error('incomplete backup');
    } catch {
      await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
      return INVALID;
    }
    await migrate({ ...config, database: scratch });
    await conn.query(`DROP DATABASE IF EXISTS \`${old}\``);
    await conn.query(`CREATE DATABASE \`${old}\``);
    await conn.query(`RENAME TABLE ${TABLES.map((t) => `\`${database}\`.\`${t}\` TO \`${old}\`.\`${t}\`, \`${scratch}\`.\`${t}\` TO \`${database}\`.\`${t}\``).join(', ')}`);
    await conn.query(`DROP DATABASE \`${old}\``);
    await conn.query(`DROP DATABASE \`${scratch}\``);
    return { ok: true };
  } finally {
    await conn.end();
  }
}
