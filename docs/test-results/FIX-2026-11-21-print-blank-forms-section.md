# Fix 2026-11-21 — Print blank forms section

Date: 2026-11-21
Request: HR found "How many" next to Save confusing. Blank-form printing moves into its own "Print blank forms" section on New record. No story, schema, API or business rule changes (feature-workflow Gate: small improvement).
Driver: Playwright `_electron` (1.65) against the packaged app `dist/app/win-unpacked/PLS-TO Records System.exe`.
Database: `pls_to_test`. `pls_to` not touched.

## Test scope as run

```
Feature: fix — New record layout (US-7, US-16 controls)
Feature tests: E2E US-16 (section uses its own form, office and signatories; Save form choices ignored), US-5 (empty-list hints in both places)
Regression E2E: US-5, US-7, US-15, US-16, US-17, CW-2, CW-4 (New record selectors scoped to the record form or the section; no assertion removed)
System E2E: CW-2, CW-4
Full E2E run: yes, NewRecord.jsx is in the "Shipped as" of Phases 1, 2, 3, 7, 8 — 115/116 on the first run, the 1 failure (duplicate empty-list hint, strict mode) fixed in the test and rerun: US-5 14/14
```

Unit: 168/168.

## What changed

- New record: the Save form ends at Save. "Print blank forms" is a separate section with its own Form, Issuing office, Recommending approval (SB only; Mayor's Office shows that the Department Head signs the paper), Approved by, How many and Issue blank form. Issue errors and empty-signatory hints show in the section. The section is hidden while a blank is being filled in.
- Tests: `recordForm(page)` and `blankFormsSection(page)` helpers in `tests/e2e/helpers.js`; specs that used page-wide "Form", "Approved by" and radio locators now scope to one of them.

## Review

`/code-review`: no blocking findings. Fixed: section visible during an in-page Fill in, issue errors shown far from the section, server errors without a section field dropped, missing empty-signatory hints, no test for the Save form's choices being ignored. Not done: renaming the `rec-count` ids to `stack-`. `/security-review` not run: no IPC, SQL, auth or file-write change.

## Mutation checks (each went red, then restored)

- Issue using the Save form's Approved by → US-16 red.
- Confirmation title using the Save form's form type → US-16 red.

## Visual check

Screenshot of the new New record layout at 1280×900, looked at, then deleted.
