# Phase 5 — Backup and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff save a .sql backup of all data to a chosen folder (US-13) and restore one, with an automatic backup first and a forced re-login after (US-14).

**Architecture:** A new `src/main/backup.js` writes the backup itself through mysql2 (no `mysqldump` binary): a header line, then `CREATE TABLE` and `INSERT` statements per table, written to a temp file and renamed into place only when complete. Restore checks the header, loads the file into a scratch database `<db>_restore`, checks it, migrates it to the current schema version, then swaps every table in one `RENAME TABLE`. A new Backup page holds both actions.

**Tech Stack:** unchanged (mysql2, Node fs, Electron dialogs).

**Spec:** `spec.md` US-13, US-14, CW-3, and US-5 "Two numbers are never the same for one counter, even after a restore (US-14)". Conventions: `roadmap.md` Phases 0–9.

## Global Constraints

- Backup file name: `pls-to-backup-YYYY-MM-DD-HHMM.sql` (local time), in the folder the user picks (`showOpenDialog` with `openDirectory`).
- First line, exact: `-- PLS-TO Records System backup v1 schema <n>`; a file without it is not a backup of this app.
- Tables, in this order: `schema_version, users, offices, employees, signatories, signatory_defaults, records, record_employees`. Values through `mysql2` `escape`, never string-built.
- A backup is written to `<name>.part` and renamed to `<name>.sql` only after the last byte; a failure deletes the `.part`.
- Pre-restore backup folder: `<userData>/backups` (Electron `app.getPath('userData')`), passed in through the injected `os` object; its path is shown.
- Restore never touches the live tables until the scratch database loaded and checked; the swap is one `RENAME TABLE` statement. A backup with a higher schema version than the app is refused.
- After a restore every session ends (`sessions.clear()`), and the renderer shows Login.
- Both roles may back up and restore (spec: only user management is admin-only). Routes are `ready`.
- Copy, exact: page `Backup`; buttons `Back up now`, `Restore from a backup`; success `Backup saved to <path>`; restore confirm title `Restore <file name>?`, message `All current data will be replaced by this backup. A backup of the current data is saved first.`, confirm `Restore`; invalid file `This file is not a backup of the PLS-TO Records System. Nothing was changed.`; after restore the Login page shows `Data restored from <file name>. A backup of the previous data was saved to <path>. Please log in again.`

## Review Focus

1. A backup written while the folder disappears (USB pulled) leaves no `.sql` file, only nothing or a `.part`. Test in Task 1 (write error midway → no `.sql`).
2. Text with quotes, backslashes, newlines and `Ñ` in records survives backup → restore byte for byte. Test in Task 1.
3. A truncated backup (cut in the middle) is rejected and live data is unchanged. Test in Task 2.
4. After restoring an older backup, numbering continues after its highest seq per counter (US-5). Test in Task 2.
5. A restore while another window is logged in ends that session too. Test in Task 3 (two senders).

---

### Task 0: Branch
- [ ] `git checkout -b phase-5-backup-restore`. Commit this plan as `docs: Phase 5 plan`.

### Task 1: Backup writer

**Files:** Create `src/main/backup.js`, `tests/unit/backup.test.js`.

**Interfaces:**
- `backupName(now: Date) → string` (`pls-to-backup-2026-11-20-1430.sql`).
- `writeBackup(pool, filePath) → Promise<void>`: header, then per table `DROP TABLE IF EXISTS`, `SHOW CREATE TABLE` output, and multi-row `INSERT` (500 rows per statement), statements separated by `;\n`; writes `filePath + '.part'` and renames.
- [ ] Tests first: name for 2026-11-20 14:30 and 2026-01-05 09:07; file starts with the exact header and current schema number; every table present; a record with `It's a "test" \ path\nline 2 Ñ` in purpose round-trips (Task 2 reads it back; here assert the escaped text appears once); a write into a folder that is removed after the header (or an fs stub at the OS boundary) leaves no `.sql` and no `.part`.
- [ ] Mutation: write straight to `filePath` (no `.part`) → partial-file test red. Commit `feat: write .sql backups`.

### Task 2: Restore

**Files:** Modify `src/main/backup.js`, `tests/unit/backup.test.js`.

**Interfaces:**
- `restoreBackup(config, filePath) → Promise<{ ok } | { ok: false, error }>`: read the file; refuse without the header or with a schema number above the app's; create `<db>_restore` (dropped first), run the statements there, check all 8 tables exist and `schema_version` matches the header, run `migrate` on it, then `RENAME TABLE db.t TO <db>_old.t, <db>_restore.t TO db.t, …` for every table in one statement, then drop `<db>_old` and `<db>_restore`. Any failure before the rename drops the scratch database and leaves live data as it was.
- [ ] Tests first (against `pls_to_test`, scratch `pls_to_test_restore`): backup → change data → restore → data equals the backup (records, employees, record_employees, users, text with quotes/newlines/Ñ); not-a-backup file, empty file, truncated file (cut at half) → exact error and live data unchanged; a backup with schema 99 → refused; numbering after restoring a backup whose last number was `2026-11-7` gives `2026-11-8`; a v2-era backup (schema 2) restores and migrates to v3.
- [ ] Mutation: rename tables before checking the scratch database → truncated-file test red. Commit `feat: restore from a .sql backup safely`.

### Task 3: IPC

**Files:** Modify `src/main/ipc.js`, `src/main/preload.cjs`, `src/main/main.js` (os: `chooseFolder`, `chooseBackupFile`, `backupDir`), `tests/unit/ipc.test.js`.
- Routes (`ready`):
  - `backup:create` → folder from `os.chooseFolder()` (cancel → `{ ok: true, data: { canceled: true } }`), `writeBackup` to `<folder>/<backupName(now)>`, returns `{ path }` or `Could not save the backup: <reason>`.
  - `backup:pick` → file from `os.chooseBackupFile()` (`.sql` filter); remembered per window in a `picked` map (like `exported`); returns `{ file: <base name> }` or `{ canceled: true }`.
  - `backup:restore` → restores only the file this window picked (a renderer-supplied path is never used); writes the pre-restore backup to `os.backupDir` first; returns `{ file, path }`; clears every session on success.
- [ ] Tests first: routes refused before the password change; create writes to the faked folder and returns the path; canceled folder writes nothing; restore with an invalid file returns the exact error and keeps the session; a valid restore writes the pre-restore backup, returns both paths, and both sender 1 and sender 2 are logged out; allowlist sync. Commit `feat: IPC for backup and restore`.

### Task 4: Backup page

**Files:** Create `src/renderer/pages/Backup.jsx`. Modify `src/renderer/App.jsx` (menu `Backup` after Reports; on a restore result, log out to Login with the restore message).
- `Back up now`: loading `Saving backup…`, success banner with path, error banner. `Restore from a backup`: pick file → ConfirmDialog with the exact copy (Cancel changes nothing) → `Restoring…` → Login with the message. Invalid file: error banner, still logged in.
- [ ] Build, throwaway screenshots (page, confirm, login message), look, delete. Commit `feat: Backup page`.

### Task 5: E2E

**Files:** Create `tests/e2e/features/us-13-backup.spec.js`, `us-14-restore.spec.js`, `tests/e2e/system/cw-3-recover-data.spec.js`. Dialogs stubbed at the OS boundary (`dialog.showOpenDialog`).
- US-13: file name with date and time in the chosen folder, success path shown; failure (folder made read-only or removed) shows the error and leaves no `.sql`.
- US-14: confirm names the file and the replacement; Cancel changes nothing (SQL); pre-restore backup path shown and the file exists; after restore the app is on Login with the message; invalid file rejected, data unchanged, still logged in.
- CW-3: back up → add a record → restore → log in → Records shows the backed-up records only.
- [ ] Mutations: skip the pre-restore backup → US-14 red; keep sessions after restore → US-14 red. Commit `test: E2E for US-13, US-14, CW-3`.

### Task 6: Package, verify, record
- [ ] Package, full E2E on the packaged exe, `npm test`, `pls_to` untouched, `docs/test-results/PHASE-5-TEST-RESULTS.md`, commit.

---

## Test scope

```
Feature: Phase 5, US-13, US-14
Feature tests: unit and integration for backupName, writeBackup, restoreBackup, backup:* routes. E2E for US-13, US-14
Regression E2E: US-1 (logout after restore), US-5 (numbering after restore), US-10 (records after restore) via full run
System E2E: CW-3 (first run)
Full E2E run: yes, a restore replaces every table and runs migrations (schema trust boundary)
```
