# Phase 3 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe`. OS save dialog stubbed at the OS boundary.
Database: `pls_to_test` on local WAMP MySQL 5.7.26. `pls_to` not touched (records and employees never updated, users last updated 2026-11-20).

## Test scope as run

```
Feature: Phase 3, US-8, US-9, US-10
Feature tests: unit (127, Vitest) incl. listRecords, getRecord, updateRecord, archiveRecord, restoreRecord, records:* routes. E2E for US-8, US-9, US-10
Regression E2E: US-5, US-6, US-7, US-15, CW-1 (records.js validateDetails/findOverlaps/getPrintable, NewRecord.jsx and its print flow changed; no assertion changed)
System E2E: CW-1
Full E2E run: yes, business rule changed (overlap excludes the edited record) and Part one completes — 89/89 (rerun after review fixes and the US-9 amend)
```

## US-8 Edit a record — `tests/e2e/features/us-8-edit-record.spec.js` — PASS 7/7

| Condition | Result |
|---|---|
| Edited destination, purpose and an added employee show in the detail, the list and the next print (.xlsx cells A20, A24, A14-A15) | PASS |
| Form and issuing office radios disabled; number, form, office and status unchanged in SQL after save | PASS |
| Employee and signatory archived (and renamed) since are kept with their saved details; signatory shown as `(archived)`; switching to an active signatory takes its current name and title | PASS |
| Same validation as US-5 (required, 361-char purpose, no employees); nothing saved | PASS |
| Overlap ignores the record itself; warns for another record of an added employee; Cancel saves nothing; Save anyway saves | PASS |
| Blank Issued record offers Fill in, not Edit; Fill in opens with printed signatories; Cancel returns to the record; Save returns to the record, now Filled | PASS |
| Cancel leaves the record unchanged | PASS |

## US-9 Archive and restore a record — `tests/e2e/features/us-9-archive-record.spec.js` — PASS 6/6

| Condition | Result |
|---|---|
| Confirmation names the record number with the exact copy; Cancel changes nothing (SQL) | PASS |
| Archived record hidden from the default list; Archived filter shows it; archived detail offers only Restore; Restore returns it to Active | PASS |
| Restoring a filled record that now overlaps warns (Amend 2026-11-21); Cancel keeps it archived; Restore anyway restores | PASS |
| Archived number is never reused (next record gets `-2`) | PASS |
| Blank Issued form can be archived; its number stays reserved (next gets `-3`) | PASS |
| No delete control on list or detail; no delete channel in the preload allowlist | PASS |

## US-10 Browse, search, and filter records — `tests/e2e/features/us-10-browse-records.spec.js` — PASS 6/6

| Condition | Result |
|---|---|
| Columns number, form, office, names, destination, travel dates, status; newest first | PASS |
| Search by number, employee name (`peña` finds `MARIA PEÑA`), destination, purpose; `100%` matches literally | PASS |
| Filters: form type, issuing office, employee office, status (Active, Filled, Blank issued, Archived) | PASS |
| Travel date range overlaps inclusive dates; end before start shows `End date is before start date` | PASS |
| No results shows `No records found`, no table | PASS |
| Opening a record shows all details with Edit, Print, Archive; the Records nav item returns to the list | PASS |

Unit only: the 200-row limit with the "Showing the newest 200 records" flag (201 seeded rows), `%`, `_` and `'` searched literally, a blank never matches a date range, a tampered payload cannot change number/form/office/status, an edit of an archived, blank or missing record is refused, a non-numeric office filter is ignored, a blank restores without an overlap check.

## Regression

US-1 14/14, US-3 15/15, US-4 7/7, US-5 13/13, US-6 6/6, US-7 6/6, US-15 7/7, CW-1 1/1 (full run). No DONE phase skipped.

## Bug found and fixed

Pre-existing since Phase 2: New record holds two confirmation dialogs that both used `id="confirm-title"`, so the overlap dialog was announced with the Issue blank title. `ConfirmDialog` now takes its title id from `useId()`.

## Review

- `/ponytail-review`: offices load failure had no error state, fixed (Banner with Retry).
- `/code-review`: fixed fill from Records not returning to the record, a stale detail load replacing the list, the Records nav item not leaving a detail, and a non-numeric office filter reaching SQL as NaN. Not fixed: a stale snapshot across two concurrent edits of one record, because the app is one window on one PC. Restore skipping the overlap check went to the user, who decided Restore warns (spec.md US-9 Amend 2026-11-21).
- `/security-review`: no findings with confidence 8 or above.
- Not covered by a test: the stale-detail guard (timing race).

## Visual check

Throwaway screenshots of the list, detail, archive confirmation and edit form at 1280×800, looked at, then deleted.

## Mutation checks (each went red, then restored)

- Search without escaping → unit search test red.
- `updateRecord` without `excludeId` → self-overlap unit test red (and 3 others).
- `updateRecord` without `keep` → archived-since unit test red.
- `records:archive` at `loggedIn` instead of `ready` → IPC access test red.
- Archive Cancel calls archive → US-9 Cancel E2E red.
- Default status filter `filled` instead of `active` → US-10 list E2E red.
- Edit form without the saved signatory option → US-8 archived-since E2E red.
- Restore without the overlap check → restore unit test and US-9 E2E red.
- Review fixes checked against the pre-fix code: fill-from-Records return, nav reset and office filter tests red, then green.

## Left behind

Nothing. The installer was rebuilt (`dist/app/PLS-TO Records System Setup 1.0.0.exe`).
