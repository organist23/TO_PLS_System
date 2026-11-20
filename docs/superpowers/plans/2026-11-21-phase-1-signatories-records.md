# Phase 1 — Signatories and Record Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff maintain signatories with office defaults and create PLS/TO records that get the next number from 4 monthly counters (US-4, US-5).

**Architecture:** Same layering as Phase 0. Business rules live in new main-process modules `signatories.js` and `records.js`, are exposed through `ipc.js` ROUTES at the `ready` access level, and are used by two new React pages. Numbers come from `MAX(seq)+1` inside a transaction with `FOR UPDATE` and a unique key as a backstop. There is no counters table, so a restored backup (US-14) can never reissue a number.

**Tech Stack:** unchanged from Phase 0 (Electron 41.2.2, React, Tailwind v4, mysql2, Vitest, Playwright `_electron`).

**Spec:** `spec.md` US-4, US-5 (both `Changed 2026-11-21`). Roadmap: Phase 1. Conventions: `roadmap.md` Phase 0 "Conventions later phases inherit".

## Global Constraints

- Phase 0 conventions hold. IPC result shape `{ ok, data } | { ok: false, error, errors? }`. A new channel goes in ROUTES and the `preload.cjs` allowlist. Text goes through `text()` (trim, collapse spaces). Removal means archive. Tables declare `utf8mb4_unicode_ci`. New tables only, no ALTER.
- Codes: form type `PLS` | `TO`. Issuing office `MAYOR` (label "Mayor's Office") | `SB` (label "Sangguniang Bayan"). Signatory role `recommending` | `approving`.
- Number: `<period>-<seq>` for MAYOR, `SB <period>-<seq>` for SB. `period` = `YYYY-MM` of the creation time in local time (`2026-11`, `2026-01`). `seq` starts at 1 per (form type, office, period). Examples: `2026-11-1`, `SB 2026-11-1`.
- Required on a record: form type, issuing office, date filed, 1–5 distinct active employees, destination, inclusive from/to, departure date+time, purpose, recommending and approving signatories (active, matching role). Optional: vehicle, return date+time.
- Copy, exact. Field errors: `Required`. `employees`: `Add at least one employee` / `At most 5 employees` / `Remove duplicate employees` / `Choose active employees`. `inclusiveTo`: `End date is before start date`. `returnAt`: `Return is before departure`. Signatory fields: `Choose an active recommending signatory` / `Choose an active approving signatory`. Default-archive block: `It is the default for <Mayor's Office|Sangguniang Bayan>. Choose another default first.` Success: `Saved <PLS|TO> <number>`.
- A record stores snapshots: each employee's `full_name`, `designation`, `employment_status`, `office_id` and each signatory's `name` and `title`, as they were at save time.

## Review Focus

1. Two saves in the same millisecond for one counter (double-click, or two quick Enter presses) never share a number. Test in Task 3 (`Promise.all` of 2 creates).
2. Month boundary: a record created at 2026-11-30 23:59 local gets `2026-11`, and one at 2026-12-01 00:00 gets `2026-12-1`. Test in Task 3 with an injected clock.
3. A signatory or employee archived between opening the form and saving is refused at save. Test in Task 3.
4. A tampered payload (6 employee ids, a recommending id used as approver, an unknown form type) is refused by the main process, not just the UI. Test in Task 3.
5. Editing a signatory or employee after saving does not change the saved record's snapshot. Test in Task 3.

---

## File Structure

```
src/main/schema.sql            + signatories, signatory_defaults, records, record_employees
src/main/signatories.js        list/create/update/archive/restore, getDefaults, setDefault
src/main/records.js            createRecord, formatNumber
src/main/ipc.js                + routes
src/main/preload.cjs           + allowlist
src/renderer/App.jsx           + nav: New record, Signatories
src/renderer/pages/Signatories.jsx
src/renderer/pages/NewRecord.jsx
tests/unit/signatories.test.js, records.test.js (+ db.test.js, ipc.test.js updates)
tests/e2e/features/us-4-signatories.spec.js, us-5-create-record.spec.js
```

---

### Task 0: Branch

- [ ] `git checkout -b phase-1-signatories-records`. Commit `spec.md` and this plan as `docs: Phase 1 spec changes and plan`.

### Task 1: Schema

**Files:** Modify `src/main/schema.sql`, `tests/unit/db.test.js`.

Append (exact):

```sql
CREATE TABLE IF NOT EXISTS signatories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  title VARCHAR(150) NOT NULL,
  role ENUM('recommending','approving') NOT NULL,
  archived_at DATETIME NULL,
  UNIQUE KEY uq_signatory (name, title, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS signatory_defaults (
  issuing_office ENUM('MAYOR','SB') NOT NULL,
  role ENUM('recommending','approving') NOT NULL,
  signatory_id INT NOT NULL,
  PRIMARY KEY (issuing_office, role),
  CONSTRAINT fk_default_signatory FOREIGN KEY (signatory_id) REFERENCES signatories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  form_type ENUM('PLS','TO') NOT NULL,
  issuing_office ENUM('MAYOR','SB') NOT NULL,
  period CHAR(7) NOT NULL,
  seq INT NOT NULL,
  number VARCHAR(30) NOT NULL,
  date_filed DATE NOT NULL,
  destination VARCHAR(255) NOT NULL,
  vehicle VARCHAR(150) NOT NULL DEFAULT '',
  inclusive_from DATE NOT NULL,
  inclusive_to DATE NOT NULL,
  departure_at DATETIME NOT NULL,
  return_at DATETIME NULL,
  purpose TEXT NOT NULL,
  recommending_id INT NOT NULL,
  recommending_name VARCHAR(150) NOT NULL,
  recommending_title VARCHAR(150) NOT NULL,
  approving_id INT NOT NULL,
  approving_name VARCHAR(150) NOT NULL,
  approving_title VARCHAR(150) NOT NULL,
  archived_at DATETIME NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_record_counter (form_type, issuing_office, period, seq),
  CONSTRAINT fk_record_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_record_rec FOREIGN KEY (recommending_id) REFERENCES signatories(id),
  CONSTRAINT fk_record_appr FOREIGN KEY (approving_id) REFERENCES signatories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS record_employees (
  record_id INT NOT NULL,
  position TINYINT NOT NULL,
  employee_id INT NOT NULL,
  office_id INT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  designation VARCHAR(150) NOT NULL,
  employment_status VARCHAR(20) NOT NULL,
  PRIMARY KEY (record_id, position),
  UNIQUE KEY uq_record_employee (record_id, employee_id),
  CONSTRAINT fk_re_record FOREIGN KEY (record_id) REFERENCES records(id),
  CONSTRAINT fk_re_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_re_office FOREIGN KEY (office_id) REFERENCES offices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 1:** Update `db.test.js`. `freshTestDb creates the tables` expects `['employees','offices','record_employees','records','signatories','signatory_defaults','users']`. The latin1 test expects 7 × `utf8mb4_unicode_ci`.
- [ ] **Step 2:** `npx vitest run tests/unit/db.test.js` → FAIL (4 tables missing).
- [ ] **Step 3:** Append the SQL.
- [ ] **Step 4:** Run → PASS. Then run `npm test` → all green, which shows migrating an existing Phase 0 database works (CREATE IF NOT EXISTS).
- [ ] **Step 5:** Commit `feat: schema for signatories and records`.

### Task 2: Signatories logic

**Files:** Create `src/main/signatories.js`, `tests/unit/signatories.test.js`.

**Interfaces:**
- Produces `ISSUING_OFFICES = { MAYOR: "Mayor's Office", SB: 'Sangguniang Bayan' }` and `ROLES = ['recommending','approving']`.
- `listSignatories(pool, { archived = false, role = null })` → `data: [{ id, name, title, role, archivedAt }]`, ordered by role, then name.
- `createSignatory(pool, { name, title, role })` and `updateSignatory(pool, { id, name, title, role })`. Errors: `name: 'Required'`, `title: 'Required'`, `role: 'Choose a role'`. A duplicate (name + title + role) gives `name: 'This signatory already exists'`, or `'This signatory is archived. Restore it instead.'` when the existing row is archived. Changing the role of a signatory that is a default gives `error: 'It is the default for <label>. Choose another default first.'`.
- `archiveSignatory(pool, { id })` is blocked with that same default message (the first matching office label). `restoreSignatory(pool, { id })`.
- `getDefaults(pool)` → `data: { MAYOR: { recommending: id|null, approving: id|null }, SB: {...} }`.
- `setDefault(pool, { issuingOffice, role, signatoryId })`. It rejects an unknown office or role (`error: 'Invalid default'`). A missing, archived, or wrong-role signatory gives `errors.signatoryId: 'Choose an active <role> signatory'`. Upsert with `INSERT ... ON DUPLICATE KEY UPDATE`.

- [ ] **Step 1: Failing tests:** name and title required (exact messages). Bad role. Duplicate active and duplicate archived messages. Update changes name and title. Archive and restore with the Archived filter. Archive blocked while default (`It is the default for Mayor's Office. Choose another default first.`). Role change blocked while default. `getDefaults` starts all-null, and `setDefault` then shows the ids. `setDefault` refuses wrong role, archived, or unknown office. `listSignatories({role:'approving'})` returns only approving signatories.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Import `text` from `directory.js` by exporting it there (one-word change: `export const text`).
- [ ] **Step 4:** Run → PASS. Mutation: remove the default-block check → its test red.
- [ ] **Step 5:** Commit `feat: signatories with office defaults`.

### Task 3: Record creation and numbering

**Files:** Create `src/main/records.js`, `tests/unit/records.test.js`.

**Interfaces:**
- Consumes Task 2 (`ISSUING_OFFICES`), Phase 0 employees.
- `formatNumber(issuingOffice, period, seq) -> string`: `'2026-11-1'` or `'SB 2026-11-1'`.
- `periodOf(date: Date) -> 'YYYY-MM'` (local time).
- `createRecord(pool, input, { userId, now = new Date() })` → `{ ok: true, data: { id, number, formType } }` or field errors per Global Constraints. `input = { formType, issuingOffice, dateFiled:'YYYY-MM-DD', employeeIds:number[], destination, vehicle, inclusiveFrom, inclusiveTo, departureAt:'YYYY-MM-DDTHH:mm', returnAt?:same|'' , purpose, recommendingId, approvingId }`. Unknown `formType` or `issuingOffice` gives `errors.formType` or `errors.issuingOffice` = `Required`. A date field that does not match `^\d{4}-\d{2}-\d{2}$` (and `T\d{2}:\d{2}` for date-times) gives `Required`.
- Algorithm (in one transaction on a pooled connection):
  1. Validate everything that does not need the counter, reading employees (`archived_at IS NULL`) and signatories (active, matching role). Collect all field errors and return them together.
  2. `SELECT COALESCE(MAX(seq),0)+1 AS next FROM records WHERE form_type=? AND issuing_office=? AND period=? FOR UPDATE`.
  2a. Overlap check, unless `input.confirmOverlap === true`. Find active records (`archived_at IS NULL`) that share any `employeeIds` and whose `inclusive_from <= input.inclusiveTo AND inclusive_to >= input.inclusiveFrom`. If any exist, roll back and return `{ ok: false, error: 'Overlapping records', overlaps: [{ employeeName, formType, number, inclusiveFrom, inclusiveTo }] }`, where `employeeName` is the current master-list name, ordered by employee then number.
  3. INSERT the record with snapshot columns, then `record_employees` rows with `position` 1..n in the given order.
  4. Commit. On any error, roll back and rethrow. Always release the connection.

- [ ] **Step 1: Failing tests** (helper `seed()` makes an office, 6 employees, 1 recommending and 1 approving signatory, and the admin user; `valid()` builds a full input):
  - `formatNumber`: MAYOR/2026-11/1 → `2026-11-1`, SB/2026-01/12 → `SB 2026-01-12`.
  - `periodOf` with `new Date(2026, 0, 5)` → `2026-01`.
  - First PLS MAYOR in Nov 2026 (`now = new Date(2026,10,20,9,0)`) → `2026-11-1`, second → `2026-11-2`. A TO in the same month → `2026-11-1`. An SB PLS → `SB 2026-11-1`.
  - Month boundary: `new Date(2026,10,30,23,59)` → `2026-11-3` after two earlier, then `new Date(2026,11,1,0,0)` → `2026-12-1`.
  - Concurrent: `Promise.all([create, create])` on one counter → numbers `2026-11-1` and `2026-11-2` (sorted).
  - Restore-safe: insert a record row with seq 7 directly via SQL (what a restored backup holds) → the next create on that counter gets `2026-11-8`.
  - Each missing required field gives `Required` on that field (destination, purpose, dateFiled, inclusiveFrom, inclusiveTo, departureAt, recommendingId, approvingId). Vehicle and returnAt empty → ok, stored `''` and NULL.
  - Employees: `[]` → `Add at least one employee`. 6 ids → `At most 5 employees`. `[a,a]` → `Remove duplicate employees`. An archived id → `Choose active employees`.
  - `inclusiveTo < inclusiveFrom` → `End date is before start date`. `returnAt < departureAt` → `Return is before departure`.
  - The approving id passed as `recommendingId` → `Choose an active recommending signatory`. An archived approving signatory → `Choose an active approving signatory`.
  - Snapshot: after save, rename the employee and the signatory. The record row and `record_employees` still hold the old values, in the given order.
  - Failed validation inserts nothing (`COUNT(*)` of records = 0).
  - Overlap: record A for employee e1 on 2026-11-20..22. New record with e1 on 2026-11-21..21 → `error: 'Overlapping records'`, `overlaps: [{ employeeName: <e1 name>, formType: 'PLS', number: '2026-11-1', inclusiveFrom: '2026-11-20', inclusiveTo: '2026-11-22' }]`, nothing inserted. Same input with `confirmOverlap: true` → saved as `2026-11-2`. Edge days count (new 2026-11-22..23 overlaps). Adjacent days do not (new 2026-11-23..24 saves without warning). A different employee does not. An archived record A (set via SQL) does not.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Mutations: drop `FOR UPDATE` → the concurrent test goes red (both read the same MAX, so the second insert hits `uq_record_counter`). Then change `periodOf` to UTC getters → the month-boundary test goes red (PH is UTC+8).
- [ ] **Step 5:** Commit `feat: create PLS/TO records with monthly numbering`.

### Task 4: IPC

**Files:** Modify `src/main/ipc.js`, `src/main/preload.cjs`, `tests/unit/ipc.test.js`.

- [ ] Add `ready` routes: `signatories:list|create|update|archive|restore|defaults|setDefault`, mapped to Task 2 (`defaults` → `getDefaults`). Add `records:create` → `createRecord(pool, p, { userId: user.id })`. Mirror them in the preload allowlist.
- [ ] Test first: `records:create` before the password change → `Change your password first`. After login, a valid create returns `data.number` matching `/^\d{4}-\d{2}-1$/` and `created_by` = the admin's id. The allowlist-sync test goes red until the preload is updated.
- [ ] Commit `feat: IPC for signatories and records`.

### Task 5: Signatories page

**Files:** Create `src/renderer/pages/Signatories.jsx`. Modify `App.jsx` (nav order: Employees, Offices, Signatories, New record. Landing stays Employees so Phase 0 E2E holds).

Follow `Offices.jsx` structure and states exactly (loading, error + Retry, `No signatories found`, Active/Archived toggle, inline form with field errors, `Saving…`, `Saved`, ConfirmDialog `Archive <name>?` showing the server error, Restore without confirm). Form fields: Name, Title, Role select (`Recommending`, `Approving`). Table columns: Name, Title, Role.

A "Defaults" section above the table has 4 labelled selects: `Mayor's Office — recommending`, `Mayor's Office — approving`, `Sangguniang Bayan — recommending`, `Sangguniang Bayan — approving`. Each lists active signatories of that role plus `Not set`. Changing a select calls `signatories:setDefault` at once, shows `Saved` or the error, is disabled while pending. Reload defaults after each change.

- [ ] Build, then run a throwaway Playwright smoke screenshot and look at it. Delete the smoke spec. Commit `feat: signatories page with office defaults`.

### Task 6: New record page

**Files:** Create `src/renderer/pages/NewRecord.jsx`.

- Form type and issuing office: two radio groups (`PLS`/`TO`; `Mayor's Office`/`Sangguniang Bayan`), default PLS / Mayor's Office.
- Date filed: `<input type="date">`, default today (local).
- Employees: a select of active employees labelled `<name> — <office>`, plus an `Add` button. The added list shows name, designation, status, and a `Remove` button. Add is disabled at 5, with the hint `At most 5 employees`. The list's error shows under it.
- Destination (input), Vehicle (input, label `Vehicle (optional)`), Inclusive from / to (date), Departure (`datetime-local`), Return (`datetime-local`, label `Return (optional)`), Purpose (textarea).
- Recommending / Approving selects list active signatories of each role, shown as `<name> — <title>`. They pre-fill from `signatories:defaults` for the chosen issuing office and re-fill when the office changes.
- Save: a `useRef` double-submit guard, `Saving…`, and field errors under each field (the plan's exact copy). When the result has `overlaps`, a warning dialog (reuse `ConfirmDialog` with a non-danger confirm style, or a `variant` prop if needed) is titled `Possible overlap`. It lists one line per overlap, `<employeeName> already has <formType> <number> on <inclusiveFrom> to <inclusiveTo>`, with the buttons `Cancel` (form unchanged) and `Save anyway` (resends with `confirmOverlap: true`). On success, a green banner `Saved PLS 2026-11-1` and the form resets, keeping form type, office, and the signatory defaults.
- Loading state while the pick lists load. An error banner with Retry if any of them fails.

- [ ] Build, smoke screenshot, look, delete the smoke spec. Commit `feat: new PLS/TO record page`.

### Task 7: E2E (step 8)

**Files:** Create `tests/e2e/features/us-4-signatories.spec.js`, `tests/e2e/features/us-5-create-record.spec.js`. Read `.claude/skills/e2e-testing/SKILL.md` first.

- US-4, one test per condition: add with name, title, and role. Name and title required. Set all 4 defaults (SQL-verified). The archive of a default is blocked with the exact message. Archive Cancel changes nothing. Archive, then Archived filter, then Restore. An archived signatory is absent from the New record selects. A record created, then the signatory edited, still shows the old snapshot (SQL).
- US-5, one test per condition, with expected numbers hand-derived from today's local month (`YYYY-MM` computed in the test from `new Date()`, which is the test's clock, not the app's): the first MAYOR PLS → `<ym>-1`, the second → `<ym>-2`, a TO → `<ym>-1`, an SB PLS → `SB <ym>-1`. Defaults pre-fill and switch with the office. The 6th employee cannot be added. Required-field messages appear. Return before departure, and end before start, are rejected. Vehicle and return empty save fine. Double-clicking Save creates 1 row (SQL). Date filed is editable and the number month is unchanged. Overlap: the warning lists the exact line, Cancel saves nothing (SQL count), and Save anyway saves with the next number.
- Regression: the schema changed, so run the **full** E2E suite (Phase 0 US-1 and US-3 included).
- [ ] Mutation per spec (e.g. skip the default pre-fill → US-5 test red). Commit `test: E2E for US-4 and US-5`.

### Task 8: Package, verify, record

- [ ] `npm run build && npx electron-builder --win dir`, then `E2E_EXE=... npx playwright test` → all green. `npm test` → all green.
- [ ] Write `docs/test-results/PHASE-1-TEST-RESULTS.md` (same layout as Phase 0). Commit `docs: Phase 1 test results`.

---

## Test scope

```
Feature: Phase 1, US-4, US-5
Feature tests: unit and integration for signatories.js, records.js, ipc routes, schema. E2E for US-4, US-5
Regression E2E: US-1, US-3 (Phase 0) — App.jsx nav, ipc.js ROUTES, preload allowlist and directory.js (text export) changed
System E2E: none, CW-1 needs US-6 (Phase 2)
Full E2E run: yes, schema change (4 new tables)
```
