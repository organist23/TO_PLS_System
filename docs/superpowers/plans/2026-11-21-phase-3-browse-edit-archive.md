# Phase 3 — Browse, Edit, Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff find any record by search and filters, open it, edit it, reprint it, and archive or restore it (US-8, US-9, US-10).

**Architecture:** New query and update functions in `records.js` (same layering, no schema change since `archived_at` and `status` already exist). A new `Records` page holds the list, filters and detail view. Editing reuses the New record form in a third mode (`edit`, next to `new` and `fill`). App navigation gains page parameters so Records can open the form on a record and return.

**Tech Stack:** unchanged.

**Spec:** `spec.md` US-8, US-9, US-10 (Changed 2026-11-21). Conventions: `roadmap.md` Phase 0–2 "Conventions later phases inherit".

## Global Constraints

- Earlier conventions hold. Readers that need dates or people filter `status = 'filled'`, and archive is the only removal.
- Status filter values: `active` (default: filled and blank, not archived), `filled`, `blank`, `archived`. UI labels: `Active`, `Filled`, `Blank issued`, `Archived`.
- The list holds at most the newest 200 rows (`ORDER BY id DESC`). When more match, it says `Showing the newest 200 records. Narrow the search to see older ones.`
- Date range: the record's inclusive dates overlap `[from, to]`. Either end may be empty, and `to < from` gives `errors.to = 'End date is before start date'`.
- Copy, exact: empty list `No records found`. Archive confirm title `Archive <PLS|TO> <number>?`, message `It will be hidden from lists, reports and "out today". Its number is never reused. You can restore it from Archived.`, confirm `Archive`. Edit refused: `This record can no longer be edited.` Missing record: `Record not found`.
- Edit: number, form type and issuing office are fixed. People already on the record keep their saved details even if archived since; new ones must be active and get current details. The overlap check ignores the record itself.

## Review Focus

1. Search text with `%`, `_`, `'` or `Ñ` matches literally (number, employee name, destination, purpose). Test in Task 1.
2. Editing a record whose employee and signatory were archived since saves without removing them, and keeps their saved names. Test in Task 2.
3. Editing a record never changes its number, form type, office or status, even with a tampered payload. Test in Task 2.
4. Two windows are not possible, but an edit of a record archived in the meantime is refused, not silently applied. Test in Task 2 (`This record can no longer be edited.`).
5. The detail view of a blank record offers Fill in, not Edit, and an archived record offers only Restore. Test in Task 5.

---

### Task 0: Branch
- [ ] `git checkout -b phase-3-browse-edit-archive`. Commit `spec.md` and this plan as `docs: Phase 3 spec changes and plan`.

### Task 1: List and get

**Files:** Modify `src/main/records.js`, `src/main/print.js` (`getPrintable` uses `getRecord`), `tests/unit/records.test.js`.

**Interfaces:**
- `listRecords(pool, { search='', formType='', issuingOffice='', officeId=null, from='', to='', status='active' })` → `{ ok, data: { rows: [{ id, number, formType, issuingOffice, status, archived, names, destination, inclusiveFrom, inclusiveTo, dateFiled }], truncated } }`, or field errors for a bad range. `names` = `GROUP_CONCAT(full_name ORDER BY position SEPARATOR ', ')`. Search uses `likeLiteral` (export it from `directory.js`) on `number`, `destination`, `purpose`, and `EXISTS` on `record_employees.full_name`. `officeId` uses `EXISTS` on `record_employees.office_id`. Fetch `LIMIT 201`, return 200, and set `truncated` when there were 201.
- `getRecord(pool, id)` → `{ ok, data: row + employees[{ employee_id, office_id, full_name, designation, employment_status }] }` or `Record not found`. `getPrintable` = `getRecord` + the archived check.
- [ ] Tests first (hand-derived), with a seed of 3 records across 2 offices, one blank and one archived:
  - Default list = active (filled + blank, newest first) without the archived one. Each status filter returns exactly its rows.
  - Search by number fragment, by employee name (`peña` finds `MARIA PEÑA`), by destination, and by purpose. `%` matches literally.
  - Form type and office filters. The employee-office filter.
  - Range `2026-11-21..2026-11-21` matches a record on `11-20..11-22` and not one on `11-23..11-24`. A blank never matches a range. `to < from` → error.
  - Limit: 201 seeded rows (via a direct SQL insert loop) → 200 rows and `truncated: true`.
  - `getRecord` returns employees in position order. An unknown id → `Record not found`.
- [ ] Mutation: drop the escaping in search → the `%` test goes red. Commit `feat: list and get records`.

### Task 2: Edit, archive, restore

**Files:** Modify `src/main/records.js`, `tests/unit/records.test.js`.

**Interfaces:**
- `validateDetails(conn, input, errors, keep = new Map())`: ids in `keep` (employee_id → saved snapshot row) skip the active check and reuse the snapshot.
- `findOverlaps(conn, employees, from, to, excludeId = null)`.
- `updateRecord(pool, { id, ...details, recommendingId, approvingId, confirmOverlap })`. It loads the record (`status='filled' AND archived_at IS NULL`, else `This record can no longer be edited.`). A signatory id equal to the saved one keeps the saved name and title, even if archived. A different id must be active with the right role and takes its current name and title. It validates details with `keep` = the current employees, checks overlaps excluding itself, then in one transaction UPDATEs the detail and signatory columns (never number, form type, office or status) and replaces `record_employees`, with kept people using their saved snapshot. Result: `{ ok, data: { id, number, formType } }`.
- `archiveRecord(pool, { id })` and `restoreRecord(pool, { id })` set or clear `archived_at`. Both work for filled and blank records.
- [ ] Tests first:
  - Edit changes destination, dates, purpose and employees, and the number is unchanged.
  - A payload with `formType`, `issuingOffice`, `number` and `status` is ignored (SQL check).
  - Archived-since employee and signatory are kept with their saved names, and the save succeeds. Adding a newly archived employee → `Choose active employees`. Switching to an archived signatory → the role message.
  - US-5 validation messages apply (one sample each: required, 361-char purpose, return before departure).
  - The overlap ignores itself: editing a record's own dates without other records → no warning. Another record overlapping → warning, and `confirmOverlap` saves.
  - Editing an archived, blank or missing record → exact refusal.
  - Archive then restore. The archived record is hidden from the active list. A new record after archiving `-1` still gets `-2`. A blank can be archived.
- [ ] Mutations: drop `excludeId` → the self-overlap test goes red. Drop `keep` → the archived-since test goes red. Commit `feat: edit, archive and restore records`.

### Task 3: IPC

**Files:** Modify `src/main/ipc.js`, `src/main/preload.cjs`, `tests/unit/ipc.test.js`.
- [ ] `ready` routes: `records:list`, `records:get`, `records:update`, `records:archive`, `records:restore`. Test first: before the password change → refused. Update round trip. Allowlist sync. Commit `feat: IPC for browsing and editing records`.

### Task 4: Navigation with parameters

**Files:** Modify `src/renderer/App.jsx`.
- App state `{ page, params }`. Each page renders as `<Page params={params} go={(page, params) => ...} />`. The nav order is Employees, Offices, Signatories, New record, Records. The landing page stays Employees, so earlier E2E specs hold. Clicking a nav item clears the params.

### Task 5: Records page

**Files:** Create `src/renderer/pages/Records.jsx`, `src/renderer/components/PrintFlow.jsx`. Modify `src/renderer/pages/NewRecord.jsx`.
- **Filters row:** `Search` (250 ms debounce), `Form` (All/PLS/TO), `Issuing office` (All/Mayor's Office/Sangguniang Bayan), `Employee office` (All + active offices), `Travel from`, `Travel to`, `Status` (Active/Filled/Blank issued/Archived). States: loading, error + Retry, `No records found`, and the truncated note.
- **Table:** Number, Form, Office, Names, Destination, Travel dates (`2026-11-20 to 2026-11-22`, or `—` for a blank), Status. A row has an `Open <number>` button.
- **Detail panel** (replaces the table, `Back to list`): every field, employees with designation and status, both signatories, and the status.
  - Actions by state:
    - Filled and active: `Edit`, `Print`, `Archive`.
    - Blank: `Fill in`, `Print`, `Archive`.
    - Archived: `Restore` only.
  - Print goes through the preview first (Phase 7 convention). Revised 2026-11-21: move NewRecord's print state, preview dialog, `saveFromPreview` and `openFile` into `usePrint()` in `src/renderer/components/PrintFlow.jsx` (returns `{ print, printing, openFile, dialog }`), used by both pages unchanged in behavior, with `Saved to` and `Open file`.
  - Archive uses ConfirmDialog with the exact copy, then shows the banner `Archived <number>` and returns to the list.
  - Restore: no confirmation, banner `Restored <number>`.
- **Edit / Fill in:** `go('newRecord', { mode: 'edit' | 'fill', id })`.
- **NewRecord edit mode:** load with `records:get`.
  - Heading `Edit <form> <number>`. Radios disabled.
  - Employees pre-filled. Names show from the record snapshot when the person is no longer in the active list.
  - Signatory selects include the saved signatory as an option even if archived (`<name> — <title> (archived)`).
  - Save calls `records:update` (same overlap dialog) and shows `Saved <form> <number>` with Print.
  - `Cancel` and a successful save `go('records')`.
  - Fill mode can also start from `params` (`mode: 'fill'`), reusing the Phase 2 fill flow.
- [ ] Build, run a throwaway smoke with screenshots, look, delete it. Commit `feat: records page with detail, edit, print, archive`.

### Task 6: E2E (step 8)

**Files:** Create `tests/e2e/features/us-8-edit-record.spec.js`, `us-9-archive-record.spec.js`, `us-10-browse-records.spec.js`. Read `.claude/skills/e2e-testing/SKILL.md` first.
- US-8, one test per condition: edit fields, and the new values show in the list and in the next print (xlsx cell). Number, form and office are locked in the UI. An archived-since employee and signatory are kept on save. Same validation (one required-field case). The overlap ignores itself and warns for others. A blank offers Fill in, not Edit.
- US-9: the confirmation names the number. Cancel changes nothing (SQL). Archive hides the record from the Active list. The Archived filter shows it and Restore brings it back. A new record after archiving does not reuse the number. A blank can be archived. No delete control exists anywhere on the page.
- US-10: columns and newest-first order. Each search kind. Each filter. The travel-date range. `No records found`. Opening shows all details.
- Regression: `records.js` business rules changed (overlap excludeId), so run the **full** suite.
- [ ] Mutations: Archive Cancel calling archive → US-9 red. Default status filter `filled` instead of `active` → US-10 red. Commit `test: E2E for US-8, US-9, US-10`.

### Task 7: Package, verify, record
- [ ] Package, run the full E2E on the packaged exe and `npm test`, rebuild the installer, write `docs/test-results/PHASE-3-TEST-RESULTS.md`, and commit.

---

### Task 8: Restore overlap warning (Amend 2026-11-21, US-9)
- `restoreRecord(pool, { id, confirmOverlap })`: a filled record runs `findOverlaps` on its saved employees and dates, excluding itself, and returns `{ ok: false, error: 'Overlapping records', overlaps }` unless `confirmOverlap`. A blank skips the check. Records page Restore shows the overlap dialog (`Restore anyway`, Cancel).
- [ ] Unit and US-9 E2E tests first, mutation check, commit.

## Test scope

```
Feature: Phase 3, US-8, US-9, US-10
Feature tests: unit and integration for listRecords, getRecord, updateRecord, archive/restore, ipc routes. E2E for US-8, US-9, US-10
Regression E2E: US-5, US-6, US-7, US-15 (records.js validateDetails/findOverlaps/getPrintable and NewRecord.jsx and its preview flow changed), US-1/3/4 via full run
System E2E: CW-1 (touches NewRecord and print)
Full E2E run: yes, business rule changed (overlap excludes the edited record) and Part one completes with this phase
```
