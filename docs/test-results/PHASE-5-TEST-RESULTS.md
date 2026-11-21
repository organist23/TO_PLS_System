# Phase 5 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe`. OS folder/file pickers (`dialog.showOpenDialog`) stubbed at the OS boundary; pre-restore backups go to a temp folder through `PLS_TO_BACKUP_DIR`.
Database: `pls_to_test` on local WAMP MySQL 5.7.26; restore uses `pls_to_test_restore` and `pls_to_test_old` as scratch, both dropped after each restore (none left behind). `pls_to` was not touched by any test: its only rows (offices ENGINEERING, HRMO, MACCO, MASSO, TEASURY; one employee; 30 records written 20:15–20:29 local) come from the user's own hand testing of the app after the test runs, and none match a test fixture name.

## Test scope as run

```
Feature: Phase 5, US-13, US-14
Feature tests: unit (186, Vitest) incl. backupName, freePath, writeBackup (header, end marker, escaping, consistent snapshot, no partial file), restoreBackup (round trip, numbering after restore, invalid/empty/truncated/no-end files, newer schema, older schema migrated, statement allowlist, orphans, CRLF and BOM, SQL-looking record text), backup:* routes. E2E for US-13, US-14
Regression E2E: US-1 (logout after restore), US-5 (numbering after restore, unit), US-10 (records after restore, CW-3) via full run
System E2E: CW-3 (first run)
Full E2E run: yes, a restore replaces every table and runs migrations — 124/124
```

## US-13 Back up the database — `tests/e2e/features/us-13-backup.spec.js` — PASS 3/3

| Condition | Result |
|---|---|
| Writes `pls-to-backup-YYYY-MM-DD-HHMM.sql` (hand-derived from the click time) to the chosen folder; success shows the path; file has header, data and end marker | PASS |
| A failed backup (folder gone) shows `Could not save the backup: …` and leaves no file | PASS |
| Cancelling the folder choice writes nothing and shows nothing | PASS |

Unit only: a backup failing midway leaves no `.sql` and no `.part`; a second backup in the same minute is saved as `-2` instead of overwriting.

## US-14 Restore from a backup — `tests/e2e/features/us-14-restore.spec.js` — PASS 3/3

| Condition | Result |
|---|---|
| Confirmation names the file and that all data is replaced; Cancel changes nothing (SQL, no pre-restore file) | PASS |
| Restore saves the current data first (path shown, file holds the replaced data), replaces the data, ends the session server-side, shows Login with the message; login works with the restored account | PASS |
| A file that is not a backup is rejected with the exact message; data unchanged; still logged in | PASS |

Unit only: empty, truncated, no-end-marker and newer-schema files refused with data unchanged; a file carrying `USE`, another database's table, `UPDATE`/`DELETE`/`DROP` on another database, `CREATE … SELECT`, a subquery in `INSERT`, or `GRANT` is refused before any statement runs; a backup with rows pointing at missing parents is refused; Windows line endings and a BOM restore; record text such as `Select candidates; Grant review, USE the 'DROP' box` restores; numbering continues after the highest restored number; a schema-2 backup is migrated to the current version.

## CW-3 Recover data — `tests/e2e/system/cw-3-recover-data.spec.js` — PASS 1/1

Back up (US-13) → a record added after the backup → restore (US-14) → log in again (US-1) → Records shows only the backed-up record (US-10).

## Regression

Every other spec passes in the full run (US-1 to US-12, US-15 to US-18, CW-1, CW-2, CW-4). No DONE phase skipped.

## Review

- `/code-review`: fixed restore running the file's statements before checking them (now an allowlist of the shapes the app writes, on its own 8 tables, checked before anything runs); same-minute overwrite of backups and the pre-restore backup (`-2`, `-3`…); backup read in one consistent snapshot; a cleanup failure after the swap no longer reported as an error (and no longer skips the logout); a failed migration drops the scratch database; orphan rows refused; CRLF/BOM accepted. Not done: removing the per-run temp folders tests leave in `%TEMP%`.
- `/security-review`: no findings with confidence 8 or above. Its main note (a crafted file running statements as MySQL root before validation) was fixed by the allowlist above.
- `/ponytail-review`: not run separately; `/code-review` covered simplification.

## Mutation checks (each went red, then restored)

- Backup without cleanup on failure → midway-failure test red. (Writing without `.part` stays green in-process because cleanup removes the file; a killed process leaves a file without the end marker, which restore refuses — end-marker mutation red.)
- No end-marker check → invalid-files test red.
- Restore loading without the allowlist → injection test red. Without the orphan check → orphan test red. Treating quoted text as SQL → "SQL-looking text" test red.
- No pre-restore backup → IPC and US-14 E2E red. Sessions kept after restore → IPC and US-14 E2E red. Cancel running the restore → US-14 E2E red.

## Visual check

Screenshots of the Backup page with a saved path, the restore confirmation and the Login notice at 1280×800, looked at, then deleted.

## Left behind

`plsto-*` temp folders from test runs in `%TEMP%` (test data only). The installer was rebuilt (`dist/app/PLS-TO Records System Setup 1.0.0.exe`).
