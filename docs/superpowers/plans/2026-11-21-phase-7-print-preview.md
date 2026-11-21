# Phase 7 — Print Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print, Print again and Issue blank show the filled form on screen first. HR then chooses Save as Excel or Close (US-15; reopens US-6, US-7).

**Architecture:** `print.js` splits `buildWorkbook` into `fillWorkbook(record)` (the existing fill) and a writer. A new `previewOf(record)` walks the filled sheet's print area and returns plain data: column widths, row heights, merged spans, each cell's text runs and style, and the header image as a data URL. The renderer draws that data as an HTML table with React elements (never `innerHTML`), so record text stays plain text. The existing `records:print` route and save flow are unchanged. A new `records:preview` route feeds the dialog.

**Spec:** `spec.md` US-15, US-6/US-7 (Changed 2026-11-21). Conventions: `roadmap.md` Phase 0–2.

## Global Constraints

- `buildWorkbook` output stays byte-for-byte the same in content (all Phase 2 print tests unchanged and green).
- Unit conversions: column px = `Math.round(width * 7 + 5)` (Excel character width at Calibri 11), default width = `ws.properties.defaultColWidth ?? 8.43`. Row px = `Math.round(heightPt * 4 / 3)`, default `ws.properties.defaultRowHeight ?? 15`. Image offsets: EMU / 9525 = px.
- Print area comes from `ws.pageSetup.printArea` (`A1:K48`, …).
- Copy, exact: dialog title `Preview <PLS|TO> <number>`; buttons `Save as Excel`, `Close`; loading `Preparing preview…`. Errors reuse the route's error text.
- No new dependency.

## Review Focus

1. A purpose or name containing `<script>` or `<img onerror>` text shows literally in the preview. Test in Task 3 (E2E).
2. Every value in the preview equals the value in the saved .xlsx for the same record. Test in Task 1 (unit) compares `previewOf` cells with the `buildWorkbook` buffer for all 4 templates.
3. Closing the preview with Escape or Close writes no file and leaves the page usable. Test in Task 3.
4. A preview of an archived record is refused and opens no dialog. Test in Task 2 and Task 3.

---

### Task 0: Branch
- [ ] `git checkout -b phase-7-print-preview`. Commit `spec.md`, `roadmap.md`, both plans (Phase 3, Phase 7) as `docs: US-15 print preview, Phase 7 plan, Phase 3 paused`.

### Task 1: `previewOf`

**Files:** Modify `src/main/print.js`, `tests/unit/print.test.js`.

**Interfaces:**
- `fillWorkbook(record) -> Promise<ExcelJS.Workbook>` (the current body of `buildWorkbook`). `buildWorkbook(record)` = `Buffer.from(await (await fillWorkbook(record)).xlsx.writeBuffer())`.
- `previewOf(record) -> Promise<{ cols: number[], rows: { height: number, cells: Cell[] }[], image: { src, left, top, width, height } | null }>`.
  - `Cell = { col, rowSpan, colSpan, runs: [{ text, bold, italic, underline, size, font }], align: 'left'|'center'|'right', valign: 'top'|'middle'|'bottom', wrap, border: { top, right, bottom, left } }`. Border values are booleans.
  - Cells covered by a merge are omitted. A cell's own font fills the runs of plain values. Rich text keeps one run per segment.
  - The image takes its position from its `tl`/`br` anchors (column/row index plus offsets) summed over `cols`/`rows`, and `src` = `data:image/<ext>;base64,…`.
- [ ] Tests first (hand-derived, PLS-MAYOR unless noted):
  - 11 columns and 48 rows from the print area. Column C = `Math.round(15.1 * 7 + 5)` = 111 (read the exact width from the template in the test).
  - The A10 title cell has `colSpan 11`, text `PERSONNEL LOCATOR SLIP`, and `align 'center'`.
  - The A12 number cell has 3 runs with the texts `PLS NO: `, `2026-11-`, `7`, and runs 2–3 underlined.
  - Row 14 has name, designation and status at columns A, E, H.
  - The image `src` starts with `data:image/` and `top` = 0.
  - **Values match the file:** for each of the 4 templates and the filled record from the Phase 2 tests, every non-empty preview cell text equals the `buildWorkbook` buffer's cell text at the same address, and the reverse holds too (Review Focus 2).
- [ ] Mutation: drop the merge handling (no omitted cells) → the colSpan test goes red. Commit `feat: preview data from the filled template`.

### Task 2: IPC
**Files:** Modify `src/main/ipc.js`, `src/main/preload.cjs`, `tests/unit/ipc.test.js`.
- [ ] `records:preview {id}` (`ready`): `getPrintable` (the archived refusal) → `previewOf`. Test first: it returns rows for a saved record, is refused for an archived one, needs the password changed first, and the allowlist stays in sync. Commit `feat: IPC for print preview`.

### Task 3: Preview dialog and flow

**Files:** Create `src/renderer/components/FormPreview.jsx`. Modify `src/renderer/pages/NewRecord.jsx`, `tests/e2e/helpers.js`, `tests/e2e/features/us-6-print.spec.js`, `us-7-blank-forms.spec.js`, `tests/e2e/system/cw-1-issue-and-print.spec.js`. Create `tests/e2e/features/us-15-preview.spec.js`.

- `FormPreview({ model })`: a `position: relative` box. Inside it, a `table-layout: fixed` table with a `<col>` per width and a fixed height per row. Each `<td>` has its span, alignment, `white-space: nowrap` (or `pre-wrap` when `wrap`), `overflow: visible`, and borders `1px solid #000` per side. Runs are `<span>`s with the font weight, style, underline, size in `pt` and family. The image is an absolutely positioned `<img alt="">`. The whole box is scaled to the dialog width with CSS `zoom`.
- `NewRecord.jsx`: `print(id)` opens the native `<dialog>` (same pattern as ConfirmDialog) titled `Preview <form> <number>`. It shows `Preparing preview…`, then the preview or an error alert. `Save as Excel` calls the existing save flow (`records:print`) and closes the dialog. `Close`/Escape close it with nothing saved. Focus starts on `Save as Excel`. Issue blank, Print and Print again all go through `print(id)`.
- `helpers.js`: `saveFromPreview(page)` clicks `Save as Excel` in the preview dialog. The US-6/US-7/CW-1 specs call it after each Print click. No assertion changes.
- US-15 E2E, one test per condition:
  - Print opens the preview with title, number, name and signatory visible, and no file exists yet.
  - Save as Excel writes the file, and its A12 equals the previewed number.
  - Close and Escape write nothing, and Print still works afterwards.
  - Archived → the error text shows and no preview table appears.
  - Issue blank → the preview shows the number and signatories with no names.
  - A purpose `<img src=x onerror=alert(1)>` and a name `<script>` show literally, and no `img[src=x]` element exists.
- [ ] Build, take smoke screenshots of the preview for all 4 kinds, and compare by eye with the Phase 2 Excel renders. Delete the smoke. Mutations: Save as Excel skipping `records:print` → US-15 red. Commit `feat: preview before saving a form`.

### Task 4: Package, verify, record
- [ ] Full E2E on the packaged exe, `npm test`, rebuild the installer, `docs/test-results/PHASE-7-TEST-RESULTS.md`, commit.

---

## Test scope

```
Feature: Phase 7, US-15 (reopens US-6, US-7)
Feature tests: unit for previewOf (incl. preview = file for 4 templates), ipc records:preview. E2E for US-15
Regression E2E: US-6, US-7, CW-1 (print flow changed); US-5 (NewRecord.jsx changed)
System E2E: CW-1
Full E2E run: yes, NewRecord.jsx is named in the "Shipped as" of Phase 1 and Phase 2
```
