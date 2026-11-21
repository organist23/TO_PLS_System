import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

// Cell map per template, from the rendered official forms (Phase 2 plan). `create` cells have no line on the
// template, so they are merged A:K and styled like the approving name/title.
const LAYOUTS = {
  'PLS-MAYOR': { file: 'pls-mayor.xlsx', number: 'A12', date: 'H12', nameRow: 14, dest: 'A20', inc: 'A21', veh: 'F21', dep: 'A22', depTime: 'G22', ret: 'A23', retTime: 'G23', purposeRow: 24, recName: 'A31', recTitle: 'A32', apprName: 'A37', apprTitle: 'A38', create: ['recName'] },
  'TO-MAYOR': { file: 'to-mayor.xlsx', number: 'A10', date: 'H10', nameRow: 12, dest: 'A18', inc: 'A19', veh: 'F19', dep: 'A20', depTime: 'G20', ret: 'A21', retTime: 'G21', purposeRow: 22, recName: 'A29', recTitle: 'A30', apprName: 'A36', apprTitle: 'A37', create: ['recName', 'recTitle'] },
  'PLS-SB': { file: 'pls-sb.xlsx', number: 'A10', date: 'H10', nameRow: 12, dest: 'A18', inc: 'A19', veh: 'F19', dep: 'A20', depTime: 'G20', ret: 'A21', retTime: 'G21', purposeRow: 22, recName: 'A29', recTitle: 'A30', apprName: 'A36', apprTitle: 'A37', create: [] },
  'TO-SB': { file: 'to-sb.xlsx', number: 'A10', date: 'H10', nameRow: 12, dest: 'A17', inc: 'A18', veh: 'F18', dep: 'A19', depTime: 'G19', ret: 'A20', retTime: 'G20', purposeRow: 21, recName: 'A28', recTitle: 'A29', apprName: 'A34', apprTitle: 'A35', create: [] },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (s) => s.slice(0, 10).split('-').map(Number); // 'YYYY-MM-DD[ HH:MM:SS]'

export function formatDate(s) {
  const [y, m, d] = parts(s);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatRange(from, to) {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  if (from === to) return formatDate(from);
  if (y1 === y2 && m1 === m2) return `${MONTHS[m1 - 1]} ${d1}-${d2}, ${y1}`;
  if (y1 === y2) return `${MONTHS[m1 - 1]} ${d1} - ${MONTHS[m2 - 1]} ${d2}, ${y1}`;
  return `${formatDate(from)} - ${formatDate(to)}`;
}

export function formatTime(s) {
  const [h, min] = s.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// Characters per PURPOSE(S) line at 11 pt (the template's 12 pt holds ~354 of the allowed 360). Line 1 shares its row with the label.
const WIDTHS = [86, 104, 104, 104];
const PURPOSE_SIZE = 11;

export function wrapPurpose(text) {
  const lines = ['', '', '', ''];
  let i = 0;
  for (const word of text.split(' ')) {
    const next = lines[i] ? `${lines[i]} ${word}` : word;
    if (next.length > WIDTHS[i] && lines[i] && i < 3) lines[++i] = word;
    else lines[i] = next; // shortcut: past line 4 the text runs on in line 4; the 360-char limit keeps this from happening
  }
  return lines;
}

export async function getPrintable(pool, id) {
  const [[record]] = await pool.query('SELECT * FROM records WHERE id = ?', [Number(id) || 0]);
  if (!record) return { ok: false, error: 'Record not found' };
  if (record.archived_at) return { ok: false, error: 'Restore this record before printing.' };
  const [employees] = await pool.query(
    'SELECT full_name, designation, employment_status FROM record_employees WHERE record_id = ? ORDER BY position',
    [record.id],
  );
  return { ok: true, data: { ...record, employees } };
}

// "DEPARTURE:______" + value -> "DEPARTURE: value". The template's own label (and leading space) is kept.
const labelled = (cell, value) => {
  const t = cell.text;
  cell.value = `${t.slice(0, t.indexOf(':') + 1)} ${value}`;
};

// exceljs shares one style object between cells loaded with the same style, so assigning cell.font would
// change every cell sharing it. Give the cell its own style copy instead.
const restyle = (cell, change) => {
  cell.style = { ...cell.style, ...change };
};

// Characters that fit at 12 pt before the next filled cell (measured on the rendered templates).
const FITS_AT_12 = { inc: 44, dest: 100, veh: 44 };
// shortcut: estimates width from character count, not glyph widths; text past 8 pt still clips. Measure fonts if staff report cut text.
const shrinkToFit = (cell, fits) => {
  const size = Math.max(8, Math.min(cell.font?.size ?? 12, Math.floor((12 * fits) / cell.text.length)));
  restyle(cell, { font: { ...cell.font, size } });
};

export async function fillWorkbook(record) {
  const layout = LAYOUTS[`${record.form_type}-${record.issuing_office}`];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(templatesDir, layout.file));
  const ws = wb.worksheets[0];
  const cell = (key) => ws.getCell(layout[key]);

  // Number: keep the label run, then "<SB ><period>-" and "<seq>" in the template's own number fonts.
  const runs = cell('number').value.richText;
  cell('number').value = {
    richText: [
      runs[0],
      { font: runs[1].font, text: `${record.issuing_office === 'SB' ? 'SB ' : ''}${record.period}-` },
      { font: runs[runs.length - 1].font, text: String(record.seq) },
    ],
  };

  for (const key of layout.create) {
    const c = cell(key);
    const row = c.row;
    ws.mergeCells(`A${row}:K${row}`);
    restyle(c, { font: { ...cell(key === 'recName' ? 'apprName' : 'apprTitle').font }, alignment: { horizontal: 'center', vertical: 'middle' } });
  }
  cell('recName').value = record.recommending_name;
  cell('recTitle').value = record.recommending_title;
  cell('apprName').value = record.approving_name;
  cell('apprTitle').value = record.approving_title;

  if (record.status === 'filled') {
    labelled(cell('date'), formatDate(record.date_filed));
    record.employees.forEach((e, i) => {
      const r = layout.nameRow + i;
      ws.getCell(`A${r}`).value = e.full_name;
      ws.getCell(`E${r}`).value = e.designation;
      ws.getCell(`H${r}`).value = e.employment_status;
    });
    labelled(cell('dest'), record.destination);
    labelled(cell('inc'), formatRange(record.inclusive_from, record.inclusive_to));
    if (record.vehicle) labelled(cell('veh'), record.vehicle);
    for (const key of Object.keys(FITS_AT_12)) shrinkToFit(cell(key), FITS_AT_12[key]);
    labelled(cell('dep'), formatDate(record.departure_at));
    labelled(cell('depTime'), formatTime(record.departure_at));
    if (record.return_at) {
      labelled(cell('ret'), formatDate(record.return_at));
      labelled(cell('retTime'), formatTime(record.return_at));
    }
    wrapPurpose(record.purpose).forEach((line, i) => {
      const c = ws.getCell(`A${layout.purposeRow + i}`);
      if (i === 0) labelled(c, line);
      else c.value = line || null;
      // Long words can leave a line longer than its width; shrink that line rather than let it run off the page.
      const size = Math.max(8, Math.min(PURPOSE_SIZE, Math.floor((PURPOSE_SIZE * WIDTHS[i]) / Math.max(line.length, 1))));
      restyle(c, { font: { ...c.font, size } });
    });
  }
  return wb;
}

export async function buildWorkbook(record) {
  return Buffer.from(await (await fillWorkbook(record)).xlsx.writeBuffer());
}

// ---------- preview: the filled sheet as plain data the renderer draws with React (never as HTML) ----------

const EMU_PER_PX = 9525;
const colPx = (width) => Math.round(width * 7 + 5); // Excel character width at Calibri 11
const rowPx = (pt) => Math.round((pt * 4) / 3);
const has = (b) => Boolean(b && b.style);
const runOf = (text, font = {}) => ({
  text,
  bold: Boolean(font.bold),
  italic: Boolean(font.italic),
  underline: Boolean(font.underline),
  size: font.size ?? 11,
  font: font.name ?? 'Calibri',
});

export async function previewOf(record) {
  const wb = await fillWorkbook(record);
  const ws = wb.worksheets[0];
  const [last] = ws.pageSetup.printArea.split(':').slice(-1);
  const lastCol = ws.getCell(last).col;
  const lastRow = ws.getCell(last).row;

  const cols = [];
  for (let c = 1; c <= lastCol; c++) cols.push(colPx(ws.getColumn(c).width ?? ws.properties.defaultColWidth ?? 8.43));

  // Merge master -> span; covered cells are skipped.
  const spans = new Map();
  const covered = new Set();
  for (const range of ws.model.merges ?? []) {
    const [a, b] = range.split(':').map((x) => ws.getCell(x));
    spans.set(a.address, { rowSpan: b.row - a.row + 1, colSpan: b.col - a.col + 1 });
    for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) if (r !== a.row || c !== a.col) covered.add(`${r}:${c}`);
  }

  const rows = [];
  for (let r = 1; r <= lastRow; r++) {
    const cells = [];
    for (let c = 1; c <= lastCol; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const cell = ws.getCell(r, c);
      const rich = cell.value && cell.value.richText;
      const b = cell.border ?? {};
      cells.push({
        col: c,
        ...(spans.get(cell.address) ?? { rowSpan: 1, colSpan: 1 }),
        runs: rich ? rich.map((x) => runOf(x.text, { ...cell.font, ...x.font })) : [runOf(cell.text, cell.font)],
        align: cell.alignment?.horizontal === 'center' || cell.alignment?.horizontal === 'right' ? cell.alignment.horizontal : 'left',
        valign: cell.alignment?.vertical === 'top' || cell.alignment?.vertical === 'middle' ? cell.alignment.vertical : 'bottom',
        wrap: Boolean(cell.alignment?.wrapText),
        border: { top: has(b.top), right: has(b.right), bottom: has(b.bottom), left: has(b.left) },
      });
    }
    rows.push({ height: rowPx(ws.getRow(r).height ?? ws.properties.defaultRowHeight ?? 15), cells });
  }

  const pic = ws.getImages()[0];
  let image = null;
  if (pic) {
    const sum = (arr, n) => arr.slice(0, n).reduce((x, y) => x + y, 0);
    const heights = rows.map((x) => x.height);
    const at = (a) => ({
      x: sum(cols, a.nativeCol) + a.nativeColOff / EMU_PER_PX,
      y: sum(heights, a.nativeRow) + a.nativeRowOff / EMU_PER_PX,
    });
    const tl = at(pic.range.tl);
    const br = at(pic.range.br);
    const img = wb.getImage(pic.imageId);
    image = {
      src: `data:image/${img.extension};base64,${Buffer.from(img.buffer).toString('base64')}`,
      left: Math.round(tl.x),
      top: Math.round(tl.y),
      width: Math.round(br.x - tl.x),
      height: Math.round(br.y - tl.y),
    };
  }
  return { cols, rows, image };
}
