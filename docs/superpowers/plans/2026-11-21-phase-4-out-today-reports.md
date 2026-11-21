# Phase 4 — Out Today and Per-Office Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff see who is out on a PLS or TO on any date (US-11) and run a per-office report for a travel-date range with .xlsx export (US-12).

**Architecture:** A new `src/main/reports.js` holds two read queries and the export workbook. Both read `record_employees` snapshots joined to active filled `records`. Two new pages, `OutToday.jsx` (first page after login) and `Reports.jsx`. Export reuses the `records:print` save path through one shared helper in `ipc.js`, so `records:openExport` opens the report file too.

**Tech Stack:** unchanged (exceljs for the export).

**Spec:** `spec.md` US-11, US-12, CW-2. Conventions: `roadmap.md` Phase 0–3 and Phase 7 "Conventions later phases inherit".

## Global Constraints

- Only `records.status = 'filled' AND records.archived_at IS NULL` count. Blank issued and archived records never appear.
- "Office" is the employee's office saved on the record (`record_employees.office_id`), named from `offices.name` (archived offices still show).
- A record is out on date D when `inclusive_from <= D <= inclusive_to`. The report range matches the same way as the Records filter: inclusive dates overlap `[from, to]` (user decision 2026-11-21).
- Out today is the first nav item and the page after login (user decision 2026-11-21, US-1 "opens the dashboard"). Nav order: Out today, Employees, Offices, Signatories, New record, Records, Reports.
- Copy, exact: Out today heading `Out today`, empty `No one is out on this date`. Reports heading `Reports`, empty `No records found`. Range error `End date is before start date`. Missing range end `Required`. Invalid date `Enter a valid date`. Export result `Saved to <path>` with `Open file`. Write failure: `Could not save the file. If it is open in Excel, close it and try again.`
- Return time on screen: `YYYY-MM-DD HH:MM`, or `—` when the record has none.

## Review Focus

1. A 3-day record shows on its first, middle and last day, and not the day before or after. Test in Task 1.
2. One record with employees from two offices: each employee shows under their own office, the office filter keeps only that office's employee, and the count gives each office 1 record. Test in Task 1.
3. An employee or office archived after the record was saved still shows with the saved name. Test in Task 1.
4. A record whose dates were edited (US-8) shows only on its new dates. Test in CW-2 (Task 5).
5. Report text that starts with `=` (destination `=1+1`) is written to the .xlsx as text, not a formula. Test in Task 2.

---

### Task 0: Branch
- [ ] `git checkout -b phase-4-out-today-reports`. Commit this plan as `docs: Phase 4 plan`.

### Task 1: Queries

**Files:** Create `src/main/reports.js`, `tests/unit/reports.test.js`. Modify `src/main/records.js` (export `isDate`).

**Interfaces:**
- `outOn(pool, { date, officeId = null })` → `{ ok, data: [{ recordId, number, formType, fullName, officeId, officeName, destination, returnAt, inclusiveFrom, inclusiveTo }] }` ordered by office name, full name, number. Invalid `date` → field error `{ date: 'Enter a valid date' }`.
- `officeReport(pool, { officeId = null, formType = '', from, to })` → `{ ok, data: { rows: [{ recordId, number, formType, fullName, officeName, dateFiled, inclusiveFrom, inclusiveTo, destination }], counts: [{ officeName, PLS, TO }] } }`. `rows` ordered by office name, full name, inclusive_from, number. `counts` = `COUNT(DISTINCT record id)` per office and form, one entry per office that has rows, ordered by name, zeros filled. Errors: missing `from`/`to` → `Required`; not a date → `Enter a valid date`; `to < from` → `{ to: 'End date is before start date' }`. Non-numeric `officeId` means no filter (`Number(x) || 0`), unknown `formType` means all.
- [ ] Tests first (hand-derived), seed: offices MHO and RHU; Ana (MHO), Ben (MHO), Carla (RHU). Records: A = PLS Ana+Carla 11-20..11-22, return `2026-11-22T17:00`; B = TO Ben 11-21; C = blank; D = PLS Ben 11-21 archived.
  - `outOn 11-21` → Ana A, Ben B (MHO), Carla A (RHU); not D, not C. `11-19` and `11-23` → empty; `11-20` and `11-22` → Ana, Carla.
  - Office filter RHU on `11-21` → Carla only. `returnAt` `2026-11-22 17:00:00` for A, `null` for B.
  - Archive Ana and rename her to `Ana X` after saving A → still `Ana` on `11-21`.
  - `officeReport 11-01..11-30` rows: MHO Ana A, MHO Ben B, RHU Carla A. Counts `[{ MHO, PLS: 1, TO: 1 }, { RHU, PLS: 1, TO: 0 }]`. `formType: 'TO'` → Ben B only, counts `[{ MHO, PLS: 0, TO: 1 }]`. Range `11-23..11-30` → empty rows and counts. Errors as above.
- [ ] Mutations: drop `archived_at IS NULL` → D appears, red. Change `inclusive_to >= ?` to `>` → last-day test red. Commit `feat: out-today and per-office report queries`.

### Task 2: Export workbook and IPC

**Files:** Modify `src/main/reports.js`, `src/main/ipc.js`, `src/main/preload.cjs`, `tests/unit/reports.test.js`, `tests/unit/ipc.test.js`.

**Interfaces:**
- `reportWorkbook({ rows, counts }, { from, to, officeName, formType })` → `Buffer`. One sheet `Report`: row 1 `PLS and TO report, <from> to <to>`; row 2 `Office: <name or All> · Form: <PLS|TO|All>`; row 4 header `Office, Employee, Form, Number, Date filed, Travel dates, Destination`; one row per report row (travel dates `<from> to <to>`). Two empty rows, then `Office, PLS, TO` and one row per count. Every cell value is a string or number, never a formula.
- `ipc.js`: `saveExport({ os, exported, id }, defaultName, buffer)` holds the existing save dialog + write + `exported.set` from `records:print`, which now calls it. Routes (`ready`): `reports:out` → `outOn`, `reports:office` → `officeReport`, `reports:export` → runs `officeReport` with the same filters, refuses errors as returned, then `saveExport` with `PLS-TO report <from> to <to>.xlsx`.
- [ ] Tests first: workbook cells for the Task 1 seed (A1, A2, header row 4, first data row, counts block); destination `=1+1` reads back as the string `=1+1` with no formula. IPC: the 3 routes refuse before the password change; `reports:export` writes a readable file to the faked path, `records:openExport` then opens it; cancelled dialog writes nothing; a `to < from` export returns the field error and opens no dialog; allowlist sync.
- [ ] Mutation: write rows as `{ formula }` when text starts with `=` → formula test red. Existing `records:print` IPC tests stay green. Commit `feat: report export and IPC`.

### Task 3: Out today page and landing

**Files:** Create `src/renderer/pages/OutToday.jsx`. Modify `src/renderer/App.jsx`, `tests/e2e/helpers.js` (`loginAsChangedAdmin` waits for `Out today`), `tests/e2e/features/us-1-login.spec.js` (3 landing assertions: `Employees` → `Out today`, justified by US-1 "opens the dashboard").
- Controls: `Date` (default local today) and `Office` (All + active offices). Reload on change. States: loading, error + Retry, `No one is out on this date`.
- One table, columns Office, Employee, Form, Number, Destination, Travel dates, Return (ordered by office). US-11 "groups or filters": the Office filter covers it; grouped headings cut at step 6.
- After logout and login, landing is Out today (nav reset already does this).

### Task 4: Reports page

**Files:** Create `src/renderer/pages/Reports.jsx`.
- Filters: `Office` (All + active offices), `Form` (All/PLS/TO), `Travel from`, `Travel to` (default first and last day of the current local month). Reload on change, 250 ms debounce like Records. Field errors under the date inputs. Offices load failure shows Banner + Retry.
- Counts table (Office, PLS, TO) above the rows table (Office, Employee, Form, Number, Date filed, Travel dates, Destination). `No records found` when empty.
- `Export to Excel` (disabled while loading, while exporting, or with no rows; label `Exporting…` while pending). Shows `Saved to <path>` + `Open file` (`records:openExport`), or the error Banner. Cancel in the dialog shows nothing.
- [ ] Build, throwaway screenshot smoke of both pages, look, delete it. Commit `feat: out today and reports pages`.

### Task 5: E2E (step 8)

**Files:** Create `tests/e2e/features/us-11-out-today.spec.js`, `us-12-office-report.spec.js`, `tests/e2e/system/cw-2-blank-lifecycle.spec.js`.
- Dates are hand-derived from the test machine's local today (`today`, `today+1`, `today-1`) so the default view is exercised.
- US-11: landing after login; lists every employee out today with office, form, number, destination, return; another date; office filter; archived and blank absent.
- US-12: each filter; rows and counts; export cells equal the shown rows (read the .xlsx); archived and blank excluded; `to < from` rejected; Open file opens exactly the saved file.
- CW-2: issue blank → not in Out today → fill in from Records with today's dates → in Out today → edit dates to tomorrow (US-8) → gone today, present tomorrow.
- [ ] Mutations: Out today default date = yesterday → US-11 landing test red. Report counts without `DISTINCT` (two-employee record counted twice) → US-12 counts red. Commit `test: E2E for US-11, US-12, CW-2`.

### Task 6: Package, verify, record
- [ ] Package, full E2E on the packaged exe, `npm test`, rebuild the installer, check `pls_to` untouched, write `docs/test-results/PHASE-4-TEST-RESULTS.md`, commit.

---

## Test scope

```
Feature: Phase 4, US-11, US-12
Feature tests: unit and integration for outOn, officeReport, reportWorkbook, reports:* routes, saveExport via records:print. E2E for US-11, US-12
Regression E2E: US-1 (landing page changed), US-6, US-7, US-15, CW-1 (records:print moved onto saveExport), US-3 and the rest via full run
System E2E: CW-2 (first time: US-7 → US-8 → US-11), CW-1
Full E2E run: yes, App.jsx (Phase 0 and Phase 3 "Shipped as") and the records:print route (Phase 2, Phase 7) change
```
