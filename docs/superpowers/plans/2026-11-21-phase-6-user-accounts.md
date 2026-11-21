# Phase 6 — User Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin adds users, resets passwords (temporary, changed at next login) and disables or re-enables accounts (US-2); only an admin can restore a backup (US-14 changed).

**Architecture:** A new `src/main/users.js` holds the user queries, reusing `hashPassword` and the US-1 password rule. `ipc.js` gains an `admin` access level (logged in, password changed, role `admin`) and ends a user's sessions when they are disabled or reset. A new Users page, shown in the menu to admins only; the Backup page hides Restore from encoders. No schema change: `users.role`, `users.active` and `users.must_change_password` exist since Phase 0.

**Tech Stack:** unchanged.

**Spec:** `spec.md` US-2 (Changed 2026-11-21), US-14 (Changed 2026-11-21), US-1. Conventions: `roadmap.md` Phases 0–9 and 5.

## Global Constraints

- Roles: `admin`, `encoder` (schema ENUM). Usernames are trimmed; required; unique (`Username already taken`). Full name required (`text()`).
- Password rule as US-1: at least 8 characters (`At least 8 characters`), reused from `auth.js`.
- A new or reset password sets `must_change_password = 1`; the US-1 change screen then appears at that user's next login.
- Disable or reset ends every open session of that user (`sessions` entries whose `user.id` matches).
- Refusals, exact: own account `You cannot disable your own account.`; last active admin `Keep at least one active admin.`; encoder on an admin route `Admins only`.
- Admin routes: `users:list`, `users:create`, `users:resetPassword`, `users:setActive`, `backup:pick`, `backup:restore`. `backup:create` stays `ready`.
- Copy, exact: menu and heading `Users`; buttons `Add user`, `Reset password`, `Disable`, `Enable`; disable confirm title `Disable <full name> (<username>)?`, message `They will not be able to log in, and any open session ends now. You can enable them again later.`, confirm `Disable`; enable confirm title `Enable <full name> (<username>)?`, message `They will be able to log in again.`, confirm `Enable`; reset dialog title `Reset the password of <full name>?` with a `Temporary password` field, confirm `Reset password`, success `Password reset. <username> must choose a new one at the next login.`

## Review Focus

1. An encoder calling `users:create` directly through `window.api` is refused (`Admins only`), not only hidden in the menu. Test in Task 2.
2. Disabling a user who is logged in on the same PC ends that session at once: their next call returns `Not logged in`. Test in Task 2.
3. Two admins: disabling one leaves one; disabling the remaining one is refused, also when it is a different admin than the actor. Test in Task 1.
4. A username with surrounding spaces or different case (`Encoder1` vs `encoder1`) counts as a duplicate (MySQL `utf8mb4_unicode_ci` compares case-insensitively). Test in Task 1.
5. A reset user logs in with the temporary password and lands on the change-password screen, not the app. Test in Task 4 (E2E).

---

### Task 0: Branch
- [ ] Branch `phase-6-user-accounts` (exists, with the spec change). Commit this plan as `docs: Phase 6 plan`.

### Task 1: User queries

**Files:** Create `src/main/users.js`, `tests/unit/users.test.js`. Modify `src/main/auth.js` (export the password rule as `passwordError(pw) → string | null`, used by `changePassword` and `users.js`).

**Interfaces:**
- `listUsers(pool)` → `{ ok, data: [{ id, username, fullName, role, active, mustChangePassword }] }` ordered by username.
- `createUser(pool, { username, fullName, role, password })` → `{ ok, data: { id } }` or field errors.
- `resetPassword(pool, { id, password })` → `{ ok, data: { id, username } }`, sets `must_change_password = 1`; `Account not found` for a missing id.
- `setActive(pool, { id, active }, { actorId })` → `{ ok, data: { id, active } }`; refuses own account and last active admin (when disabling).
- [ ] Tests first: create with each missing field and a 7-character password → field errors; role `boss` → `role: 'Choose admin or encoder'`; duplicate ` Encoder1 ` vs `encoder1` → `Username already taken`; created user logs in (`login`) with `mustChangePassword: true`; list order and fields (no password hash); reset → login with the new password has `mustChangePassword: true`, old password fails; disable → `login` returns null; enable → login works; disabling self refused; with admins A and B, A disables B → ok, A then cannot disable A (self), and a third call disabling the last active admin refused; `active` stays unchanged after a refusal.
- [ ] Mutation: drop the last-admin check → its test red. Commit `feat: user accounts (create, reset, disable)`.

### Task 2: Admin access level and IPC

**Files:** Modify `src/main/ipc.js`, `src/main/preload.cjs`, `tests/unit/ipc.test.js`.
- Access level `admin`: everything `ready` checks, then `user.role === 'admin'` else `{ ok: false, error: 'Admins only' }`.
- Routes: `users:list`, `users:create`, `users:resetPassword` (ends that user's sessions), `users:setActive` (passes `actorId`; disabling ends that user's sessions). `backup:pick` and `backup:restore` move to `admin`.
- [ ] Tests first: an encoder (created through `users:create`, then logged in and password changed) gets `Admins only` on all six admin routes and can still call `backup:create` and `records:list`; disable from sender 1 ends sender 2's session (`Not logged in`); reset ends it too; allowlist sync.
- [ ] Mutation: let `admin` routes through for encoders → red. Commit `feat: admin-only routes, user IPC`.

### Task 3: Users page, admin-only menu, Restore for admins

**Files:** Create `src/renderer/pages/Users.jsx`. Modify `src/renderer/App.jsx` (menu `Users` only when `user.role === 'admin'`, after Backup), `src/renderer/pages/Backup.jsx` (Restore section only for admins: page gets `user` from App).
- Users table: Username, Full name, Role, Status (`Active` / `Disabled`, `Must change password` note), actions `Reset password`, `Disable`/`Enable` (no Disable on your own row). States: loading, error + Retry, empty cannot happen (the admin is always listed).
- `Add user` form (same inline pattern as Employees): Username, Full name, Role (Encoder default / Admin), Temporary password; validation messages under fields; `Saving…`; double-submit guard; success banner `Added <username>. They must choose a new password at the first login.`
- Reset: ConfirmDialog with a `Temporary password` field and its error; disable/enable: ConfirmDialog with the exact copy; refusals shown in the dialog.
- [ ] Build, throwaway screenshots (Users list, add form with errors, disable confirm, encoder menu), look, delete. Commit `feat: Users page`.

### Task 4: E2E

**Files:** Create `tests/e2e/features/us-2-user-accounts.spec.js`. Modify `tests/e2e/features/us-14-restore.spec.js` (encoder sees no Restore; justified by US-14 Changed 2026-11-21).
- US-2: admin adds an encoder (fields, duplicate, short password); the encoder logs in in a second session (relaunch or log out/in) and must change the password; the encoder has no Users menu and `users:list` returns `Admins only`; admin resets the encoder's password → encoder must change it again; admin disables the encoder after the named confirmation (Cancel changes nothing) → encoder cannot log in; enable → can; admin cannot disable self (no button, and the route refuses) or the last active admin.
- [ ] Mutations: show Users to encoders → red; skip ending sessions on disable → red. Commit `test: E2E for US-2, US-14 admin-only restore`.

### Task 5: Package, verify, record
- [ ] Package, full E2E on the packaged exe (end of Part two), `npm test`, `pls_to` untouched, `docs/test-results/PHASE-6-TEST-RESULTS.md`, commit.

---

## Test scope

```
Feature: Phase 6, US-2 (changed), US-14 (changed)
Feature tests: unit for listUsers, createUser, resetPassword, setActive, passwordError, admin access level, users:* routes. E2E for US-2, US-14
Regression E2E: US-1 (login, password change, sessions), US-13 (backup stays open to encoders), US-14 via full run
System E2E: CW-3 (restore by admin)
Full E2E run: yes, permission rule and session handling change, and Phase 6 completes Part two
```
