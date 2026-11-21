# Phase 9 — Paper-First Encoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A record can only come into being as an issued blank form that HR then encodes (US-5 changed, CW-1 changed). The direct-input Save form and `records:create` are removed; the New record page becomes Forms.

**Architecture:** Delete `createRecord` and its IPC route; `issueBlanks` stays the only number assigner and `fillBlank` the only way details are saved. `NewRecord.jsx` shows the record form only in Fill in and Edit mode. Tests and E2E seeds create records the real way: issue a blank, then fill it.

**Tech Stack:** unchanged.

**Spec:** `spec.md` US-5 (Changed 2026-11-21: paper first), CW-1. Conventions: `roadmap.md` Phases 0–8.

## Global Constraints

- No code path creates a record except `issueBlanks` (US-16) followed by `fillBlank` (US-7/US-17).
- `records:create` is removed from `ROUTES` and the preload allowlist; a renderer call throws `Channel not allowed: records:create`.
- Menu label and page heading: `Forms`. Internal page key `newRecord` stays (Records uses `go('newRecord', …)`).
- Every US-5 condition keeps an assertion, now through Fill in: required fields, 1 to 5 employees, 6th employee refused, return before departure, end before start, 360-character purpose, archived employee or signatory not pickable, overlap warning with Save anyway / Cancel, double-click saves once, number per counter and month.
- Changing an existing assertion needs the US-5 or CW-1 `Changed` line of 2026-11-21. "Nothing saved" now reads "the blank stays blank" (the number already exists since the blank was issued).

## Review Focus

1. Edit (US-8) still opens the record form with Save: only the new-record mode is removed. Test in Task 3 (US-8 spec unchanged and green).
2. Records → Fill in (params mode) still shows the form. Test in Task 3 (CW-2 unchanged and green).
3. The Forms page with no blanks waiting shows Print blank forms and Encode, and no Employee picker or Save. Test in Task 3 (US-5 spec).
4. The overlap warning on Fill in names the other record's number and dates exactly as US-5 says. Test in Task 3 (US-5 spec).

---

### Task 0: Branch
- [ ] `git checkout -b phase-9-paper-first`. Commit this plan as `docs: Phase 9 plan`.

### Task 1: Remove direct create (main process) and move unit tests onto issue + fill

**Files:** Modify `src/main/records.js`, `src/main/ipc.js`, `src/main/preload.cjs`, `tests/unit/records.test.js`, `tests/unit/reports.test.js`, `tests/unit/db.test.js`, `tests/unit/ipc.test.js`.

- `records.js`: delete `createRecord`. `issueBlanks`, `fillBlank`, `withCounter` unchanged.
- Unit fixture: `create(over, now)` in `records.test.js` becomes issue a blank with `over`'s form, office and signatories at `now`, then `fillBlank` with the details, returning the fill result with the blank's number (`{ ok, data: { id, number, formType } }`, or the fill's errors and overlaps). Same shape for `reports.test.js` and the v1 migration seed in `db.test.js` (it may insert by SQL).
- Tests whose subject was `createRecord` validation move onto `fillBlank`, with every assertion kept; "nothing saved" checks become "status still blank, no `record_employees`". The two counter tests on `createRecord` (4 counters, concurrent saves) re-point to `issueBlanks`.
- `ipc.test.js`: `records:create` is not a handler and not in the allowlist; the old create round trip becomes issue + fill.
- [ ] Mutation: put `records:create` back into the allowlist → allowlist test red. Commit `feat: records are created only from issued blanks`.

### Task 2: Forms page

**Files:** Modify `src/renderer/App.jsx` (label `Forms`), `src/renderer/pages/NewRecord.jsx`.
- Heading `Forms` when not filling or editing. The record form renders only when `filling` or `editing`; its Form/Issuing office radios stay (disabled there). Remove the create branch from `submit` and the Save-result `saved`/Print row that only a new record used (Print stays after issuing blanks).
- [ ] Build, screenshot the empty Forms page and a Fill in, look, delete. Commit `feat: Forms page, no direct input`.

### Task 3: E2E

**Files:** Modify `tests/e2e/helpers.js` (`seedRecord` = issue + fill via IPC, same return `{ id, number }`; `encodeViaForms(page, { … })` helper that issues one blank in Print blank forms and fills it through Encode), every spec that navigates `New record` (→ `Forms`), `us-4` (seed via `seedRecord`), `us-5` (rewritten around Encode, one test per US-5 condition, plus: no Save-only form on Forms; `records:create` not allowed), `us-6`, `us-7` (Print again test), `us-15` (records made through `encodeViaForms`), `cw-1` (US-1 → US-3 → US-4 → US-16 → US-17 → US-6).
- [ ] Mutations: show the record form on Forms when idle → US-5 "no direct input" red; skip the overlap check in `fillBlank` → US-5 overlap red. Commit `test: paper-first E2E`.

### Task 4: Package, verify, record
- [ ] Package, full E2E on the packaged exe, `npm test`, `pls_to` untouched, `docs/test-results/PHASE-9-TEST-RESULTS.md`, commit.

---

## Test scope

```
Feature: Phase 9, US-5 (changed), CW-1 (changed)
Feature tests: unit for issue + fill as the only create path, records:create refused. E2E for US-5 through Encode
Regression E2E: every spec (New record → Forms rename and seed helper change touch all of them)
System E2E: CW-1 (changed), CW-2, CW-4
Full E2E run: yes, business rule (no direct create) and an IPC route removed
```
