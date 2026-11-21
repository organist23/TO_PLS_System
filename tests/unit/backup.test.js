import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshTestDb, testConfig } from '../helpers/testDb.js';
import { ensureAdmin } from '../../src/main/auth.js';
import { createOffice, createEmployee } from '../../src/main/directory.js';
import { createSignatory } from '../../src/main/signatories.js';
import { issueBlank, fillBlank } from '../../src/main/records.js';
import { SCHEMA_VERSION } from '../../src/main/db.js';
import { backupName, writeBackup, restoreBackup } from '../../src/main/backup.js';

let pool, dir, ids;
const NOV = new Date(2026, 10, 20, 9, 0);
// Every kind of text that must survive a round trip: quotes, backslash, newline, Ñ.
const TRICKY = 'It\'s a "test" \\ path\nline 2 PEÑA; DROP TABLE x;';

beforeEach(async () => {
  pool = await freshTestDb();
  await ensureAdmin(pool);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-backup-'));
  const officeId = (await createOffice(pool, { name: 'MHO' })).data.id;
  const emp = (await createEmployee(pool, { fullName: 'MARIA PEÑA', designation: 'Nurse', employmentStatus: 'Casual', officeId })).data.id;
  const rec = (await createSignatory(pool, { name: 'HEAD', title: 'DEPARTMENT HEAD', role: 'recommending' })).data.id;
  const appr = (await createSignatory(pool, { name: 'MAYOR', title: 'MUNICIPAL MAYOR', role: 'approving' })).data.id;
  const [[{ id: userId }]] = await pool.query('SELECT id FROM users');
  ids = { officeId, emp, rec, appr, userId };
});
afterEach(async () => {
  await pool.end();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Paper first: a filled record is an issued blank, encoded.
async function record(purpose = 'Meeting', now = NOV) {
  const { id, number } = (await issueBlank(pool, { formType: 'PLS', issuingOffice: 'MAYOR', approvingId: ids.appr }, { userId: ids.userId, now })).data;
  await fillBlank(pool, {
    id, recommendingId: ids.rec, dateFiled: '2026-11-20', employeeIds: [ids.emp], destination: 'Capitol', vehicle: '',
    inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-20', departureAt: '2026-11-20T08:00', returnAt: '', purpose, confirmOverlap: true,
  }, { userId: ids.userId });
  // Typed text is normalized on save (inner whitespace collapsed); put the raw text in directly so the backup must carry it.
  await pool.query('UPDATE records SET purpose = ? WHERE id = ?', [purpose, id]);
  return { id, number };
}

test('backupName uses local date and time', () => {
  expect(backupName(new Date(2026, 10, 20, 14, 30))).toBe('pls-to-backup-2026-11-20-1430.sql');
  expect(backupName(new Date(2026, 0, 5, 9, 7))).toBe('pls-to-backup-2026-01-05-0907.sql');
});

test('writeBackup writes the header, every table, and an end marker', async () => {
  await record(TRICKY);
  const file = path.join(dir, 'b.sql');
  await writeBackup(pool, file);
  const text = fs.readFileSync(file, 'utf8');
  expect(text.split('\n')[0]).toBe(`-- PLS-TO Records System backup v1 schema ${SCHEMA_VERSION}`);
  expect(text.endsWith('-- end of backup\n')).toBe(true);
  for (const t of ['schema_version', 'users', 'offices', 'employees', 'signatories', 'signatory_defaults', 'records', 'record_employees']) {
    expect(text).toContain(`CREATE TABLE \`${t}\``);
  }
  // values are escaped, so a raw newline never appears inside a value
  expect(text).toContain("'It\\'s a \\\"test\\\" \\\\ path\\nline 2 PEÑA; DROP TABLE x;'");
  expect(fs.readdirSync(dir)).toEqual(['b.sql']);
});

test('a backup that fails midway leaves no .sql and no .part', async () => {
  await record();
  const file = path.join(dir, 'b.sql');
  const realQuery = pool.query.bind(pool);
  pool.query = (sql, ...rest) => (String(sql).startsWith('SELECT * FROM `records`') ? Promise.reject(new Error('disk lost')) : realQuery(sql, ...rest));
  await expect(writeBackup(pool, file)).rejects.toThrow('disk lost');
  pool.query = realQuery;
  expect(fs.readdirSync(dir)).toEqual([]);
});

// ---------- restore ----------

const INVALID = { ok: false, error: 'This file is not a backup of the PLS-TO Records System. Nothing was changed.' };
const snapshot = async () => {
  const [recs] = await pool.query('SELECT number, status, purpose FROM records ORDER BY id');
  const [emps] = await pool.query('SELECT record_id, full_name FROM record_employees ORDER BY record_id, position');
  const [users] = await pool.query('SELECT username, password_hash FROM users ORDER BY id');
  return { recs, emps, users };
};

test('restore brings back exactly the backed-up data, tricky text included', async () => {
  await record(TRICKY);
  const file = path.join(dir, 'b.sql');
  await writeBackup(pool, file);
  const before = await snapshot();
  await record('Added after the backup');
  await pool.query("UPDATE employees SET full_name = 'CHANGED'");
  expect(await restoreBackup(testConfig(), file)).toEqual({ ok: true });
  expect(await snapshot()).toEqual(before);
  expect(before.recs[0].purpose).toBe(TRICKY);
  const [[{ name }]] = await pool.query('SELECT full_name AS name FROM employees');
  expect(name).toBe('MARIA PEÑA');
});

test('numbering continues after the highest number in the restored backup', async () => {
  for (let i = 0; i < 7; i++) await record(`R${i}`); // 2026-11-1 .. 2026-11-7
  const file = path.join(dir, 'b.sql');
  await writeBackup(pool, file);
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  await pool.query('DELETE FROM record_employees');
  await pool.query('DELETE FROM records');
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  await restoreBackup(testConfig(), file);
  expect((await record('next', NOV)).number).toBe('2026-11-8');
});

test('a file that is not a backup, empty, truncated or missing its end is rejected and nothing changes', async () => {
  await record();
  const good = path.join(dir, 'good.sql');
  await writeBackup(pool, good);
  const text = fs.readFileSync(good, 'utf8');
  await record('live only');
  const before = await snapshot();
  const cases = {
    'other.sql': 'SELECT 1;\n',
    'empty.sql': '',
    'half.sql': text.slice(0, Math.floor(text.length / 2)),
    'noend.sql': text.replace('-- end of backup\n', ''),
  };
  for (const [name, body] of Object.entries(cases)) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, body);
    expect(await restoreBackup(testConfig(), f), name).toEqual(INVALID);
    expect(await snapshot(), name).toEqual(before);
  }
  expect(await restoreBackup(testConfig(), path.join(dir, 'missing.sql'))).toEqual(INVALID);
});

test('a backup from a newer app version is refused', async () => {
  const file = path.join(dir, 'b.sql');
  await writeBackup(pool, file);
  const text = fs.readFileSync(file, 'utf8').replace(/schema \d+/, 'schema 99');
  fs.writeFileSync(file, text);
  expect(await restoreBackup(testConfig(), file)).toEqual({ ok: false, error: 'This backup was made by a newer version of the app. Nothing was changed.' });
});

test('an older backup (schema 2) restores and is migrated to the current version', async () => {
  await record();
  const file = path.join(dir, 'b.sql');
  await writeBackup(pool, file);
  // Make the file look like a v2 database: recommending columns NOT NULL, schema_version 2.
  const text = fs.readFileSync(file, 'utf8')
    .replace(/schema \d+\n/, 'schema 2\n')
    .replace(/`recommending_id` int\(11\) DEFAULT NULL/, '`recommending_id` int(11) NOT NULL')
    .replace(/(INSERT INTO `schema_version` \(`version`\) VALUES\n)\(\d+\)/, '$1(2)');
  fs.writeFileSync(file, text);
  expect(await restoreBackup(testConfig(), file)).toEqual({ ok: true });
  const [[{ version }]] = await pool.query('SELECT version FROM schema_version');
  expect(version).toBe(SCHEMA_VERSION);
  const [[col]] = await pool.query("SHOW COLUMNS FROM records LIKE 'recommending_id'");
  expect(col.Null).toBe('YES');
});
