# Phase 0 — Test results

Date: 2026-11-20
Driver: Playwright `_electron` (1.65), against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe` (Electron 41.2.2) and against source.
Database: `pls_to_test` on local WAMP MySQL 5.7.26, dropped and recreated per test. `pls_to` not touched.

## Test scope as run

```
Feature: Phase 0, US-1, US-3
Feature tests: unit and integration (43, Vitest) for config, db, auth, directory, ipc. E2E for US-1, US-3
Regression E2E: none, no DONE phases
System E2E: none, CW-1..3 need Phase 1+ stories
Full E2E run: no (the Phase 0 E2E suite is the whole suite: 29/29, packaged app)
```

## US-1 Log in and log out — `tests/e2e/features/us-1-login.spec.js` — PASS 14/14

| Condition | Result |
|---|---|
| Valid login opens the dashboard | PASS |
| First run forces password change; short password → `At least 8 characters` | PASS |
| Mismatched confirmation → `Passwords do not match`, nothing saved | PASS |
| Wrong password → `Invalid username or password` | PASS |
| Unknown user → same message | PASS |
| Disabled account cannot log in | PASS |
| Passwords stored hashed (`scrypt$`, no plaintext) | PASS |
| Before password change, data calls refused | PASS |
| Logout ends the session; `employees:list` → `Not logged in` | PASS |
| No page without a session (reload after logout stays on login) | PASS |
| New password works, default no longer does | PASS |
| Double-click Sign in: one login, no error | PASS |
| MySQL unreachable → readable error page with config path | PASS |
| Window cannot be navigated away (dropped file) — review fix I-3 | PASS |

## US-3 Manage offices and employees — `tests/e2e/features/us-3-offices-employees.spec.js` — PASS 15/15

| Condition | Result |
|---|---|
| Add, edit, archive office | PASS |
| Add, edit, archive employee; Archived filter; restore | PASS |
| Archived employee leaves pick lists, row kept | PASS |
| Archived office leaves the employee office pick list | PASS |
| Search by name, filter by office | PASS |
| No match → `No employees found` (search `%` is literal) | PASS |
| Employment status = exactly the 5 values | PASS |
| Missing name / office → field messages, nothing saved | PASS |
| Missing office name → field message | PASS |
| Duplicate (`  juan dela cruz `) rejected | PASS |
| Archive Cancel changes nothing | PASS |
| Archive Escape changes nothing | PASS |
| Office with 2 active employees → `Move or archive its 2 employees first.` | PASS |
| `MARIA PEÑA` round-trips | PASS |
| Double-click Save → one row | PASS |

## Mutation checks (each went red, then restored)

- Logout keeps the session → 2 US-1 tests red.
- Office archive count check removed → US-3 block test red.
- DB error page removed → startup test red.
- Unit level: port parsing, `_test` guard, `verifyPassword`, LIKE escaping, archive count, password-change guard.

## Left behind

Nothing outside `pls_to_test`. Screenshots and traces only in git-ignored `/test-results/`.

## Review fixes (step 10), each RED → GREEN

- I-1 double spaces inside names → collapsed, counted as duplicate (`directory.test.js`).
- I-2 re-adding an archived employee/office → "…archived… Restore it instead." (`directory.test.js`).
- I-3 window navigation locked (`will-navigate`, `setWindowOpenHandler`). Without it the window navigated to `file:///C:/Windows/win.ini` with the session (`us-1-login.spec.js`).
- M-2 (re-graded Important) tables declare utf8mb4 so a pre-existing latin1 `pls_to` cannot store Ñ wrong (`db.test.js`).
