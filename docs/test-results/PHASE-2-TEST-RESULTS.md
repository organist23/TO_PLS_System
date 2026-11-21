# Phase 2 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe` (Electron 41.2.2). The OS save dialog and `shell.openPath` are stubbed at the OS boundary (`mockSaveDialog`, `mockOpenPath`).
Database: `pls_to_test` on local WAMP MySQL 5.7.26. `pls_to` not touched.

## Test scope as run

```
Feature: Phase 2, US-6, US-7 (+ US-5 purpose limit)
Feature tests: unit and integration (101, Vitest) incl. migrations, records.js (shared counter, blank, fill, purpose), print.js, ipc routes. E2E for US-6, US-7, US-5 purpose
Regression E2E: US-5 (createRecord moved onto the shared counter), US-4 (New record signatory selects), US-1 and US-3 — all via the full run
System E2E: CW-1 (US-1 → US-3 → US-4 → US-5 → US-6), first run
Full E2E run: yes, schema change (records.status, nullable date columns, schema_version) — 62/62
```

## US-6 Print a filled form as .xlsx — `tests/e2e/features/us-6-print.spec.js` — PASS 6/6

| Condition | Result |
|---|---|
| Print writes number, date, names (incl. Ñ), destination, range, departure/time, purpose, both signatories into the template; 1 image; fit to one A4 page | PASS |
| Empty vehicle and return keep the blank lines | PASS |
| Open file opens exactly the saved file | PASS |
| Cancelled dialog writes nothing, shows no path | PASS |
| Failed save shows the exact error, record unchanged | PASS |
| Archived record cannot be printed | PASS |

## US-7 Issue a numbered blank form — `tests/e2e/features/us-7-blank-forms.spec.js` — PASS 5/5

| Condition | Result |
|---|---|
| Confirmation names form and office; Cancel reserves nothing | PASS |
| Issue takes the next number; file has number and signatories only | PASS |
| Listed under Blank forms to fill with Fill in / Print again | PASS |
| Fill in: form, office, signatories locked as printed; number kept; status filled; list empties | PASS |
| Filling in applies the overlap warning | PASS |

## US-5 purpose limit — PASS 1/1. CW-1 — PASS 1/1.

## Regression

US-1 14/14, US-3 15/15, US-4 7/7, US-5 13/13 (part of the full run).

## Visual check (Excel render of all 4 templates, worst case)

Inputs: 5 employees, 122-char destination, 47-char vehicle, range `December 30, 2026 - January 2, 2027`, 360-char purpose, long recommending title.
First render found: the cross-year range cut by VEHICLE (3 templates); whitespace-only template cells blocking overflow on Mayor's TO (designation and time cut). Fixed (template cleanup, shrink-to-fit to min 8 pt). Second render: all 4 fit on the page with nothing cut.

## Mutation checks (each went red, then restored)

- Migration version ignored → migrate-twice test red.
- Fill overwriting form type → snapshot test red. Fill-mode radios enabled → US-7 E2E red.
- Swapped recommending name/title cells → print test red.
- Font set without copying the shared style → shrink test red.
- Last export path not stored → unit and US-6 E2E red.

## Test infrastructure

Intermittent 5-10 s timeouts (2 of 5 unit runs) traced to per-test `DROP/CREATE DATABASE`. The test database is now rebuilt once per file and emptied with `DELETE` between tests. 5/5 consecutive runs green afterwards.

## Left behind

Nothing outside `pls_to_test`. Temp .xlsx files from tests in the OS temp folder.
