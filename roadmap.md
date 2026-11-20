# Roadmap

## Part one — Encode and print PLS and TO forms

### Phase 0 — Login and employee master list ✅ DONE (merged `b1200a5`, 2026-11-20)

Proves the stack end to end (Electron, React + Tailwind, Node, local MySQL) with the smallest real outcome. Every later story needs a logged-in user and employees to pick.
Covers US-1, US-3.

- Staff log in and log out. First run creates the admin and forces a password change.
- Staff add, edit, archive, and search offices and employees.

**Done when:** in the packaged Electron app, the seeded admin changes the password, logs in, adds an office and an employee, archives the employee, and logs out. Pages refuse access after logout. Every US-1 and US-3 condition passes in E2E. — **Verified** on 2026-11-20 with Playwright `_electron` against the packaged `win-unpacked` exe, all US-1 and US-3 conditions plus DB-error page and navigation lock (29/29 E2E, 43/43 unit). Results: `docs/test-results/PHASE-0-TEST-RESULTS.md`. Regression: none, first phase.

Shipped as `src/main/auth.js`: `hashPassword`, `verifyPassword`, `ensureAdmin`, `login`, `changePassword`. `src/main/directory.js`: `listOffices`, `createOffice`, `updateOffice`, `archiveOffice`, `restoreOffice`, `listEmployees`, `createEmployee`, `updateEmployee`, `archiveEmployee`, `restoreEmployee`, `EMPLOYMENT_STATUSES`. `src/main/ipc.js`: `registerIpc`, `CHANNELS`. `src/main/db.js`: `createPool`, `migrate`. `src/main/config.js`: `loadConfig`. `src/main/main.js`, `src/main/preload.cjs`. `src/renderer/App.jsx`, `pages/Login.jsx`, `ChangePassword.jsx`, `Offices.jsx`, `Employees.jsx`, `DbError.jsx`, `components/ConfirmDialog.jsx`, `components/ui.jsx`. Tables: users, offices, employees.

Deliberately not built, and why: user management, because Phase 6 owns US-2. Records and numbering, because Phase 1 owns US-5.

Conventions later phases inherit: every IPC result is `{ ok, data }` or `{ ok: false, error, errors? }`. A new channel goes in `ipc.js` ROUTES with an access level (`public`, `loggedIn`, `ready`) and in the `preload.cjs` allowlist (a unit test checks they match). Text input is trimmed and inner spaces collapsed (`text()` in `directory.js`). Removal is archive (`archived_at`), never DELETE. Every table declares `utf8mb4_unicode_ci`. Schema changes are `CREATE TABLE IF NOT EXISTS` only, so the first phase that alters a table adds a `schema_version` table. Tests run only on a database ending in `_test`. Electron is pinned at 41.2.2.

### Phase 1 — Signatories and record creation with auto-numbering ✅ DONE (merged `183a13b`, 2026-11-21)

A record needs signatories and employees, and the numbering rule is the core business rule.
Covers US-4, US-5.

- Staff maintain signatories and office defaults.
- Staff create PLS and TO records for both offices with numbers from 4 monthly counters.

**Done when:** records created in two different months and for all 4 counters get the right numbers (`2026-11-1`, `SB 2026-11-1`, reset on a new month). A double-click on Save creates one record. — **Verified** on 2026-11-21 with Playwright `_electron` against the packaged `win-unpacked` exe: all US-4 and US-5 conditions incl. overlap warning (49/49 full E2E, 67/67 unit). Month reset, 5 concurrent saves and restore-safe numbering verified at unit level with an injected clock. Results: `docs/test-results/PHASE-1-TEST-RESULTS.md`. Regression: full suite (schema change), US-1 and US-3 pass.

Shipped as `src/main/signatories.js`: `ISSUING_OFFICES`, `ROLES`, `listSignatories`, `createSignatory`, `updateSignatory`, `archiveSignatory`, `restoreSignatory`, `getDefaults`, `setDefault`, `activeSignatory`. `src/main/records.js`: `FORM_TYPES`, `formatNumber`, `periodOf`, `createRecord`. `src/main/directory.js`: `fieldErrors`, `text`, `isDup` now exported. `src/main/ipc.js` routes `signatories:*`, `records:create`. `src/renderer/pages/Signatories.jsx`, `NewRecord.jsx`. `components/ConfirmDialog.jsx` (`confirmClass` prop). Tables: signatories, signatory_defaults, records, record_employees.

Deliberately not built, and why: printing, because Phase 2 owns US-6. Record list and edit, because Phase 3 owns US-8 and US-10.

Picked up from Phase 0: conventions (IPC shape, ROUTES + allowlist, `text()`, archive-only, utf8mb4 tables, `_test` databases).

Conventions later phases inherit: a record number is never assigned outside `createRecord`'s per-counter `GET_LOCK` (`plsto:<form>:<office>:<period>`) plus `MAX(seq)+1`. US-7 blank forms must reuse it. The period is the creation month in local time. Records hold snapshots (employee name, designation, status, office_id; signatory name and title), so printing reads the record, not the master lists. Overlap means inclusive dates intersect on an active record, and it warns with `overlaps` and is confirmed with `confirmOverlap: true`. Users approved: vehicle and return optional, date filed editable.

### Phase 2 — Print filled and blank forms NEXT

Covers US-6, US-7.

- Filled .xlsx on the official layout for all 4 templates.
- Numbered blank form that reserves a number and is filled later.

### Phase 3 — Browse, edit, archive LATER

Covers US-8, US-9, US-10.

- Search and filter records, edit details, archive and restore.

## Part two — Monitoring and data safety

### Phase 4 — Out today and per-office reports LATER

Covers US-11, US-12.

- Dashboard of employees out on a date, per-office report with .xlsx export.

### Phase 5 — Backup and restore LATER

Covers US-13, US-14.

- .sql backup to a chosen folder, restore with automatic pre-restore backup.

### Phase 6 — User account management LATER

Covers US-2.

- Admin adds encoders, resets passwords, disables accounts.
