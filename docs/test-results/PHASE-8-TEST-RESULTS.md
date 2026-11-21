# Phase 8 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe`. OS save dialog and shell stubbed at the OS boundary. Excel 2016 (COM) for the print renders.
Database: `pls_to_test` on local WAMP MySQL 5.7.26. `pls_to` not touched (records and employees never updated, users last updated 2026-11-20).

## Test scope as run

```
Feature: Phase 8, US-16, US-17, US-18 (US-7, US-9 changed)
Feature tests: unit (168, Vitest) incl. buildStackWorkbook (4 templates), migration v3, issueBlanks, nextNumbers, Department Head at Fill in, findBlank, unusedBlankMonths, deleteUnusedBlanks, records:* routes. E2E for US-16, US-17, US-18
Regression E2E: US-7 (changed), US-15, CW-2 (expectations follow the US-7 change), US-6, US-8, US-9, US-10, US-11, US-12, CW-1 via full run
System E2E: CW-4 (first run), CW-2, CW-1
Full E2E run: yes, schema migration v3 and a business-rule change (permanent delete) — 116/116
```

## US-16 Print a stack of blank forms — `tests/e2e/features/us-16-blank-stack.spec.js` — PASS 4/4

| Condition | Result |
|---|---|
| Confirmation names count, number range and the chosen signatories (an Acting approver) before reserving; Cancel reserves nothing (SQL); Mayor stack notes the Department Head is not printed | PASS |
| 5 blanks → consecutive numbers, one .xlsx with 5 sheets, each its own number, logo, empty DEPARTMENT HEAD line, chosen approver; preview says "The file has 5 forms." | PASS |
| 0 and 51 refused before the confirmation opens; nothing reserved | PASS |
| SB stack prints the SB Secretary and the Vice Mayor | PASS |

Unit only: concurrent stacks and a new record never share a number; counts 2.5, 'x', '' refused; SB stack without a recommending signatory refused; records:print with an archived id or more than 50 ids refused before any dialog; duplicate ids printed once.

## US-17 Encode a returned form by its number — `tests/e2e/features/us-17-encode-by-number.spec.js` — PASS 6/6

| Condition | Result |
|---|---|
| The number opens Fill in; PLS and TO with the same number are told apart; spaces ignored | PASS |
| Fill in links the employees on the paper (office saved) and the Department Head who signed | PASS |
| Unknown number: "No blank form has this number. Check the number on the paper." | PASS |
| Encoded number: "<number> is already encoded." with Open to the record | PASS |
| Voided number: "<number> was voided." | PASS |
| The Blank forms to fill list still works | PASS |

Unit only: `sb2026-11-1` and `2026-11-03` find their blanks; the month part is never rewritten.

## US-18 Delete unused blanks of a past month — `tests/e2e/features/us-18-delete-unused-blanks.spec.js` — PASS 3/3

| Condition | Result |
|---|---|
| A past month shows "Delete 2 unused blanks of <Month YYYY>" (one voided); no button for the current month | PASS |
| Confirmation names month and count and that it cannot be undone; Cancel deletes nothing (SQL) | PASS |
| Delete removes that month's unused blanks only; the filled record of that month and the current month's blank stay | PASS |

Past-month blanks are set up by SQL (the app numbers only in the current month). Unit only: current, future and malformed periods refused; a blank filled before the delete is kept; the current month keeps counting after a delete.

## CW-4 Blank stack lifecycle — `tests/e2e/system/cw-4-blank-stack-lifecycle.spec.js` — PASS 1/1

Issue 3 (US-16) → encode the middle number with today's dates (US-17) → Out today shows it (US-11) → the two unused move to last month → deleted (US-18); only the encoded record remains.

## US-7 change (Mayor's Office blank)

US-7, US-15 and CW-2 expectations changed to the US-7 condition of 2026-11-21: the Mayor PLS blank keeps the empty line over `DEPARTMENT HEAD` (A31 empty, A32 `DEPARTMENT HEAD`), the Mayor TO blank keeps its empty space, and Fill in requires the Department Head who signed (stored and checked by SQL). No assertion was removed.

## Regression

US-1 14/14, US-3 15/15, US-4 7/7, US-5 13/13, US-6 6/6, US-8 7/7, US-9 6/6, US-10 6/6, US-11 4/4, US-12 8/8, US-15 7/7, CW-1, CW-2 pass (full run).

## Excel render

3-form and 50-form stacks of all 4 templates opened in Excel 2016: every sheet selected (a plain Print prints all), and the first and last sheet rendered through Excel and checked by eye: logo, own number, merged titles and signatories, empty Department Head on Mayor PLS, empty space on Mayor TO. Found and fixed during the spike: copied sheets lost their merged cells; the template's saved active tab (30-sheet original) made Excel select one sheet only. 50 forms build in 1.7 s, 0.5 MB.

## Review

- `/ponytail-review`: jszip used by a test but undeclared, fixed (devDependency). Not done: removing the test-only `issueBlank` wrapper.
- `/code-review`: fixed a confirmation range that did not match an invalid count (now refused before the dialog), a stale estimate replacing a newer one, duplicate print ids, no hint that the Recommending select is not printed on Mayor blanks, zero-padded numbers not found, `nextNumbers` without a payload throwing. Not done: one repeated label string.
- `/security-review`: no findings with confidence 8 or above.

## Mutation checks (each went red, then restored)

- Stack without re-applied merges, without the active-tab reset, without the Department Head guard → print tests red.
- Mayor blank requiring a recommending signatory; Fill in without the Department Head check → records tests red.
- Delete without the past-month guard; without the status filter; lookup ignoring form type; without zero stripping → records tests red.
- records:print without the 50 cap → IPC test red.
- Confirmation without the approver line → US-16 red. Lookup ignoring form type → US-17 red. Current month listed as deletable → US-18 red.

## Left behind

Nothing. The installer was rebuilt (`dist/app/PLS-TO Records System Setup 1.0.0.exe`).
