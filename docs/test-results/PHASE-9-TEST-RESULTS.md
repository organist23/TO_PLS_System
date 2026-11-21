# Phase 9 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe`. OS save dialog and shell stubbed at the OS boundary.
Database: `pls_to_test` on local WAMP MySQL 5.7.26. `pls_to` not touched (records and employees never updated, users last updated 2026-11-20).

## Test scope as run

```
Feature: Phase 9, US-5 (changed: paper first), CW-1 (changed), US-7 (changed: Department Head pre-filled)
Feature tests: unit (169, Vitest): records created only by issueBlanks + fillBlank, records:create not a route and not in the allowlist. E2E for US-5 through Encode
Regression E2E: every spec (Forms rename and the paper-first seed helper touch all of them)
System E2E: CW-1 (changed), CW-2, CW-4
Full E2E run: yes, business rule (no direct create) and an IPC route removed — 117/117
```

## US-5 Create a PLS or TO record (paper first) — `tests/e2e/features/us-5-create-record.spec.js` — PASS 15/15

| Condition | Result |
|---|---|
| No direct input: Forms has no record form, Employee picker or Save until a returned blank is opened; `records:create` → "Channel not allowed" | PASS |
| Numbers per form type and office in the current month (set when issued), kept when encoded | PASS |
| Signatories pre-fill from the office defaults and switch with the office (Print blank forms) | PASS |
| A signatory can be changed for one record (approver at issue, Department Head at encode) | PASS |
| A 6th employee cannot be added | PASS |
| Missing required fields show messages (incl. Department Head when cleared); nothing filled | PASS |
| Return before departure rejected | PASS |
| Inclusive end before start rejected | PASS |
| Vehicle and return may be empty | PASS |
| Double-clicking Save encodes once (one filled record, one employee row) | PASS |
| Date filed editable; number month unchanged | PASS |
| Employee details kept as at save time | PASS |
| Purpose over 360 characters rejected | PASS |
| Overlap warning names the other record; Cancel saves nothing; Save anyway saves under the blank's own number | PASS |
| Empty pick lists: hints in Print blank forms and, once a blank is encoded, in the record form (employees, Department Head) | PASS |

## CW-1 Issue and print a record — PASS 1/1

US-1 → US-3 (office, employee) → US-4 (signatories, defaults) → US-16 (default approver in Print blank forms, blank issued) → US-17 (encoded by its number; the US-4 Department Head default pre-filled) → US-6 (printed .xlsx holds the number, employee and both signatories).

## Regression

All other specs pass (US-1, US-3, US-4, US-6 to US-12, US-15 to US-18, CW-2, CW-4) in the full run. Specs that made records through the removed Save form now make them paper first (`seedRecord` = issue + fill through IPC; `openReturnedBlank` = issue + Encode through the UI); no assertion was removed. Changed expectations cite US-5, US-7 or CW-1 `Changed` lines of 2026-11-21.

## Review

- `/code-review`: fixed a test helper that always looked up PLS, dead record-form code (defaults effect, stale comment, unguarded fallback). Two findings went to the user: the unused Mayor's Office recommending default (decision: pre-fill the Department Head on Fill in, US-7 changed) and no "encoded by" (decision: not needed).
- `/security-review`: no findings with confidence 8 or above; `issueBlanks` is the only insert into `records`, and only `fillBlank` sets `filled`.
- Not run: `/ponytail-review` (the change mostly deletes code).

## Mutation checks (each went red, then restored)

- `records:create` back in the preload allowlist → 2 IPC tests red.
- Record form shown on Forms when idle → US-5 "no direct input" red.
- Fill in without the overlap check → US-5 overlap red.

## Visual check

Screenshot of the Forms page at 1280×900, looked at, then deleted.

## Left behind

Nothing. The installer was rebuilt (`dist/app/PLS-TO Records System Setup 1.0.0.exe`).
