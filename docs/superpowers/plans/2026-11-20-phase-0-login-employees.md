# Phase 0 — Login and Employee Master List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff log in to an Electron desktop app backed by local MySQL and maintain the offices and employees master list (US-1, US-3).

**Architecture:** The Electron main process is the Node backend. It owns the MySQL pool, the session, and every business rule, and it exposes them to the React renderer only through an allowlisted IPC bridge (preload with `contextIsolation`, `sandbox`, no `nodeIntegration`). The renderer is React + Tailwind built by Vite. Page switching is plain state, with no router. There is no HTTP server.

**Tech Stack:** Electron, React, Vite, Tailwind CSS v4 (`@tailwindcss/vite`), `mysql2/promise`, Node `crypto.scrypt` for hashing, Vitest (unit and integration against MySQL), Playwright `_electron` (E2E), electron-builder (packaging).

**Spec:** `spec.md` (US-1, US-3). Roadmap entry: `roadmap.md` Phase 0.

## Global Constraints

- MySQL 5.7.26 (WAMP). No CHECK constraints, no MySQL 8 syntax. InnoDB, `utf8mb4`, `utf8mb4_unicode_ci`.
- DB defaults: host `localhost`, port `3306`, user `root`, password empty, database `pls_to`. Env vars `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` override them.
- Config file: packaged app reads `<app.getPath('userData')>/.env`. Dev reads `<project root>/.env`. `PLS_TO_ENV_FILE` overrides the path (tests). A missing file is not an error. `.env` is git-ignored.
- Tests only touch a database whose name ends in `_test` (default `pls_to_test`). Anything else makes the test helper throw before connecting.
- First run seeds username `admin`, password `admin`, role `admin`, `must_change_password = 1`.
- New password: at least 8 characters and different from the current one.
- Roles: `admin`, `encoder`. Phase 0 has no admin-only screen (US-2 is Phase 6).
- Employment status values, exact: `Permanent`, `Casual`, `Coterminous`, `Contractual`, `Job Order`.
- Copy, exact: login failure `Invalid username or password`. Disabled account gets the same message. Office archive block `Move or archive its N employees first.` (N = count). Empty lists `No employees found` / `No offices found`.
- Every IPC result is `{ ok: true, data }` or `{ ok: false, error: string, errors?: { [field]: string } }`.
- Archive is the only removal. No DELETE statement on `offices` or `employees` exists.
- App name in window title and installer: `PLS-TO Records System`.

## Review Focus

1. Same name with different case or extra spaces (`juan dela cruz ` vs `JUAN DELA CRUZ`) in one office counts as a duplicate. Test in Task 4.
2. Filipino names with `Ñ`/`ñ` (`PEÑA`) save, search, and display unchanged. Test in Task 4.
3. Search text `%`, `_`, or `'` matches literally. It never matches everything or breaks the query. Test in Task 4.
4. MySQL stopped or wrong config at startup shows a readable error with the config file path, not a blank window. Test in Task 7.
5. After logout, or before the forced password change, a direct `window.api.invoke('employees:list')` from the renderer is refused. Tests in Task 5 and Task 7.

---

## File Structure

```
package.json              scripts, deps, electron-builder config
.gitignore
vite.config.js            renderer build (root src/renderer, out dist/renderer)
vitest.config.js          unit/integration, node env, files run serially
playwright.config.js
src/main/main.js          Electron entry: config → pool → migrate → ensureAdmin → window → IPC
src/main/preload.cjs      contextBridge: window.api.invoke(channel, payload), channel allowlist
src/main/config.js        loadConfig()
src/main/db.js            createPool(), migrate()
src/main/schema.sql
src/main/auth.js          password hashing, ensureAdmin, login, changePassword
src/main/directory.js     offices + employees rules
src/main/ipc.js           registerIpc(): session map, guards, handlers
src/renderer/index.html, main.jsx, index.css, App.jsx
src/renderer/pages/Login.jsx, ChangePassword.jsx, Offices.jsx, Employees.jsx, DbError.jsx
src/renderer/components/ConfirmDialog.jsx
tests/helpers/testDb.js   freshTestDb()
tests/unit/config.test.js, auth.test.js, directory.test.js, ipc.test.js
tests/e2e/helpers.js      launchApp()
tests/e2e/features/us-1-login.spec.js
tests/e2e/features/us-3-offices-employees.spec.js
```

---

### Task 0: Branch and tooling

**Files:** Create `package.json`, `.gitignore`, `vite.config.js`, `vitest.config.js`, `playwright.config.js`, `src/renderer/index.html`, `src/renderer/main.jsx`, `src/renderer/index.css`, `src/main/main.js` (window only), `src/main/preload.cjs`.

- [ ] **Step 0:** `git remote rename origin template` then `git remote add origin https://github.com/organist23/TO_PLS_System.git`. Never push to `template` (My_Template is the user's template only). Pushing happens at step 11.
- [ ] **Step 1:** `git checkout -b phase-0-login-employees`. Commit `spec.md`, `roadmap.md`, `CLAUDE.md`, `examples/actual_files/` as `docs: PLS-TO spec, roadmap, project facts`. Do not stage `.claude/settings.json` or the `sample_data/` deletions.
- [ ] **Step 2:** `npm init -y`. Set `"type": "module"`, `"main": "src/main/main.js"`, `"name": "pls-to-records-system"`, `"productName": "PLS-TO Records System"`. Install deps `mysql2 react react-dom`. Install dev deps `electron vite @vitejs/plugin-react tailwindcss @tailwindcss/vite vitest @playwright/test electron-builder`.
- [ ] **Step 3:** Scripts: `"build": "vite build"`, `"start": "npm run build && electron ."`, `"test": "vitest run"`, `"test:e2e": "npm run build && playwright test"`, `"dist": "npm run build && electron-builder --win dir"`.
- [ ] **Step 4:** `.gitignore`: `node_modules/`, `dist/`, `.env`, `/test-results/`, `playwright-report/`. Then `git check-ignore docs/test-results/` must print nothing.
- [ ] **Step 5:** `vite.config.js`: `root: 'src/renderer'`, `base: './'`, `build.outDir: '../../dist/renderer'`, `emptyOutDir: true`, plugins `react()` and `tailwindcss()`. `index.css` is `@import "tailwindcss";`. `vitest.config.js`: `test.include: ['tests/unit/**/*.test.js']`, `environment: 'node'`, `fileParallelism: false`. `playwright.config.js`: `testDir: 'tests/e2e'`, `workers: 1`, `timeout: 30000`.
- [ ] **Step 6:** `main.js` creates a `BrowserWindow` titled `PLS-TO Records System` with `webPreferences: { preload: preload.cjs, contextIsolation: true, sandbox: true, nodeIntegration: false }`, and loads `dist/renderer/index.html`. Verify: `npm start` opens a window showing the React placeholder `PLS-TO Records System` styled by a Tailwind class.
- [ ] **Step 7:** Commit `chore: Electron + React + Tailwind + Vite scaffold`.

### Task 1: Config loading

**Files:** Create `src/main/config.js`, `tests/unit/config.test.js`.

**Interfaces:**
- Produces: `loadConfig(envPath: string | undefined) -> { host, port: number, user, password, database }`. It calls `process.loadEnvFile(envPath)` when the file exists. Existing env vars win, which is Node's behavior. Then it reads `DB_*` with the Global Constraints defaults.

- [ ] **Step 1: Failing tests** (delete `DB_*` from `process.env` in `beforeEach`):
  - `defaults when no file`: `loadConfig('C:/nope/.env')` deep-equals `{ host:'localhost', port:3306, user:'root', password:'', database:'pls_to' }`.
  - `file overrides defaults`: a temp file containing `DB_NAME=pls_to_x\nDB_PORT=3307` gives `database:'pls_to_x', port:3307`.
  - `env var beats file`: `process.env.DB_NAME='pls_to_env'` plus that file gives `database:'pls_to_env'`.
- [ ] **Step 2:** `npx vitest run tests/unit/config.test.js` → FAIL (module not found).
- [ ] **Step 3:** Implement `loadConfig`.
- [ ] **Step 4:** Run → PASS. Mutation check: drop the `Number()` on port and confirm `file overrides defaults` goes red. Then restore it.
- [ ] **Step 5:** Commit `feat: DB config from defaults, .env, env vars`.

### Task 2: Schema, pool, migrate, test DB helper

**Files:** Create `src/main/schema.sql`, `src/main/db.js`, `tests/helpers/testDb.js`, `tests/unit/db.test.js`.

**Interfaces:**
- Produces: `createPool(config) -> mysql2 Pool` (`charset: 'utf8mb4'`, `dateStrings: true`). `migrate(config) -> Promise<void>`: connects without a database, runs `CREATE DATABASE IF NOT EXISTS \`<name>\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, then each statement of `schema.sql` (split on `;\n`). The database name must match `/^[A-Za-z0-9_]+$/`, otherwise it throws.
- Produces: `freshTestDb() -> Promise<Pool>`. It takes `loadConfig(<root>/.env)` with `database = process.env.TEST_DB_NAME ?? 'pls_to_test'`, throws `Refusing to run tests against <name>` unless the name ends in `_test`, drops and recreates the database, runs `migrate`, and returns a pool.

Schema (exact):

```sql
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('admin','encoder') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS offices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  archived_at DATETIME NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  designation VARCHAR(150) NOT NULL DEFAULT '',
  employment_status ENUM('Permanent','Casual','Coterminous','Contractual','Job Order') NOT NULL,
  office_id INT NOT NULL,
  archived_at DATETIME NULL,
  UNIQUE KEY uq_employee_office (full_name, office_id),
  CONSTRAINT fk_employee_office FOREIGN KEY (office_id) REFERENCES offices(id)
) ENGINE=InnoDB;
```

Add one line at the top of `schema.sql`: `-- shortcut: CREATE IF NOT EXISTS only, no versioning. The first phase that alters a table adds a schema_version table.`

- [ ] **Step 1: Failing tests:** `freshTestDb creates the 3 tables` (`SHOW TABLES` returns `employees, offices, users`). `refuses non-test db` (`TEST_DB_NAME='pls_to'` rejects with `Refusing to run tests against pls_to`). `migrate is idempotent` (running it twice does not throw). `rejects unsafe db name` (`database: 'x; DROP'` throws).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Mutation check: remove the `_test` guard and confirm `refuses non-test db` goes red.
- [ ] **Step 5:** Commit `feat: MySQL schema, migrate, guarded test DB`.

### Task 3: Auth logic

**Files:** Create `src/main/auth.js`, `tests/unit/auth.test.js`.

**Interfaces:**
- Produces: `hashPassword(pw) -> Promise<string>`, stored as `scrypt$<saltHex>$<hashHex>` (16-byte salt, 64-byte key). `verifyPassword(pw, stored) -> Promise<boolean>` uses `timingSafeEqual`.
- Produces: `ensureAdmin(pool) -> Promise<void>`. When `users` is empty it inserts `admin` / `admin` / `Administrator` / `admin` / `must_change_password=1`.
- Produces: `login(pool, username, password) -> Promise<User | null>` with `User = { id, username, fullName, role, mustChangePassword: boolean }`. It returns `null` for an unknown user, a wrong password, or `active=0`. For an unknown username it still runs `verifyPassword` against a fixed dummy hash.
- Produces: `changePassword(pool, userId, newPassword) -> Promise<{ ok: true } | { ok: false, errors: { newPassword: string } }>`. Errors are `At least 8 characters` and `Must differ from the current password`. Success clears `must_change_password`.

- [ ] **Step 1: Failing tests** (each on `freshTestDb()`):
  - `ensureAdmin seeds once`: called twice, `SELECT COUNT(*)` = 1, and `login(pool,'admin','admin')` returns `mustChangePassword: true, role: 'admin'`.
  - `wrong password → null`, `unknown user → null`.
  - `disabled → null`: `UPDATE users SET active=0`, then `login` with the correct password returns `null`.
  - `hash is not plaintext`: `password_hash` does not contain `admin` and starts with `scrypt$`.
  - `changePassword rules`: `'short'` → `At least 8 characters`. Setting `'adminadmin'` twice: the second call → `Must differ from the current password`. Success → the next `login` with the new password has `mustChangePassword: false`, and the old one returns `null`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Mutation check: make `verifyPassword` return `true` and confirm `wrong password → null` goes red.
- [ ] **Step 5:** Commit `feat: scrypt auth, seeded admin, forced password change`.

### Task 4: Offices and employees logic

**Files:** Create `src/main/directory.js`, `tests/unit/directory.test.js`.

**Interfaces:**
- Produces (all take `pool` first, all return the `{ok,...}` shape from Global Constraints):
  - `listOffices(pool, { archived = false })` → `data: [{ id, name, archivedAt, activeEmployees }]` ordered by name.
  - `createOffice(pool, { name })`, `updateOffice(pool, { id, name })`. Name is trimmed and required (`errors.name = 'Required'`). A duplicate gives `errors.name = 'An office with this name already exists'`. Catch `ER_DUP_ENTRY`. Do not pre-check, so concurrent saves stay safe.
  - `archiveOffice(pool, { id })` is blocked when the office has active employees: `error: 'Move or archive its N employees first.'`. `restoreOffice(pool, { id })`.
  - `listEmployees(pool, { search = '', officeId = null, archived = false })` → `data: [{ id, fullName, designation, employmentStatus, officeId, officeName, archivedAt }]` ordered by full name. `search` matches `full_name` with `LIKE ? ESCAPE '\\'` after escaping `\`, `%`, `_`.
  - `createEmployee(pool, { fullName, designation, employmentStatus, officeId })`, `updateEmployee(pool, { id, ...same })`. Errors: `fullName: 'Required'`, `officeId: 'Required'` (a missing or archived office gives `'Choose an active office'`), `employmentStatus: 'Choose a status'` when the value is not in the fixed list, `fullName: 'This employee already exists in this office'` on `ER_DUP_ENTRY`. Trim every string.
  - `archiveEmployee(pool, { id })`. `restoreEmployee(pool, { id })` is rejected with `error: 'Restore its office first.'` when the office is archived.
- Pick lists for later phases call `listEmployees(pool, {})` and `listOffices(pool, {})`. Active-only is the default.

- [ ] **Step 1: Failing tests:**
  - `office required + duplicate`: `''` → `name: 'Required'`. `'MHO'` twice → duplicate error. `' mho '` → duplicate error (trim plus the ci collation).
  - `office archive blocked`: an office with 2 active employees → `Move or archive its 2 employees first.`. After archiving both → ok. It disappears from `listOffices({})` and appears in `listOffices({archived:true})`. `restoreOffice` → back in the default list.
  - `employee validation`: a missing name, a missing office, an archived office, and status `'Regular'` each give the exact field message.
  - `employee duplicate`: `'Juan Dela Cruz'` then `'  JUAN DELA CRUZ '` in the same office → duplicate. The same name in another office → ok.
  - `ñ round-trip`: create `'MARIA PEÑA'`. `listEmployees({search:'peña'})` returns exactly `'MARIA PEÑA'`.
  - `literal search`: employees `'A%B'` and `'AXB'`. Search `'%'` returns only `'A%B'`. Search `"O'Brien"` returns `[]` without throwing.
  - `filter by office`: two offices with one employee each. `officeId` filter returns one.
  - `archive/restore employee`: hidden from the default list, shown with `archived:true`, restore brings it back. Restore while its office is archived → `Restore its office first.`
  - `archived stays on record`: an archived employee row still exists with its `office_id`. This proves archive is not delete.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with parameterized queries only.
- [ ] **Step 4:** Run → PASS. Mutation checks: drop the LIKE escaping (`literal search` goes red), and drop the active-employee count check (`office archive blocked` goes red).
- [ ] **Step 5:** Commit `feat: offices and employees with archive and restore`.

### Task 5: IPC layer and session

**Files:** Create `src/main/ipc.js`, `tests/unit/ipc.test.js`. Modify `src/main/preload.cjs`.

**Interfaces:**
- Consumes: Task 3 and Task 4 functions.
- Produces: `registerIpc(ipcMain, pool) -> { handlers }`. Sessions are a `Map<webContentsId, User>` held in the main process. Channels:
  - Public: `auth:login {username,password}` (sets the session, returns `data: User`, or `error: 'Invalid username or password'`), `auth:me` (`data: User | null`), `auth:logout` (deletes the session).
  - Logged in, even with `mustChangePassword`: `auth:changePassword {newPassword}`. Success updates the session user.
  - Logged in and password changed: `offices:list|create|update|archive|restore`, `employees:list|create|update|archive|restore`, mapping one-to-one to Task 4.
  - Guard failures: no session → `error: 'Not logged in'`. Password not changed → `error: 'Change your password first'`. Any thrown error → `error: 'Something went wrong. Please try again.'`, with the real error logged through `console.error`.
- `preload.cjs` exposes only `window.api.invoke(channel, payload)` and throws for a channel outside the allowlist (the list above).

- [ ] **Step 1: Failing tests:** call `handlers[channel]({ sender: { id: 1 } }, payload)` with a fake `ipcMain = { handle(ch, fn) {} }` that records the handlers, on `freshTestDb()` plus `ensureAdmin`.
  - `employees:list without login → Not logged in`.
  - `login as admin/admin then employees:list → Change your password first`.
  - `after changePassword, employees:list ok`.
  - `logout then employees:list → Not logged in`.
  - `sessions are per sender`: logging in on sender 1 does not authorize sender 2.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Wire it into `main.js`: `loadConfig` → `migrate` → `createPool` → `ensureAdmin` → `registerIpc` → window. Delete the session on the window's `closed` event.
- [ ] **Step 4:** Run → PASS. Mutation check: remove the `mustChangePassword` guard and confirm its test goes red.
- [ ] **Step 5:** Commit `feat: guarded IPC with main-process sessions`.

### Task 6: Renderer screens

Load `refactoring-ui` before styling. One neutral palette, one accent, Tailwind default spacing scale.

**Files:** Create `src/renderer/App.jsx`, `pages/Login.jsx`, `pages/ChangePassword.jsx`, `pages/Offices.jsx`, `pages/Employees.jsx`, `pages/DbError.jsx`, `components/ConfirmDialog.jsx`.

**Interfaces:**
- Consumes: `window.api.invoke` and the Task 5 channels.
- `App.jsx` calls `auth:me` on mount (shows `Loading…` until it returns). It shows Login when there is no user, ChangePassword when `mustChangePassword`, otherwise the shell: a header with the app name, the user's full name, and `Log out`, a sidebar with `Employees` (the landing page, which is the "dashboard" of US-1 for Phase 0) and `Offices`. If `location.hash` starts with `#db-error=`, it renders `DbError` instead.
- `ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel })` uses native `<dialog>`. Escape and Cancel call `onCancel`. Focus starts on Cancel. The confirm button is disabled while pending.

Required states per screen (from `feature-workflow` UI scope):
- Login: labelled username and password fields, Enter submits, the button shows `Signing in…` and is disabled while pending, and the error renders in a `role="alert"` element.
- ChangePassword: new and confirm fields. A mismatch shows `Passwords do not match` client-side. Server field errors show under the field. On success it goes to Employees.
- Offices and Employees: initial `Loading…`, an error banner with `Retry` on a failed list, the exact empty text, an `Active` / `Archived` toggle, add/edit in an inline form with field errors under each field, Save disabled with `Saving…` while pending, and a success message after save (`Saved`). Archive opens ConfirmDialog with title `Archive <name>?` and message `It will be hidden from pick lists. You can restore it from Archived.`. Cancel changes nothing. A server `error` (for example the office block) shows in the dialog. Restore needs no confirmation. Employees also has a search box (filters as you type, 250 ms debounce) and an office filter select. The status field is a select of the 5 values.
- Logout: calls `auth:logout`, then shows Login.

- [ ] **Step 1:** Build the screens. Verify by hand in `npm start` against a dev `pls_to` DB: log in as admin/admin, the forced change works, add an office and an employee, archive is blocked while the office has employees, archive and restore work, logout returns to Login.
- [ ] **Step 2:** Commit `feat: login, password change, offices and employees screens`.

UI behavior is covered by the Task 7 E2E specs. No component unit tests.

### Task 7: E2E specs (step 8 runs them)

Before writing these, replace the `.claude/skills/e2e-testing/SKILL.md` placeholder using `examples/e2e-testing-clio.md` as the model. Ask the user about environments first. The test target is the `pls_to_test` database. The real `pls_to` database is never written to.

**Files:** Create `tests/e2e/helpers.js`, `tests/e2e/features/us-1-login.spec.js`, `tests/e2e/features/us-3-offices-employees.spec.js`.

**Interfaces:**
- `launchApp({ env = {} } = {}) -> { app, page }`. It calls `freshTestDb()` first, then `_electron.launch({ args: ['.'], env: { ...process.env, DB_NAME: 'pls_to_test', PLS_TO_ENV_FILE: '<root>/.env', ...env } })`, or `executablePath: process.env.E2E_EXE` when set (the packaged app). It refuses when `DB_NAME` does not end in `_test`.
- `loginAsChangedAdmin(page)`: logs in as admin/admin and sets the password `Test-pass-123`. That is a test-database-only account.

`main.js` change: when `migrate` or the pool fails, load `index.html#db-error=<encodeURIComponent(message + ' Config file: ' + envPath)>`.

- [ ] **Step 1: `US-1` scenario**, one test per condition: valid login opens Employees. Wrong password and unknown user show exactly `Invalid username or password`. A disabled user (set by SQL in the test DB) gets the same message. First login forces the password change, and a short password shows `At least 8 characters`. Logout shows Login, and then `page.evaluate(() => window.api.invoke('employees:list'))` returns `error: 'Not logged in'`. Before the password change the same call returns `Change your password first`. The stored hash starts with `scrypt$` (SQL read). Double-clicking Sign in creates one session with no error.
- [ ] **Step 2: `US-3` scenario**, one test per condition: add, edit, and archive an office and an employee. An archived employee is absent from the default list and present under Archived, restore works. Search by name and filter by office. The status select has exactly the 5 values. A missing name or office shows field messages. A duplicate (`'  juan dela cruz '`) is rejected. Archive Cancel changes nothing (checked via SQL). Office archive with 2 employees shows `Move or archive its 2 employees first.`. `PEÑA` round-trips. Double-clicking Save creates one row (SQL count).
- [ ] **Step 3: DB error state:** `launchApp({ env: { DB_PORT: '1' } })` shows text containing `Config file:`.
- [ ] **Step 4:** `npm run test:e2e` → all PASS. Mutation check per spec: break one behavior (for example skip `deleteSession` on logout) and confirm the matching test goes red. Then restore it.
- [ ] **Step 5:** Commit `test: E2E for US-1 and US-3`.

### Task 8: Package and run E2E on the packaged app

**Files:** Modify `package.json` (`build` block).

- [ ] **Step 1:** electron-builder config: `appId: "ph.lgu.plsto"`, `productName: "PLS-TO Records System"`, `files: ["src/main/**", "dist/renderer/**", "package.json"]`, `win.target: ["nsis", "dir"]`, `directories.output: "dist/app"`. In packaged mode `main.js` reads `schema.sql` through `path.join(__dirname, 'schema.sql')`. That path works inside asar.
- [ ] **Step 2:** `npm run dist` → `dist/app/win-unpacked/PLS-TO Records System.exe` exists.
- [ ] **Step 3:** `E2E_EXE="dist/app/win-unpacked/PLS-TO Records System.exe" npx playwright test` → all PASS. This is the Phase 0 "Done when".
- [ ] **Step 4:** Commit `build: Windows packaging`.

---

## Test scope

```
Feature: Phase 0, US-1, US-3
Feature tests: unit and integration for config, db, auth, directory, ipc. E2E for US-1, US-3
Regression E2E: none, no DONE phases
System E2E: none, CW-1..3 need Phase 1+ stories
Full E2E run: no, Part one not complete (Phase 0 E2E suite is the whole suite anyway)
```
