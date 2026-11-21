# Phase 6 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe`.
Database: `pls_to_test` on local WAMP MySQL 5.7.26. `pls_to` not touched by any test: its rows (5 offices, 1 employee, 31 records, the last written 20:42 local with destination "manila") come from the user's own hand testing, and match no test fixture.

## Test scope as run

```
Feature: Phase 6, US-2 (changed), US-14 (changed: restore admin-only)
Feature tests: unit (201, Vitest) incl. listUsers, createUser, resetPassword, setActive (own account, last active admin, concurrent disable under a lock), passwordError, login trimming, admin access level, users:* routes, sessions ended on disable or reset. E2E for US-2 and the US-14 encoder condition
Regression E2E: US-1 (login, password change), US-13 (backup open to encoders), US-14 and CW-3 (restore by admin) via full run
System E2E: CW-1, CW-2, CW-3, CW-4
Full E2E run: yes, permission rule and session handling change, and Phase 6 completes Part two — 129/129
```

## US-2 Manage user accounts (admin) — `tests/e2e/features/us-2-user-accounts.spec.js` — PASS 5/5

| Condition | Result |
|---|---|
| Admin adds a user (username, full name, role, temporary password); required fields and the 8-character rule checked; a duplicate username (other case, spaces) refused | PASS |
| A new user must choose a password at the first login (US-1 screen) | PASS |
| An encoder has no Users menu, no Restore, and `users:list` / `backup:restore` return `Admins only` | PASS |
| A reset password is temporary: old password refused, new one leads to the change screen | PASS |
| Disable after a confirmation naming the user; Cancel changes nothing (SQL); a disabled user cannot log in; Enable restores access | PASS |
| An admin cannot disable their own account (no button, route refuses) or the last active admin | PASS |

Unit only: every admin route refuses encoders and needs a changed password; disable and reset end every open session of that user; an admin cannot reset their own password through the route; usernames over 50 and names over 150 characters get field errors; two admins disabling each other at the same moment leave one active (proved with an uncommitted concurrent change); login trims the username as it was saved.

## US-14 Restore (changed) — PASS

An encoder does not see Restore and cannot call it (US-2 spec, encoder test; unit: `backup:pick` and `backup:restore` return `Admins only`). The admin restore paths (US-14 spec, CW-3) pass unchanged.

## Regression

All other specs pass in the full run (US-1, US-3 to US-18, CW-1 to CW-4). One earlier full run had a single `electron.launch` failure in a US-1 test this phase does not touch; it passed on rerun (14/14) and in the final run: an app-launch flake, not a code failure.

## Review

- `/code-review`: fixed the last-admin check racing a concurrent disable (now under a row lock), missing length errors for username and full name, self reset possible through the route, login not trimming the username, Enter not submitting the reset dialog, a misleading test comment. Not fixed: a disabled user's screen does not jump to Login on its own, because the app has one window and a disable can only target someone else's session (which the server ends); an 8-space password passes the US-1 rule (pre-existing rule, user's decision).
- `/security-review`: no findings with confidence 8 or above; role comes only from the server-side session.

## Mutation checks (each went red, then restored)

- No last-admin check; no own-account check → unit red. No row lock → concurrent-disable unit test red.
- Admin routes open to encoders → IPC unit red. Sessions kept on disable or reset → IPC unit red.
- Users menu shown to encoders; Restore shown to encoders → US-2 E2E red.

## Visual check

Screenshots of the Users page (active, must-change, disabled rows) and the reset dialog at 1280×800, looked at, then deleted.

## Left behind

`plsto-*` temp folders from test runs in `%TEMP%` (test data only). The installer was rebuilt (`dist/app/PLS-TO Records System Setup 1.0.0.exe`).
