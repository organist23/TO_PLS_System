# Roadmap

## Part one — Encode and print PLS and TO forms

### Phase 0 — Login and employee master list ✅ DONE (merged `b1200a5`, 2026-11-20)

Proves the stack end to end (Electron, React + Tailwind, Node, local MySQL) with the smallest real outcome. Every later story needs a logged-in user and employees to pick.
Covers US-1, US-3.

- Staff log in and log out. First run creates the admin and forces a password change.
- Staff add, edit, archive, and search offices and employees.

**Done when:** in the packaged Electron app, the seeded admin changes the password, logs in, adds an office and an employee, archives the employee, and logs out. Pages refuse access after logout. Every US-1 and US-3 condition passes in E2E. — **Verified** on 2026-11-20 with Playwright `_electron` against the packaged `win-unpacked` exe, all US-1 and US-3 conditions plus DB-error page and navigation lock (29/29 E2E, 43/43 unit). Results: `docs/test-results/PHASE-0-TEST-RESULTS.md`. Regression: none, first phase.

Shipped as `src/main/auth.js`: `hashPassword`, `verifyPassword`, `ensureAdmin`, `login`, `changePassword`. `src/main/directory.js`: `listOffices`, `createOffice`, `updateOffice`, `archiveOffice`, `restoreOffice`, `listEmployees`, `createEmployee`, `updateEmployee`, `archiveEmployee`, `restoreEmployee`, `EMPLOYMENT_STATUSES`. `src/main/ipc.js`: `registerIpc`, `CHANNELS`. `src/main/db.js`: `createPool`, `migrate`. `src/main/config.js`: `loadConfig`. `src/main/main.js`, `src/main/preload.cjs`. `src/renderer/App.jsx`, `pages/Login.jsx`, `ChangePassword.jsx`, `Offices.jsx`, `Employees.jsx`, `DbError.jsx`, `components/ConfirmDialog.jsx`, `components/ui.jsx`. Tables: users, offices, employees.

Deliberately not built, and why: user management, because Phase 6 owns US-2. Records and numbering, because Phase 1 owns US-5.

Conventions later phases inherit: every IPC result is `{ ok, data }` or `{ ok: false, error, errors? }`. A new channel goes in `ipc.js` ROUTES with an access level (`public`, `loggedIn`, `ready`) and in the `preload.cjs` allowlist (a unit test checks they match). Text input is trimmed and inner spaces collapsed (`text()` in `directory.js`). Removal is archive (`archived_at`), never DELETE. Every table declares `utf8mb4_unicode_ci`. Schema changes are `CREATE TABLE IF NOT EXISTS` only, so the first phase that alters a table adds a `schema_version` table. Tests run only on a database ending in `_test`. Electron is pinned at 41.2.2.

### Phase 1 — Signatories and record creation with auto-numbering ✅ DONE (merged `183a13b`, 2026-11-21)

A record needs signatories and employees, and the numbering rule is the core business rule.
Covers US-4, US-5.

- Staff maintain signatories and office defaults.
- Staff create PLS and TO records for both offices with numbers from 4 monthly counters.

**Done when:** records created in two different months and for all 4 counters get the right numbers (`2026-11-1`, `SB 2026-11-1`, reset on a new month). A double-click on Save creates one record. — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe: all US-4 and US-5 conditions incl. overlap warning (49/49 full E2E, 67/67 unit). Month reset, 5 concurrent saves and restore-safe numbering verified at unit level with an injected clock. Results: `docs/test-results/PHASE-1-TEST-RESULTS.md`. Regression: full suite (schema change), US-1 and US-3 pass.

Shipped as `src/main/signatories.js`: `ISSUING_OFFICES`, `ROLES`, `listSignatories`, `createSignatory`, `updateSignatory`, `archiveSignatory`, `restoreSignatory`, `getDefaults`, `setDefault`, `activeSignatory`. `src/main/records.js`: `FORM_TYPES`, `formatNumber`, `periodOf`, `createRecord`. `src/main/directory.js`: `fieldErrors`, `text`, `isDup` now exported. `src/main/ipc.js` routes `signatories:*`, `records:create`. `src/renderer/pages/Signatories.jsx`, `NewRecord.jsx`. `components/ConfirmDialog.jsx` (`confirmClass` prop). Tables: signatories, signatory_defaults, records, record_employees.

Deliberately not built, and why: printing, because Phase 2 owns US-6. Record list and edit, because Phase 3 owns US-8 and US-10.

Picked up from Phase 0: conventions (IPC shape, ROUTES + allowlist, `text()`, archive-only, utf8mb4 tables, `_test` databases).

Conventions later phases inherit: a record number is never assigned outside `createRecord`'s per-counter `GET_LOCK` (`plsto:<form>:<office>:<period>`) plus `MAX(seq)+1`. US-7 blank forms must reuse it. The period is the creation month in local time. Records hold snapshots (employee name, designation, status, office_id; signatory name and title), so printing reads the record, not the master lists. Overlap means inclusive dates intersect on an active record, and it warns with `overlaps` and is confirmed with `confirmOverlap: true`. Users approved: vehicle and return optional, date filed editable.

### Phase 2 — Print filled and blank forms ✅ DONE (merged `c275f64`, 2026-11-21)

Printing is the paper the office signs, and blank forms share the counter, so both come right after numbering.
Covers US-6, US-7. Reopens Phase 1: US-5 purpose limited to 360 characters (needed by US-6) on 2026-11-21.

- Filled .xlsx on the official layout for all 4 templates.
- Numbered blank form that reserves a number and is filled later.

**Done when:** in the packaged app, a saved record of each of the 4 kinds prints to an .xlsx with the hand-checked values in the template cells and fits one A4 page. A blank form reserves the next number, prints number and signatories only, and is filled in later under the same number. The full E2E suite passes, including CW-1. — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe (OS save dialog and shell stubbed): all US-6 and US-7 conditions, US-5 purpose limit, CW-1 (63/63 full E2E, 103/103 unit). All 4 templates rendered in Excel with worst-case values and checked by eye. Results: `docs/test-results/PHASE-2-TEST-RESULTS.md`. Regression: full suite (schema change), US-1, US-3, US-4, US-5 pass.

Shipped as `src/main/print.js`: `formatDate`, `formatRange`, `formatTime`, `wrapPurpose`, `getPrintable`, `buildWorkbook`. `src/main/templates/` (`pls-mayor`, `to-mayor`, `pls-sb`, `to-sb`.xlsx). `src/main/records.js`: `issueBlank`, `listBlank`, `fillBlank`, `createRecord` (now on shared `withCounter`). `src/main/db.js`: `migrate` with `MIGRATIONS` (v2). `src/main/ipc.js` routes `records:print`, `records:openExport`, `records:issueBlank`, `records:listBlank`, `records:fillBlank`, `registerIpc(ipcMain, pool, os)`. `src/renderer/pages/NewRecord.jsx` (Print, Issue blank form, Blank forms to fill, fill mode). Tables: records (status, nullable date_filed/inclusive_from/inclusive_to/departure_at), schema_version.

Deliberately not built, and why: reprint from a record list and printing archived records after restore, because Phase 3 owns US-8, US-9 and US-10.

Picked up from Phase 1: numbers only from the shared counter (now `withCounter`), record snapshots feed printing.

Conventions later phases inherit: schema changes are appended to `MIGRATIONS` in `db.js`, never by editing `schema.sql` (v1 snapshot); an ALTER must be safe to re-run. `records.status` is `filled` or `blank`; a blank has NULL dates, `''` destination/purpose and no `record_employees`, so every reader of records filters `status = 'filled'` where dates or people matter (out today, reports, overlaps). Printing reads the record snapshot through `getPrintable` + `buildWorkbook`; the template cell map lives in `print.js` `LAYOUTS`. A template update keeps one sheet named `Form`, fit to one A4 page, and no whitespace-only cells (unit test). Font changes in exceljs go through `restyle` (styles are shared between cells). Files the app opens are only those it just saved (`records:openExport`). Tests reset `pls_to_test` by deleting rows; a test that alters the schema restores it.

### Phase 3 — Browse, edit, archive ✅ DONE (merged `a2cf211`, 2026-11-21)

Paused 2026-11-21: print preview (Phase 7) first, at the user's request. Not started, no branch. Plan: `docs/superpowers/plans/2026-11-21-phase-3-browse-edit-archive.md`.
Staff need to find, fix and void what Phases 1–2 create before monitoring and reports build on it.
Covers US-8, US-9, US-10. US-9 amended 2026-11-21: Restore warns on overlap (user decision in Phase 3 review).

- Search and filter records, edit details, archive and restore.
- Reprint any active record from its detail view.

**Done when:** in the packaged app, records are found by each search kind and filter, opened, edited (number, form and office unchanged), reprinted with the new values, archived and restored. Every US-8, US-9, US-10 condition passes, and the full E2E suite passes (end of Part one). — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe: all US-8, US-9 (incl. restore overlap warning), US-10 conditions; 200-row limit and literal `%`/`_`/`'` search at unit level (89/89 full E2E, 127/127 unit). Results: `docs/test-results/PHASE-3-TEST-RESULTS.md`. Regression: full suite (business rule changed, end of Part one), US-1, US-3, US-4, US-5, US-6, US-7, US-15, CW-1 pass.

Shipped as `src/main/records.js`: `listRecords`, `getRecord`, `updateRecord`, `archiveRecord`, `restoreRecord` (`validateDetails` gains `keep`, `findOverlaps` gains `excludeId`). `src/main/directory.js`: `likeLiteral` now exported. `src/main/print.js`: `getPrintable` (now on `getRecord`). `src/main/ipc.js` routes `records:list`, `records:get`, `records:update`, `records:archive`, `records:restore`. `src/renderer/App.jsx` (navigation `go(page, params)`). `src/renderer/pages/Records.jsx`. `src/renderer/pages/NewRecord.jsx` (edit mode, fill from params). `src/renderer/components/PrintFlow.jsx`: `usePrint`. `components/ConfirmDialog.jsx` (title id from `useId`). Tables: none.

Deliberately not built, and why: "out today" and per-office reports, because Phase 4 owns US-11 and US-12. An edit history, because no story asks for it.

Picked up from Phase 7: every print path goes through `print(rec)`, now `usePrint()` shared by New record and Records. Picked up from Phases 1–2: readers needing dates or people filter `status = 'filled'`, archive-only removal.

Conventions later phases inherit: pages receive `{ params, go }` and every `go()` remounts the page, so page state starts fresh. Record search uses `likeLiteral` with `ESCAPE '\\'` on parameters. Active records are `archived_at IS NULL` (filled and blank); reports and "out today" also need `status = 'filled'`. Edits keep people and signatories already on a record valid even if archived since; only new ones must be active. The overlap warning (`findOverlaps` with `excludeId`) runs on create, fill, edit and restore of a filled record. Lists cap at 200 rows with a `truncated` flag.

### Phase 7 — Print preview ✅ DONE (merged `7b53b1d`, 2026-11-21)

Reopens Phase 2: US-6 and US-7 print flow now opens the preview first (US-15) on 2026-11-21.
HR asked to check the filled form on screen before saving it, ahead of browsing and editing.
Covers US-15.

- Print, Print again and Issue blank show the filled form on screen, then "Save as Excel" or "Close".

**Done when:** in the packaged app, the preview of each of the 4 form kinds shows the hand-checked values in the template layout, "Save as Excel" produces the same .xlsx as before, and "Close" writes nothing. US-6, US-7, US-15 and CW-1 pass. — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe: all US-15 conditions incl. literal display of `<script>` text and a loaded logo; preview values equal the saved .xlsx for all 4 templates (unit); in-app preview of all 4 kinds compared by eye with the Excel renders (70/70 full E2E, 109/109 unit). Results: `docs/test-results/PHASE-7-TEST-RESULTS.md`. Regression: full suite, US-5, US-6, US-7, CW-1 pass.

Shipped as `src/main/print.js`: `fillWorkbook`, `previewOf` (`buildWorkbook` now wraps `fillWorkbook`). `src/main/ipc.js` route `records:preview`. `src/renderer/components/FormPreview.jsx`. `src/renderer/pages/NewRecord.jsx` (`print(rec)` opens the preview, `saveFromPreview`). `src/renderer/index.html` CSP `img-src 'self' data:`. Tables: none.

Deliberately not built, and why: preview of unsaved forms (no number yet, user decision); pixel-exact rendering through Excel (needs Excel on every PC, user decision).

Picked up from Phase 2: the print flow (`records:print`, Saved to / Open file) is unchanged behind "Save as Excel".

Conventions later phases inherit: every print path goes through `print(rec)` (preview first). Preview and file come from the same `fillWorkbook`, so a new template or cell change needs no preview change. Record text reaches the screen only as React text, never as HTML. A native `<dialog>` is closed through its `close` event, and async results that arrive after it closed are dropped.

## Part two — Monitoring and data safety

### Phase 4 — Out today and per-office reports ✅ DONE (merged `0bf50d6`, 2026-11-21)

Covers US-11, US-12. User decisions 2026-11-21: the report range matches travel (inclusive) dates, like the Records filter; Out today is the page after login (US-1 "opens the dashboard").

- Dashboard of employees out on a date, per-office report with .xlsx export.

**Done when:** in the packaged app, Out today lists every employee on an active filled record for the chosen date, filtered by office, and the per-office report shows rows and counts for a travel-date range and exports the same rows to .xlsx. Every US-11, US-12 and CW-2 condition passes. — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe: all US-11 and US-12 conditions, CW-2 (blank → fill → out today → edit → moves), archived and blank excluded, archived offices still filterable (102/102 full E2E, 143/143 unit). Results: `docs/test-results/PHASE-4-TEST-RESULTS.md`. Regression: full suite (App.jsx and `records:print` are shared by several phases), US-1 (landing now Out today), US-3 to US-10, US-15, CW-1 pass.

Shipped as `src/main/reports.js`: `outOn`, `officeReport`, `reportFile`. `src/main/records.js`: `isDate` now exported. `src/main/ipc.js`: `saveExport` (now behind `records:print`), routes `reports:out`, `reports:office`, `reports:export`. `src/renderer/pages/OutToday.jsx`, `Reports.jsx`. `src/renderer/components/useOffices.js`: `useOffices`. `src/renderer/App.jsx` (Out today first and landing, Reports last). Tables: none.

Deliberately not built, and why: export from Out today, because US-11 asks for none. Grouped office headings on Out today, because US-11 allows "groups or filters" and the filter covers it. Midnight rollover of a page left open, because a nav click reloads it.

Picked up from Phase 3: active records = `archived_at IS NULL`, plus `status = 'filled'` for dates and people; record snapshots (`record_employees`) are the source of names and offices. Picked up from Phase 2: the `records:print` save path, now `saveExport`.

Conventions later phases inherit: every .xlsx export goes through `saveExport` (save dialog, write, `exported` map), so `records:openExport` opens it. Reports read `record_employees` snapshots, with the office saved on the record, and office filters include archived offices (`useOffices`). Exported cells are plain text or numbers, never formulas. E2E dates relative to today come from `localDay(offset)` in `tests/e2e/helpers.js`; login lands on Out today.

### Phase 8 — Blank form stacks ✅ DONE (merged `cdf750f`, 2026-11-21)

Reopens Phase 2: blank forms are printed in stacks and the Mayor's Office Department Head is picked when filling in (US-7 changed). Reopens Phase 3: US-9 allows deleting unused blanks of a past month (US-18).
HR leaves a stack of numbered blanks on the desk; any employee takes one; HR encodes the returned paper by its number.
Covers US-16, US-17, US-18. Changes US-7, US-9. User decision 2026-11-21: the Mayor TO blank keeps the official paper's empty recommending space (no DEPARTMENT HEAD title).

- Issue 1 to 50 blanks in one step, one .xlsx with one page each, signatories checked before numbers are reserved.
- Encode a returned form by typing its number.
- Delete a past month's unused blanks.
- Schema: `records.recommending_*` nullable (migration v3), since a Mayor's Office blank has no Department Head until filled.

**Done when:** in the packaged app, a stack of each of the 4 kinds prints to one .xlsx with one A4 page per number (checked by eye in Excel, logo included), a Mayor's Office blank shows the empty DEPARTMENT HEAD line, a returned number opens Fill in and links the employees, and a past month's unused blanks are deleted while the current month's cannot be. Every US-16, US-17, US-18 and CW-4 condition passes, US-7 and US-9 still pass, and the full E2E suite passes. — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe: all US-16, US-17, US-18 and CW-4 conditions, US-7 with the Department Head change; 3- and 50-form stacks of all 4 templates opened in Excel 2016 with every sheet selected and the first and last sheet rendered by Excel and checked by eye (116/116 full E2E, 168/168 unit). Results: `docs/test-results/PHASE-8-TEST-RESULTS.md`. Regression: full suite (migration v3, permanent delete), US-1 to US-15, CW-1, CW-2 pass.

Shipped as `src/main/records.js`: `issueBlanks`, `issueBlank` (now on `issueBlanks`), `nextNumbers`, `findBlank`, `unusedBlankMonths`, `deleteUnusedBlanks`, `fillBlank` (Department Head for Mayor blanks), `withCounter` (N numbers), `isDate`. `src/main/print.js`: `buildStackWorkbook` (`buildWorkbook` wraps it), `fillWorkbook` (empty Department Head). `src/main/db.js`: `MIGRATIONS` v3. `src/main/ipc.js`: `records:issueBlank` (count, returns `{ formType, ids, numbers }`), `records:print` (`ids`), routes `records:nextNumbers`, `records:findBlank`, `records:unusedBlanks`, `records:deleteUnusedBlanks`. `src/renderer/pages/NewRecord.jsx` (How many, issue confirmation, Encode a returned form, Delete unused blanks, Department Head at Fill in). `src/renderer/components/PrintFlow.jsx` (`usePrint` stacks). `src/renderer/pages/Records.jsx` (empty Department Head label). Tables: records (recommending_* nullable).

Deliberately not built, and why: linking a blank to an employee when printing, because forms are taken at random (user decision). Reusing a deleted number, because only past months can be deleted.

Picked up from Phase 2: numbers only from `withCounter`, now N at a time. Picked up from Phase 7: every print path goes through `print(rec)`; a stack passes `ids`. Picked up from Phase 4: `saveExport` for every .xlsx.

Conventions later phases inherit: `records.recommending_*` can be NULL only on a Mayor's Office blank; a filled record always has one. A number is unique only with its form type, so lookups use form type + number. Permanent delete exists only in `deleteUnusedBlanks` (status `blank`, past period); everything else stays archive-only. A multi-form .xlsx is one sheet per form, all sheets selected, workbook active tab 0. E2E creates past-month rows by SQL, since the app numbers only in the current month.

### Phase 9 — Paper-first encoding ✅ DONE (merged `d9eed34`, 2026-11-21)

Reopens Phase 1: direct record creation (US-5 Save form and `records:create`) is removed; US-5 rules apply when encoding. Reopens Phase 8: the New record page becomes Forms (Print blank forms, Encode a returned form, Blank forms to fill).
Every PLS/TO starts as a printed blank form; HR types details only when encoding the returned paper (user decision 2026-11-21).
Covers US-5 (changed), CW-1 (changed). User decisions during review 2026-11-21: the Mayor's Office Department Head is pre-filled from the recommending default on Fill in (US-7 changed); no "encoded by" is recorded.

- Forms page: no direct-input form; the fill-in form appears only for Fill in and for Edit (US-8).
- `records:create` and `createRecord` removed; tests and E2E seeds create records by issuing a blank and filling it.

**Done when:** in the packaged app, there is no way to save a record without a blank form first (no Save-only form, `records:create` refused by the preload allowlist), every US-5 condition passes through Encode, CW-1 passes as US-1 → US-3 → US-4 → US-16 → US-17 → US-6, and the full E2E suite passes. — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe: all US-5 conditions through Encode, no direct input (no record form on idle Forms, `records:create` not allowed), CW-1 paper first (117/117 full E2E, 169/169 unit). Results: `docs/test-results/PHASE-9-TEST-RESULTS.md`. Regression: full suite, every story and CW-1, CW-2, CW-4 pass.

Shipped as `src/main/records.js`: `createRecord` removed (`issueBlanks` is the only insert into `records`). `src/main/ipc.js`: route `records:create` removed; `src/main/preload.cjs` allowlist without it. `src/renderer/pages/NewRecord.jsx` (Forms: record form only for Fill in and Edit; Department Head pre-filled from `defaults.MAYOR.recommending`). `src/renderer/App.jsx` (menu `Forms`). `tests/e2e/helpers.js`: `seedRecord` (issue + fill), `openReturnedBlank`, `pickDepartmentHead`, `recordForm`, `blankFormsSection`. Tables: none.

Deliberately not built, and why: a walk-in exception (user decision: one path, blank then encode). An "encoded by" user on records (user decision: not needed).

Picked up from Phase 8: blanks, Encode by number, Fill in with the Department Head. Picked up from Phase 1: US-5 rules, now applied by `fillBlank`.

Conventions later phases inherit: a record is created only by `issueBlanks` then `fillBlank`; there is no direct-create path or route. Tests make records the same way (`seedRecord` through IPC, `openReturnedBlank` through the UI). The page key stays `newRecord`, its label is `Forms`; E2E finds the page heading with `{ name: 'Forms', exact: true }`. `created_by` is the user who issued the blank.

### Phase 5 — Backup and restore ✅ DONE (merged `b91230e`, 2026-11-21)

On hold 2026-11-21: the user asked to stop before Phase 5. Not started, no branch. Moved back to LATER for Phase 8 (user request), NEXT again after Phase 8, then LATER again for Phase 9 (user request), NEXT again after Phase 9. Started on the user's request after Phase 9.

Covers US-13, US-14.

- .sql backup to a chosen folder, restore with automatic pre-restore backup.

**Done when:** in the packaged app, a backup writes a dated .sql to the chosen folder, a restore saves the current data first, replaces it, and logs everyone out, and an invalid file changes nothing. Every US-13, US-14 and CW-3 condition passes. — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe: all US-13, US-14 and CW-3 conditions; unit: round trip with quotes, backslashes, newlines and Ñ, invalid, truncated, crafted and orphaned files refused with data unchanged, numbering after restore, older schema migrated (124/124 full E2E, 186/186 unit). Results: `docs/test-results/PHASE-5-TEST-RESULTS.md`. Regression: full suite (every table replaced by a restore), all stories and CW-1 to CW-4 pass.

Shipped as `src/main/backup.js`: `TABLES`, `backupName`, `freePath`, `writeBackup`, `restoreBackup`. `src/main/db.js`: `SCHEMA_VERSION`. `src/main/ipc.js` routes `backup:create`, `backup:pick`, `backup:restore` (`picked` map; `os.chooseFolder`, `os.chooseBackupFile`, `os.backupDir`, `os.dbConfig`). `src/main/main.js` (folder and file pickers, `PLS_TO_BACKUP_DIR`). `src/renderer/pages/Backup.jsx`. `src/renderer/pages/Login.jsx` (`notice`). `src/renderer/App.jsx` (menu `Backup`, `signOut`). Tables: none (restore replaces all of them).

Deliberately not built, and why: admin-only backup and restore, because the spec limits only user management to admins (revisit with Phase 6 / US-2). Scheduled automatic backups, because no story asks for them.

Picked up from Phase 2: `migrate` and `MIGRATIONS`, now also run on a restored database. Picked up from Phase 0: sessions in the main process, cleared after a restore.

Conventions later phases inherit: a new table must be added to `TABLES` in `backup.js` (parents before children) and, if it has foreign keys, to `ORPHANS`, or backups will not carry it. Backup files start with `-- PLS-TO Records System backup v1 schema <n>` and end with `-- end of backup`; restore accepts only the statement shapes `writeBackup` emits, on `TABLES`. A restore never touches live tables before the single `RENAME TABLE` swap. Files the user picks are remembered in the main process (`exported`, `picked`); a renderer-supplied path is never opened or restored. E2E sets `PLS_TO_BACKUP_DIR` to a temp folder and stubs `dialog.showOpenDialog` with `mockOpenDialog`.

### Phase 6 — User account management NEXT

Reopens Phase 5: US-14 restore becomes admin-only (user decision 2026-11-21).
Covers US-2 (changed), US-14 (changed).

- Admin adds encoders, resets passwords (temporary, changed at next login), disables and re-enables accounts.
- An `admin` access level for IPC routes; Users page and Restore visible to admins only.

**Done when:** in the packaged app, an admin adds an encoder, the encoder logs in and sees no Users page and no Restore; the admin resets the encoder's password and the encoder must change it at the next login; the admin disables the encoder, whose open session ends and who cannot log in, then re-enables them; the admin cannot disable themselves or the last active admin. Every US-2 and US-14 condition passes, and the full E2E suite passes (end of Part two).

Deliberately not built, and why: editing a user's name or role, and deleting users, because US-2 asks for neither.
