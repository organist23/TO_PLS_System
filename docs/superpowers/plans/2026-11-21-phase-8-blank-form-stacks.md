# Phase 8 — Blank Form Stacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR issues 1 to 50 numbered blanks in one step and prints them as one .xlsx (US-16), encodes a returned form by typing its number (US-17), and deletes a past month's unused blanks (US-18). A Mayor's Office blank leaves the Department Head line empty until it is filled (US-7 changed).

**Architecture:** `records.js` issues N blanks under the existing per-counter lock, finds a blank by form and number, and deletes past-month blanks. `print.js` builds one workbook with one sheet per record from the filled template, every sheet selected so one Print prints all pages. `records:print` takes `ids`. Migration v3 makes `records.recommending_*` nullable. The UI stays on the New record page.

**Tech Stack:** unchanged (exceljs).

**Spec:** `spec.md` US-7 (changed), US-9 (changed), US-16, US-17, US-18, CW-4. Conventions: `roadmap.md` Phase 0–4 and 7.

## Global Constraints

- Numbers only from `withCounter` (one `GET_LOCK` per counter); a stack's numbers are consecutive and assigned in one lock and one transaction.
- The stack is the issuing office (Mayor's Office or SB). The employee's office comes from the employees chosen at Fill in.
- Mayor's Office blank: `recommending_id/name/title` are NULL until filled; the form prints an empty name line and the title `DEPARTMENT HEAD`. SB blank: both signatories required at issue. New record (US-5) is unchanged: it still requires both.
- Count: whole number 1 to 50, else `errors.count = 'Enter a number from 1 to 50'`.
- A number is unique only with its form type (PLS and TO keep separate counters), so lookup is by form type + number. The typed number is compared with spaces removed and `sb` in any case.
- Delete: only `status = 'blank'` rows (active or archived) of a period before the current local month. Current or future period → `{ ok: false, error: 'Only blanks of a past month can be deleted.' }`.
- Copy, exact:
  - Issue confirmation title: `Issue a blank <PLS|TO> for <Office>?` (count 1, as today) or `Issue <n> blank <PLS|TO> for <Office>?`; body lines `Numbers: <first> to <last>` (or `Number: <first>`), `Recommending approval: <name> — <title>` or `Recommending approval: Department Head (signs on the paper)`, `Approved by: <name> — <title>`, then `This reserves <the next number|<n> numbers>.`; confirm label `Issue blank` or `Issue <n> blanks`.
  - Success: `Issued blank <form> <number>` or `Issued <n> blank <form>: <first> to <last>`.
  - Preview note for a stack: `Showing <first>. The file has <n> forms.`
  - Lookup: `No blank form has this number. Check the number on the paper.`, `<number> is already encoded.` (+ `Open` link), `<number> was voided.`
  - Delete: button `Delete <n> unused blanks of <Month YYYY>`; confirm title `Delete <n> unused blanks of <Month YYYY>?`, message `Their numbers were never used. This cannot be undone.`, confirm label `Delete`; success `Deleted <n> unused blanks of <Month YYYY>`.

## Review Focus

1. `2026-11-5` exists as both PLS and TO: the lookup with form PLS opens the PLS blank, never the TO. Test in Task 3.
2. A blank of the current month is never deleted, even through a hand-built IPC call, so a deleted number cannot be issued again. Test in Task 3.
3. A blank filled between listing and deleting is not deleted (delete filters `status = 'blank'` at delete time). Test in Task 3.
4. Every page of a 50-form file keeps the logo, A4 fit and its own number; Excel's plain Print prints all pages. Check in Task 1 (by eye) and test sheet count, numbers, images and selection.
5. Editing a filled record that came from a Mayor's Office blank keeps the Department Head picked at Fill in (it is non-NULL after Fill in). Test in Task 2.

---

### Task 0: Branch
- [ ] `git checkout -b phase-8-blank-form-stacks`. Commit this plan as `docs: Phase 8 plan`.

### Task 1: Stack workbook and empty Department Head line (risk first)

**Files:** Modify `src/main/print.js`, `tests/unit/print.test.js`.

**Interfaces:**
- `fillWorkbook(record)`: when `recommending_name` is NULL, the recommending name cell is empty and the title cell is `DEPARTMENT HEAD` (Mayor templates only reach this).
- `buildStackWorkbook(records)` → `Buffer`: one sheet per record in the given order, sheet name = the record's number (`SB 2026-11-5` allowed), each a copy of that record's filled template sheet (merges, widths, heights, print setup, logo). Every sheet `views[0].tabSelected = true` so Excel opens them grouped and a plain Print prints all. `buildWorkbook(record)` = `buildStackWorkbook([record])`.
- [ ] Spike first: build 3-record stacks for all 4 templates into `scratchpad`, open each in Excel, Print Preview shows 3 A4 pages with logo, numbers and an empty Department Head line on Mayor blanks matching `examples/actual_files`. If grouped printing or the logo copy cannot be made to work, stop and report.
- [ ] Tests: a 3-record stack has 3 sheets named by number, each sheet's number cell holds its own number, each has 1 image and the template's print setup (A4, fit to 1 page), every sheet `tabSelected`; a Mayor PLS and Mayor TO blank with NULL recommending have an empty name cell and `DEPARTMENT HEAD` title; `buildWorkbook` output still matches the existing per-template tests.
- [ ] Mutation: drop `tabSelected` on sheets after the first → red. Commit `feat: stack workbook, empty Department Head line`.

### Task 2: Migration v3, issue N, Fill in picks the Department Head

**Files:** Modify `src/main/db.js`, `src/main/records.js`, `tests/unit/records.test.js`, `tests/unit/db.test.js`.

**Interfaces:**
- `MIGRATIONS` v3: `ALTER TABLE records MODIFY recommending_id INT NULL, MODIFY recommending_name VARCHAR(150) NULL, MODIFY recommending_title VARCHAR(150) NULL` (safe to re-run).
- `issueBlanks(pool, { formType, issuingOffice, recommendingId, approvingId, count }, { userId, now })` → `{ ok, data: { formType, ids: [..], numbers: [..] } }`. MAYOR: recommending ignored, stored NULL. SB: recommending required as today. `issueBlank` stays as `issueBlanks` with `count: 1`, returning `{ id, number, formType }` as before.
- `nextNumbers(pool, { formType, issuingOffice, count }, { now })` → `{ ok, data: { first, last } }` (read-only estimate for the confirmation).
- `fillBlank` input gains `recommendingId`: required and must be an active recommending signatory when the blank's `recommending_id` is NULL (stores its name and title); ignored otherwise.
- `listBlank` rows unchanged in shape (recommending fields may be NULL).
- [ ] Tests first: migration v3 applies and re-runs; `issueBlanks` count 3 → numbers `2026-11-1..3` consecutive, 3 rows, MAYOR rows have NULL recommending; count 0, 51, 2.5, 'x' → count error, nothing reserved; two concurrent `issueBlanks` of 5 plus one `createRecord` → 11 distinct consecutive numbers; SB without recommending → error; `nextNumbers` after 2 records → `2026-11-3`..`2026-11-5` for count 3; Mayor blank Fill in without `recommendingId` → `errors.recommendingId`, with an archived one → same error, with an active one → stored name and title; SB blank Fill in ignores a different `recommendingId`; edit (US-8) of a record filled from a Mayor blank keeps that Department Head.
- [ ] Mutations: store the Mayor recommending instead of NULL → red; skip the Fill in Department Head check → red. Commit `feat: issue blank stacks, Department Head at Fill in`.

### Task 3: Find by number, delete past months

**Files:** Modify `src/main/records.js`, `tests/unit/records.test.js`.

**Interfaces:**
- `findBlank(pool, { formType, number })` → `{ ok, data: <listBlank row + status, archived> }` or `{ ok: false, error: 'No blank form has this number. Check the number on the paper.' }`. Match `form_type = ?` and `REPLACE(UPPER(number), ' ', '') = <typed, spaces removed, upper>`.
- `unusedBlankMonths(pool, { now })` → `{ ok, data: [{ period, count }] }`, periods before `periodOf(now)`, newest first.
- `deleteUnusedBlanks(pool, { period }, { now })` → `{ ok, data: { period, deleted } }`; refuses current or future periods and malformed periods.
- [ ] Tests first: PLS and TO both `2026-11-1` → each form finds its own; `' 2026-11-1 '`, `sb2026-11-1` for an SB blank found; filled → `status: 'filled'`; archived → `archived: true`; unknown → exact error. Months: blanks in `2026-10` (2, one archived), `2026-11` (1) with now = Nov → `[{ period: '2026-10', count: 2 }]`; delete `2026-10` → 2 deleted, the October filled record kept; delete `2026-11` → refused, row kept; a blank filled before the delete call is kept; after deleting October, a new November record still gets the next November number.
- [ ] Mutation: drop the past-month guard → current-month test red. Commit `feat: find blanks by number, delete past-month unused blanks`.

### Task 4: IPC

**Files:** Modify `src/main/ipc.js`, `src/main/preload.cjs`, `tests/unit/ipc.test.js`.
- `records:issueBlank` → `issueBlanks` (count default 1; returns `{ formType, ids, numbers }`). New `ready` routes: `records:nextNumbers`, `records:findBlank`, `records:unusedBlanks`, `records:deleteUnusedBlanks` (passes `now`).
- `records:print` and `records:preview`: `records:print` accepts `{ ids }` (1 to 50, each via `getPrintable`, any refusal returns it) or `{ id }`; default name `<form> <number>.xlsx`, or `<form> <first> to <last>.xlsx` for a stack.
- [ ] Tests first: new routes refused before the password change; issue 3 then print `{ ids }` writes a file with 3 sheets; an archived id in `ids` → refusal and no dialog; allowlist sync. Commit `feat: IPC for blank stacks`.

### Task 5: New record page

**Files:** Modify `src/renderer/pages/NewRecord.jsx`, `src/renderer/components/PrintFlow.jsx`, `src/renderer/pages/Records.jsx`.
- Issue: a `How many` number input (1–50, default 1) beside `Issue blank form`. The form's Recommending select stays (New record needs it); for a Mayor's Office stack it is not sent, and the confirmation says the Department Head signs on the paper. Opening the confirmation calls `records:nextNumbers`; the dialog shows the exact copy above (loading text `Checking numbers…` while it loads). After issuing: success copy, then `print({ id: ids[0], number: numbers[0], formType, ids, count })`.
- `usePrint.print(rec)`: previews `rec.id`; when `rec.ids` has more than one, shows the stack note under the title; Save as Excel calls `records:print` with `{ ids }` or `{ id }`.
- Fill in of a blank with NULL recommending: a required `Recommending approval (Department Head who signed)` select (active recommending signatories, no default) in place of the printed recommending line; Approved by still shown as printed.
- `Encode a returned form` box above `Blank forms to fill`: `Form` select (PLS/TO), `Number on the returned form` input, `Find` button (Enter submits). Results per spec copy; a blank opens Fill in; `already encoded` has `Open` → `go('records', { openId })`.
- Delete: for each `records:unusedBlanks` month, a `Delete <n> unused blanks of <Month YYYY>` button (btn.danger) above the list; ConfirmDialog with the exact copy; success banner; reload both lists.
- Records detail and blank rows: NULL recommending shows `Department Head (signs on the paper)`.
- [ ] Build, throwaway screenshots (issue confirmation for 5, stack preview, Mayor Fill in, number box messages, delete confirm), look, delete. Commit `feat: blank stacks on New record`.

### Task 6: E2E (step 8)

**Files:** Create `tests/e2e/features/us-16-blank-stack.spec.js`, `us-17-encode-by-number.spec.js`, `us-18-delete-unused-blanks.spec.js`, `tests/e2e/system/cw-4-blank-stack-lifecycle.spec.js`. Modify `tests/e2e/features/us-7-blank-forms.spec.js` (Mayor blank: A31 empty and title `DEPARTMENT HEAD`; Fill in picks the Department Head; justified by US-7 `Changed` 2026-11-21) and `tests/e2e/system/cw-2-blank-lifecycle.spec.js` (Fill in picks the Department Head).
- US-16: confirmation shows count, range and signatories, Cancel reserves nothing (SQL); a changed Approved by (OIC) appears on every page; 5 blanks → one file with 5 sheets and consecutive numbers, read back; 0 and 51 refused; SB stack prints the SB Secretary.
- US-17: each message; PLS vs TO with the same number; Fill in links the employees (SQL `record_employees`, office saved); the list still works.
- US-18: past-month blanks are seeded by SQL (a blank row copied with `period`, `seq`, `number` set to last month: setup, not under test); button shows the count; Cancel keeps them; Delete removes them and an October filled record stays; no button for the current month.
- CW-4: issue 3 → encode the middle number → in Out today → move the other two to last month by SQL → delete them.
- [ ] Mutations: confirmation without signatories → US-16 red; lookup ignoring form type → US-17 red; delete without the past-month guard → US-18 red. Commit `test: E2E for US-16, US-17, US-18, CW-4`.

### Task 7: Package, verify, record
- [ ] Package, full E2E on the packaged exe, `npm test`, open a 50-form stack of each template in Excel and print-preview it, check `pls_to` untouched, write `docs/test-results/PHASE-8-TEST-RESULTS.md`, commit.

---

## Test scope

```
Feature: Phase 8, US-16, US-17, US-18 (US-7, US-9 changed)
Feature tests: unit and integration for buildStackWorkbook, migration v3, issueBlanks, nextNumbers, fillBlank Department Head, findBlank, unusedBlankMonths, deleteUnusedBlanks, records:* routes. E2E for US-16, US-17, US-18
Regression E2E: US-7 (changed), US-6, US-15 (records:print/preview), US-8, US-9, US-10 (recommending may be NULL), US-11, US-12, CW-1, CW-2 — via full run
System E2E: CW-4 (first run), CW-2, CW-1
Full E2E run: yes, schema migration v3 and a business-rule change (permanent delete)
```
