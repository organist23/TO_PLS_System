# Phase 4 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe`. OS save dialog and shell stubbed at the OS boundary.
Database: `pls_to_test` on local WAMP MySQL 5.7.26. `pls_to` not touched (records, employees and offices never updated, users last updated 2026-11-20).

## Test scope as run

```
Feature: Phase 4, US-11, US-12
Feature tests: unit (143, Vitest) incl. outOn, officeReport, reportFile, reports:* routes, saveExport via records:print and reports:export. E2E for US-11, US-12
Regression E2E: US-1 (landing page is now Out today: 3 assertions changed Employees → Out today, per US-1 "opens the dashboard"), US-6, US-7, US-15, CW-1 (records:print moved onto saveExport, no assertion changed)
System E2E: CW-2 (first run), CW-1
Full E2E run: yes, App.jsx and the records:print route are in the "Shipped as" of several phases — 102/102
```

## US-11 See who is out today — `tests/e2e/features/us-11-out-today.spec.js` — PASS 4/4

| Condition | Result |
|---|---|
| After login the dashboard (Out today) lists every employee on an active Filled record whose inclusive dates include today, with office, form type, number, destination, travel dates and return time (`—` when none) | PASS |
| Archived and Blank issued records do not appear | PASS |
| Staff can pick another date (2 days ahead, tomorrow, a date with nobody: `No one is out on this date`) | PASS |
| The list filters by office | PASS |

Unit only: first, middle and last day of a 3-day record and not the day before or after; saved names kept after an employee is renamed and archived and the office archived; invalid date → `Enter a valid date`.

## US-12 Per-office report and Excel export — `tests/e2e/features/us-12-office-report.spec.js` — PASS 8/8

| Condition | Result |
|---|---|
| Range defaults to the current month | PASS |
| Rows per employee and record, counts per office and form type; archived and blank excluded; out-of-range record excluded | PASS |
| Filters: form type, office, travel-date range (overlap) | PASS |
| An archived office can still be chosen (`RHU (archived)`) | PASS |
| Export waits until the rows on screen match the filters | PASS |
| End before start rejected (`End date is before start date`), no tables, Export disabled | PASS |
| Empty range shows `No records found`, Export disabled | PASS |
| Export writes the same rows and counts to .xlsx; Open file opens exactly that file | PASS |

Unit only: a record with two employees of one office counts once; text starting with `=` is written as text, not a formula; missing or invalid range → `Required` / `Enter a valid date`; cancelled dialog writes nothing; a bad range opens no dialog.

## CW-2 Blank form lifecycle — `tests/e2e/system/cw-2-blank-lifecycle.spec.js` — PASS 1/1

Issue blank (US-7) → not out today → fill in from Records with today's dates → out today with the same number (US-11) → edit dates to tomorrow (US-8) → gone today, present tomorrow.

## Regression

US-1 14/14, US-3 15/15, US-4 7/7, US-5 13/13, US-6 6/6, US-7 6/6, US-8 7/7, US-9 6/6, US-10 6/6, US-15 7/7, CW-1 1/1 (full run). No DONE phase skipped.

## Review

- `/ponytail-review`: office loading copied in three pages (nice to have). Folded into `useOffices` for the two new pages when code review needed archived offices there.
- `/code-review`: fixed Export saving the previous filters during the 250 ms debounce, archived offices missing from the report filters, and row keys that repeat for two same-name employees of different offices. Not fixed: the Out today date does not roll over at midnight on a page left open (a nav click reloads it); a hand-built `officeId` for no office labels an empty export `Office: All`.
- `/security-review`: no findings with confidence 8 or above.

## Visual check

Throwaway screenshots of Out today and Reports at 1280×800, looked at, then deleted.

## Mutation checks (each went red, then restored)

- Drop `archived_at IS NULL` → 5 unit tests red, and US-11 and US-12 archived E2E red.
- `inclusive_to > ?` instead of `>=` → last-day unit test red.
- `COUNT(r.id)` instead of `COUNT(DISTINCT r.id)` → count-once unit test red.
- Write `=` text as a formula → formula unit test red.
- Out today default date yesterday → US-11 landing E2E red.
- Export without the debounce guard → US-12 export-waits E2E red.
- Office filter without archived offices → US-12 archived-office E2E red.

## Left behind

Nothing. The installer was rebuilt (`dist/app/PLS-TO Records System Setup 1.0.0.exe`).
