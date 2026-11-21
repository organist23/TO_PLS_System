# Phase 7 — Test results

Date: 2026-11-21
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe`. OS save dialog stubbed at the OS boundary.
Database: `pls_to_test` on local WAMP MySQL 5.7.26. `pls_to` not touched.

## Test scope as run

```
Feature: Phase 7, US-15 (reopens US-6, US-7)
Feature tests: unit (109, Vitest) incl. previewOf grid/merges/runs/image and "preview = saved file" for all 4 templates, records:preview route. E2E for US-15
Regression E2E: US-6, US-7, CW-1 (print flow now goes through the preview; only a saveFromPreview step added, no assertion changed), US-5
System E2E: CW-1
Full E2E run: yes, NewRecord.jsx is in Phase 1 and Phase 2 "Shipped as" — 69/69
```

## US-15 Preview a form before saving it — `tests/e2e/features/us-15-preview.spec.js` — PASS 6/6

| Condition | Result |
|---|---|
| Print opens the preview with title, form, number, names, signatory, purpose and the logo (loaded); no file yet | PASS |
| Save as Excel writes the file; its number equals the previewed number | PASS |
| Close and Escape write nothing; Print works again afterwards | PASS |
| Archived record: error shown, no preview | PASS |
| Issue blank previews number and signatories, no names, blank DATE line | PASS |
| `<script>` name and `<img onerror>` purpose show literally; nothing runs | PASS |

Unit: the preview's cell values equal the saved .xlsx cell values for all 4 templates (Review Focus 2).

## Regression

US-6 6/6, US-7 6/6, CW-1 1/1, US-1 14/14, US-3 15/15, US-4 7/7, US-5 13/13 (full run).

## Visual check

In-app preview screenshots of all 4 kinds compared with the Phase 2 Excel renders: same layout, logo, fonts, lines and values. Found and fixed: the logo was blocked by the page's Content Security Policy (`img-src` now allows `data:`), and the E2E now checks the image really loads.

## Mutation checks (each went red, then restored)

- Merge handling removed in `previewOf` → 5 unit tests red.
- Stale preview result not ignored → Close/Escape E2E red (the late result reopened the dialog).
- Save as Excel not saving → US-15 E2E red.

## Left behind

Nothing outside `pls_to_test`. Temp .xlsx files in the OS temp folder.
