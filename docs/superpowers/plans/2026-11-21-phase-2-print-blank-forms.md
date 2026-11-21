# Phase 2 — Print Filled and Blank Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff print any saved record as a filled .xlsx on the official layout, and issue numbered blank forms that are filled in later (US-6, US-7, plus the US-5 purpose limit).

**Architecture:** Four one-sheet templates, cut from the user's Excel files, live in `src/main/templates/`. `print.js` loads one with `exceljs`, writes the record's values into a fixed cell map per template, and returns a Buffer. The main process shows the save dialog, writes the file, and opens only the file it just saved. Blank records add a `status` column through the first versioned migration (`schema_version`). Number assignment moves into one shared locked helper used by both normal and blank records.

**Tech Stack:** Phase 1 stack plus `exceljs` 4.4.0 (spike-verified: keeps the header image, merges, A4 print setup, rich-text number cell, and `Ñ`).

**Spec:** `spec.md` US-6, US-7 (Changed 2026-11-21), US-5 purpose limit (Changed 2026-11-21). Conventions: `roadmap.md` Phase 0 and Phase 1 "Conventions later phases inherit".

## Global Constraints

- Phase 0/1 conventions hold. Numbers come only from the shared counter helper (GET_LOCK `plsto:<form>:<office>:<period>` + `MAX(seq)+1`).
- Template sources (sheet → file): `NEW PLS.xlsx` "PLS NOV 2026 " → `pls-mayor.xlsx`; `NEW TO.xlsx` "TO NOV 2026" → `to-mayor.xlsx`; `NEW PLS SB.xlsx` "PLS NOV 2026" → `pls-sb.xlsx`; `NEW TO SB.xlsx` "TO NOV 2026" → `to-sb.xlsx`. Each holds one sheet named `Form`, with `pageSetup.fitToPage = true`, `fitToWidth = 1`, `fitToHeight = 1`.
- Formats, exact: date `November 20, 2026`; range same day `November 20, 2026`, same month `November 20-22, 2026`, same year `November 30 - December 2, 2026`, else `December 30, 2026 - January 2, 2027`; time `8:00 AM` / `1:30 PM`.
- Purpose: at most 360 characters after `text()`; error `At most 360 characters`.
- Copy, exact: archived print `Restore this record before printing.`; write failure `Could not save the file. If it is open in Excel, close it and try again.`; saved banner `Saved to <path>` with button `Open file`; blank confirm title `Issue a blank <PLS|TO> for <office label>?`, message `This reserves the next number.`, confirm `Issue blank`; list heading `Blank forms to fill`; empty list `No blank forms waiting`.
- Statuses: `filled` | `blank` (UI labels `Filled`, `Blank issued`).

## Cell map (exact; rows from the spike and border analysis)

| Key | pls-mayor | to-mayor | pls-sb | to-sb |
|---|---|---|---|---|
| number (rich text) | A12 | A10 | A10 | A10 |
| date `DATE: <date>` | H12 | H10 | H10 | H10 |
| name rows (A name, E designation, H status) | 14–18 | 12–16 | 12–16 | 12–16 |
| destination (label + value) | A20 | A18 | A18 | A17 |
| inclusive | A21 | A19 | A19 | A18 |
| vehicle | F21 | F19 | F19 | F18 |
| departure / time | A22 / G22 | A20 / G20 | A20 / G20 | A19 / G19 |
| return / time | A23 / G23 | A21 / G21 | A21 / G21 | A20 / G20 |
| purpose lines (first keeps label) | A24–A27 | A22–A25 | A22–A25 | A21–A24 |
| recommending name / title | A31 (new, merge A:K) / A32 | A29 (new) / A30 (new) | A29 / A30 | A28 / A29 |
| approving name / title | A37 / A38 | A36 / A37 | A36 / A37 | A34 / A35 |

- Label cells are rewritten as `<LABEL>: <value>`, using the template's own label text before the colon (`DESTINATION(S)` stays on to-mayor). Departure becomes `DEPARTURE: November 20, 2026`, its time cell `TIME: 8:00 AM`. Empty optional values (vehicle, return) leave the template cell unchanged.
- Number cell: keep run 1 (label) as is. Then run 2 `<prefix><period>-` (prefix `SB ` for SB), using the font of the template's second run, then run 3 `<seq>`, using the font of the template's last run.
- "(new)" cells: merge `A<r>:K<r>`, center. The name copies the font of the approving name cell, the title copies the font of the approving title cell.
- Purpose: greedy word wrap, 78 chars on the label line, then 92 per line. Anything past line 4 is appended to line 4 (`shortcut: 360-char limit makes this practically unreachable, revisit if staff report clipping`).

## Review Focus

1. A purpose of exactly 360 characters with long words wraps into the 4 lines without clipping. Visual check in Task 6, unit wrap test in Task 3.
2. A cross-month inclusive range (`November 30 - December 2, 2026`) is not cut off by the VEHICLE cell. Visual check in Task 6.
3. The save dialog cancelled → nothing written, no error. File locked by Excel → exact error, record unchanged. Tests in Task 4.
4. `records:openExport` opens only the file this session just saved, never a renderer-supplied path. Test in Task 4.
5. Existing Phase 1 databases migrate to v2 with every record intact and `status = 'filled'`. Test in Task 1.

---

### Task 0: Branch and templates

- [ ] `git checkout -b phase-2-print-blank-forms`. Commit `spec.md`, `roadmap.md`, and this plan as `docs: Phase 2 spec changes and plan`.
- [ ] `npm i exceljs@4.4.0`. One-off: cut the 4 template files per Global Constraints (load the source with exceljs, remove the other sheets, rename to `Form`, set fit-to-page, write to `src/main/templates/`). Verify each re-reads with 1 image and 1 worksheet. Commit `chore: exceljs and the 4 form templates`.

### Task 1: Versioned migration v2 (status, nullable blank fields)

**Files:** Modify `src/main/db.js`, `src/main/schema.sql` (header comment only: "v1 snapshot, later changes in db.js MIGRATIONS"), `tests/unit/db.test.js`.

- `migrate(config)`: after schema.sql, `CREATE TABLE IF NOT EXISTS schema_version (version INT NOT NULL) ...utf8mb4...`. If it has no row, insert 1. Apply each `MIGRATIONS[i]` (version i+2) above the stored version, then update the version.
- `MIGRATIONS[0]` (v2): `ALTER TABLE records ADD COLUMN status ENUM('filled','blank') NOT NULL DEFAULT 'filled' AFTER number, MODIFY date_filed DATE NULL, MODIFY inclusive_from DATE NULL, MODIFY inclusive_to DATE NULL, MODIFY departure_at DATETIME NULL`.
- [ ] Tests first: the table list gains `schema_version` (8 tables, 8 collations). `migrate twice keeps version 2`. `v1 database with a record migrates intact`: migrate, insert a record through `createRecord`, simulate v1 (`ALTER TABLE records DROP COLUMN status, MODIFY ... NOT NULL`, `UPDATE schema_version SET version = 1`), migrate again. The record's number and fields are unchanged and `status = 'filled'`.
- [ ] Mutation: skip the version check (always apply) → `migrate twice` red (duplicate column). Commit `feat: versioned migrations, v2 blank-record columns`.

### Task 2: Shared counter, purpose limit, blank records

**Files:** Modify `src/main/records.js`, `tests/unit/records.test.js`.

**Interfaces:**
- Internal `withCounter(pool, formType, issuingOffice, now, insert)`: holds the existing GET_LOCK, transaction, rollback, and release/destroy logic. It calls `insert(conn, { period, seq, number })` and returns its result. `createRecord` is refactored onto it, with behavior unchanged (all Phase 1 tests stay green).
- Purpose >360 → `errors.purpose = 'At most 360 characters'` (createRecord and fillBlank).
- `issueBlank(pool, { formType, issuingOffice, recommendingId, approvingId }, { userId, now })` → `{ ok, data: { id, number, formType } }`. Validates form type, office, and both signatories (same messages). Inserts `status='blank'`, NULL dates, `''` destination/purpose/vehicle, and no employees.
- `listBlank(pool)` → `data: [{ id, number, formType, issuingOffice, recommendingName, recommendingTitle, approvingName, approvingTitle, createdAt }]` (active blanks, newest first).
- `fillBlank(pool, { id, ...details, confirmOverlap }, { userId })`. Same detail validation and overlap check as createRecord, but it ignores `formType`, `issuingOffice`, and signatory ids in the payload. Rejects a missing, archived, or already-filled id with `error: 'This blank form is no longer available.'`. Updates the fields, inserts `record_employees`, and sets `status='filled'` in one transaction.
- `findOverlaps` adds `r.status = 'filled'`.
- [ ] Tests first: a 361-char purpose is rejected and 360 is ok. Blank then normal on one counter → `-1` blank, `-2` normal (shared counter). Blank validation (bad role signatory). `listBlank` returns it and drops it after fill. Fill keeps the number and the signatory snapshot even if the payload sends other ids, and sets status filled with its employees. Fill twice → `This blank form is no longer available.` A blank record never shows as an overlap. A fill whose dates overlap another record → `overlaps`, and nothing changes until `confirmOverlap`.
- [ ] Mutations: drop the ignore-signatories rule → snapshot test red. Drop `status='filled'` in findOverlaps → overlap test red. Commit `feat: blank records on the shared counter, purpose limit`.

### Task 3: Workbook builder

**Files:** Create `src/main/print.js`, `tests/unit/print.test.js`.

**Interfaces:**
- `formatDate('2026-11-20')`, `formatRange(from, to)`, `formatTime('2026-11-20 08:00:00')`, `wrapPurpose(text)` → `string[4]` (exported for tests).
- `getPrintable(pool, id)` → `{ ok, data: record + employees[] }`, or `{ ok:false, error:'Restore this record before printing.' }` when archived, or `'Record not found'`.
- `buildWorkbook(record) -> Promise<Buffer>`. It picks the template by `formType` + `issuingOffice` and fills the cell map. For `status='blank'` it fills only the number and signatories.
- [ ] Tests first (hand-derived): the format cases from Global Constraints. `formatTime` for 00:05 → `12:05 AM` and 12:30 → `12:30 PM`. `wrapPurpose` of 360 chars → ≤4 lines, line 1 ≤78 chars, others ≤92, words not split, joined text equal to the input. For each of the 4 templates, build a filled record with 2 employees (one `MARIA PEÑA`), re-read the buffer with exceljs, and assert: the number cell text (`PLS NO: 2026-11-7` / `TRAVEL ORDER NO: SB 2026-11-7`), `DATE: November 21, 2026`, name rows 1-2 filled and row 3 empty, destination, inclusive, departure, time, return untouched when empty, purpose line 1 starts with the template label, both signatory names and titles, 1 image, fitToPage. A blank record → number and signatories set, `H<dateRow>` still `DATE:_______________`.
- [ ] Mutation: swap the name/title cells for one template → its test red. Commit `feat: fill the official PLS/TO templates`.

### Task 4: IPC — print, open, blank

**Files:** Modify `src/main/ipc.js`, `src/main/preload.cjs`, `src/main/main.js`, `tests/unit/ipc.test.js`.

- `registerIpc(ipcMain, pool, { showSaveDialog, openPath })`. `main.js` passes `(opts) => dialog.showSaveDialog(win, opts)` and `shell.openPath`.
- `ready` routes:
  - `records:print {id}`: `getPrintable` → `buildWorkbook` → `showSaveDialog({ defaultPath: path.join(app.getPath('documents'), '<formType> <number>.xlsx'), filters: [{ name: 'Excel', extensions: ['xlsx'] }] })`. Canceled → `{ ok:true, data:{ canceled:true } }`. `fs.promises.writeFile`, where an error gives the exact write-failure copy. Store the last path per sender and return `{ ok:true, data:{ path } }`.
  - `records:openExport` → `openPath(last path for this sender)`. No path → `error: 'Nothing to open yet.'`. A non-empty return string from openPath → that as the error.
  - `records:issueBlank`, `records:listBlank`, `records:fillBlank` → Task 2 functions with `userId`.
- [ ] Tests first, with fake dialog and openPath at the OS boundary: print writes a readable xlsx to the dialog's temp path. Canceled writes nothing. A dialog path in a missing directory → exact error. Archived → exact error. openExport passes exactly the saved path and ignores any payload path. Before the password change → refused. Allowlist sync.
- [ ] Commit `feat: IPC for printing and blank forms`.

### Task 5: UI

**Files:** Modify `src/renderer/pages/NewRecord.jsx`.

- After a successful save, the success banner gets a `Print` button (record id from the save result).
- Shared print flow: the button shows `Printing…` and is disabled while pending. Then the banner `Saved to <path>` with `Open file`, or nothing if canceled, or an error banner.
- Next to Save: a secondary `Issue blank form` button. It opens ConfirmDialog (non-danger) with the exact copy. On confirm it calls `records:issueBlank` with the current form type, office, and signatory ids, then runs the print flow. Field errors (signatories) show under their selects.
- Section `Blank forms to fill` (loading, error + Retry, `No blank forms waiting`). Its table shows Number, Form, Office, Issued (date), and the actions `Fill in` and `Print again`. It reloads after issue and after fill.
- Fill mode: the heading becomes `Fill in <PLS|TO> <number>`. The radios and signatory selects are disabled and show the printed names. Save calls `records:fillBlank` (same overlap dialog). `Cancel` returns to new mode with the form unchanged. Success shows `Saved <form> <number>` with Print.
- [ ] Build, run a throwaway smoke with screenshots, look, delete the smoke. Commit `feat: print and blank forms on New record`.

### Task 6: E2E and visual check (step 8)

**Files:** Create `tests/e2e/features/us-6-print.spec.js`, `tests/e2e/features/us-7-blank-forms.spec.js`. Modify `tests/e2e/helpers.js` (`mockSaveDialog(app, filePath)`, `mockOpenPath(app)` via `app.evaluate` on `dialog`/`shell`, i.e. the OS boundary). Modify `us-5-create-record.spec.js` (purpose limit).

- US-6, one test per condition: save then Print → the dialog's path holds an xlsx whose cells match hand-derived values (reuse the exceljs read). `Saved to` plus `Open file` calls openPath with that path. Canceled → no file, no banner. Write failure (path in a missing folder) → exact error, record row unchanged. Empty vehicle/return keep the template text. Archived (set via SQL) → exact error.
- US-7, one test per condition: the Issue-blank confirm copy, where Cancel reserves nothing (count). Confirm → number `<ym>-1` and the printed file has number and signatories only. The list shows it with Fill in / Print again. Fill in → the radios and signatories are disabled, and save keeps the number and becomes filled (SQL). Fill with an overlapping employee → warning. A blank record is excluded from overlap warnings.
- US-5: a 361-char purpose → `At most 360 characters`.
- System `tests/e2e/system/cw-1-issue-and-print.spec.js`: login → add office and employee → add signatories and defaults → new record → Print. It asserts the hand-offs only: the employee added on Employees appears in the New record pick list, the defaults set on Signatories pre-fill, and the saved number appears in the printed file.
- Visual check (Review Focus 1, 2): for each template, generate a record with a 360-char purpose and a cross-month range. Render it with the Excel chart-export method (scratchpad), look, and record the result. Fix the wrap widths or font only if clipped.
- Regression: the schema changed → **full** E2E suite.
- [ ] Mutations: skip storing the last path → openExport test red. Allow a signatory change on fill → US-7 test red. Commit `test: E2E for US-6, US-7, purpose limit`.

### Task 7: Package, verify, record

- [ ] `npm run build && npx electron-builder --win dir`, then the full E2E run on the packaged exe and `npm test`, all green. Rebuild the NSIS installer (`npm run dist`). Write `docs/test-results/PHASE-2-TEST-RESULTS.md`. Commit `docs: Phase 2 test results`.

---

## Test scope

```
Feature: Phase 2, US-6, US-7 (+ US-5 purpose limit)
Feature tests: unit and integration for db migrations, records.js (withCounter, blank, fill, purpose), print.js, ipc routes. E2E for US-6, US-7, US-5 purpose
Regression E2E: US-5 (records.js createRecord refactored onto withCounter), US-4 (NewRecord signatory selects), US-1 and US-3 via full run
System E2E: CW-1 (US-1 → US-3 → US-4 → US-5 → US-6) becomes complete in this phase: add tests/e2e/system/cw-1-issue-and-print.spec.js
Full E2E run: yes, schema change (records.status, nullable columns, schema_version)
```
