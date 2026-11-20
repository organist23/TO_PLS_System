---
name: e2e-testing
description: Use when running or writing E2E tests for the PLS-TO Records System (feature-workflow step 8), "test this for real", or any Playwright run that launches the Electron app. Covers keeping the pass off the real pls_to database, setup, and teardown.
---

# End-to-end testing — PLS-TO Records System

> Used during `feature-workflow` step 8. Modelled on `examples/e2e-testing-clio.md`.

**Never run a pass against the real database.** The app and MySQL (WAMP 5.7) live on one PC. The
real records are in `pls_to`. Every pass uses its own database whose name ends in `_test`
(default `pls_to_test`), created fresh per test.

## Isolation — the `_test` name is the gate

| Consumer | Database | Touched by a pass? |
|---|---|---|
| The installed app on this PC | `pls_to` (or `DB_NAME` in its `%APPDATA%\PLS-TO Records System\.env`) | **no** |
| Unit and integration suite (`npm test`) | `TEST_DB_NAME` or `pls_to_test` | yes, dropped and recreated per test |
| E2E (`npx playwright test`) | same as above, passed to the app as `DB_NAME` | yes |

Rules:

- `tests/helpers/testDb.js` `testConfig()` throws `Refusing to run tests against <name>` unless the
  name ends in `_test`. `launchApp()` calls it before launching. Never loosen it.
- Never set `TEST_DB_NAME` to `pls_to` or any name without `_test`. A test that needs a non-test
  name (the guard test) uses a name no real database has (`zz_plsto_guard_probe`).
- A mutation check that removes a safety guard must not run against a name that exists. Check
  the test's database name first.
- `.env` in the project root is git-ignored. It holds only connection settings, never the
  database name of real data for tests.

## Setup

```bash
# 1. MySQL (WAMP) running
sc query wampmysqld64 | grep RUNNING

# 2. Build the renderer (test:e2e does this)
npm run test:e2e
# Packaged build instead of source:
E2E_EXE="dist/app/win-unpacked/PLS-TO Records System.exe" npx playwright test
```

VS Code terminals set `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node
("Process failed to launch!"). `launchApp()` removes it. Running the app by hand from a VS
Code terminal needs `unset ELECTRON_RUN_AS_NODE` first.

## Prove the isolation before creating anything

1. `launchApp()` resolves its database through `testConfig()`. Read it before changing.
2. After a pass, `SHOW DATABASES` must show `pls_to` unchanged (same row counts as before).

## During the pass

- **Hand-derive every expected value** (record numbers, counts, dates) and write it in the test
  before the first run. A value computed by the code under test proves nothing.
- **Accounts:** the seeded `admin`/`admin` exists only in the fresh test database. The helper
  changes it to `Test-pass-123`. Never use a real account's password in a test.
- **Assert through the UI, check through SQL.** Use the `pool` that `launchApp()` returns to
  confirm row counts (double-submit, Cancel changes nothing).
- **Watch every new test fail** by breaking the behavior it covers, then restore.

## Teardown

- Close the app and `pool.end()` in every test (`afterEach`).
- The test database is dropped by the next run. Nothing outside it is created, except the
  screenshots and traces in `/test-results/` (git-ignored).
- Record the pass in `docs/test-results/PHASE-<N>-TEST-RESULTS.md`.

## Common mistakes

| Symptom | Cause |
|---|---|
| `Process failed to launch!` | `ELECTRON_RUN_AS_NODE=1` inherited from VS Code |
| `Refusing to run tests against …` | `TEST_DB_NAME` set to a name without `_test`. Working as intended |
| `ECONNREFUSED 127.0.0.1:3306` | WAMP MySQL stopped |
| strict mode violation on `getByLabel('New password')` | substring match; use `{ exact: true }` |
| Page shows "Cannot connect to the database" | wrong `DB_*` in `.env`, or MySQL stopped |
