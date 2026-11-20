# Phase 1 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe` (Electron 41.2.2).
Database: `pls_to_test` on local WAMP MySQL 5.7.26, recreated per test. `pls_to` not touched.

## Test scope as run

```
Feature: Phase 1, US-4, US-5
Feature tests: unit and integration (66, Vitest) incl. signatories.js, records.js, ipc routes, schema. E2E for US-4, US-5
Regression E2E: US-1, US-3 (Phase 0) — App.jsx nav, ipc.js ROUTES, preload allowlist, directory.js exports changed
System E2E: none, CW-1 needs US-6 (Phase 2)
Full E2E run: yes, schema change (4 new tables) — 48/48
```

## US-4 Manage signatories — `tests/e2e/features/us-4-signatories.spec.js` — PASS 7/7

| Condition | Result |
|---|---|
| Add with name, title, role; edit | PASS |
| Name and title required | PASS |
| Set all 4 office defaults (SQL-verified) | PASS |
| Default signatory cannot be archived, exact message | PASS |
| Archive Cancel changes nothing | PASS |
| Archive → Archived filter → Restore; archived not pickable on New record | PASS |
| Saved record keeps signatory name and title after edit | PASS |

## US-5 Create a PLS or TO record — `tests/e2e/features/us-5-create-record.spec.js` — PASS 12/12

| Condition | Result |
|---|---|
| Numbers: PLS `<ym>-1`, `<ym>-2`, TO `<ym>-1`, SB PLS `SB <ym>-1` | PASS |
| Signatories pre-fill from defaults and switch with office | PASS |
| Signatory changeable per record | PASS |
| 6th employee cannot be added | PASS |
| Missing required fields → messages, nothing saved | PASS |
| Return before departure rejected | PASS |
| Inclusive end before start rejected | PASS |
| Vehicle and return optional | PASS |
| Double-click Save → one record | PASS |
| Date filed editable, number month unchanged | PASS |
| Employee details kept as saved | PASS |
| Overlap warning text; Cancel saves nothing; Save anyway → next number | PASS |

Month reset (`2026-11-30 23:59` → `2026-11-3`, `2026-12-01 00:00` → `2026-12-1`), 5 concurrent saves on one counter, restore-safe numbering and tampered payloads are covered at unit level (`records.test.js`) with an injected clock.

## Regression — Phase 0

US-1 14/14, US-3 15/15 (part of the full run).

## Mutation checks (each went red, then restored)

- No counter lock → 5 concurrent saves collide (red 5/5 runs).
- `periodOf` in UTC → month-boundary test red.
- Default-archive block removed → unit and US-4 E2E red.
- Default pre-fill off → US-5 pre-fill E2E red.
- Preload allowlist not updated → sync test red.

## Left behind

Nothing outside `pls_to_test`. Traces only in git-ignored `/test-results/`.
