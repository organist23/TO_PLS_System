import { test, expect, describe } from 'vitest';
import ExcelJS from 'exceljs';
import { formatDate, formatRange, formatTime, wrapPurpose, buildWorkbook, buildStackWorkbook, previewOf } from '../../src/main/print.js';
import JSZip from 'jszip';

test('formatDate', () => {
  expect(formatDate('2026-11-20')).toBe('November 20, 2026');
  expect(formatDate('2027-01-02')).toBe('January 2, 2027');
});

test('formatRange', () => {
  expect(formatRange('2026-11-20', '2026-11-20')).toBe('November 20, 2026');
  expect(formatRange('2026-11-20', '2026-11-22')).toBe('November 20-22, 2026');
  expect(formatRange('2026-11-30', '2026-12-02')).toBe('November 30 - December 2, 2026');
  expect(formatRange('2026-12-30', '2027-01-02')).toBe('December 30, 2026 - January 2, 2027');
});

test('formatTime', () => {
  expect(formatTime('2026-11-20 08:00:00')).toBe('8:00 AM');
  expect(formatTime('2026-11-20 13:30:00')).toBe('1:30 PM');
  expect(formatTime('2026-11-20 00:05:00')).toBe('12:05 AM');
  expect(formatTime('2026-11-20 12:30:00')).toBe('12:30 PM');
});

test('wrapPurpose fits 360 characters into 4 lines without splitting words', () => {
  const words = 'Attend the provincial coordination meeting on disaster preparedness and submit quarterly reports';
  let text = '';
  while ((text + ' ' + words).trim().length <= 360) text = (text + ' ' + words).trim();
  text = (text + ' ' + 'x'.repeat(360 - text.length - 1)).trim().slice(0, 360);
  const lines = wrapPurpose(text);
  expect(lines).toHaveLength(4);
  expect(lines[0].length).toBeLessThanOrEqual(86);
  for (const l of lines.slice(1)) expect(l.length).toBeLessThanOrEqual(104);
  expect(lines.filter(Boolean).join(' ')).toBe(text);
  expect(wrapPurpose('Submit reports')).toEqual(['Submit reports', '', '', '']);
});

// Hand-derived cell map from the rendered templates (see the Phase 2 plan).
const MAP = {
  'PLS-MAYOR': { number: 'A12', numberText: 'PLS NO: 2026-11-7', date: 'H12', names: [14, 15, 16], dest: 'A20', destLabel: 'DESTINATION:', inc: 'A21', veh: 'F21', dep: 'A22', depTime: 'G22', ret: 'A23', retTime: 'G23', purpose: ['A24', 'A25'], recName: 'A31', recTitle: 'A32', apprName: 'A37', apprTitle: 'A38' },
  'TO-MAYOR': { number: 'A10', numberText: 'TRAVEL ORDER NO: 2026-11-7', date: 'H10', names: [12, 13, 14], dest: 'A18', destLabel: 'DESTINATION(S):', inc: 'A19', veh: 'F19', dep: 'A20', depTime: 'G20', ret: 'A21', retTime: 'G21', purpose: ['A22', 'A23'], recName: 'A29', recTitle: 'A30', apprName: 'A36', apprTitle: 'A37' },
  'PLS-SB': { number: 'A10', numberText: 'PLS NO: SB 2026-11-7', date: 'H10', names: [12, 13, 14], dest: 'A18', destLabel: 'DESTINATION:', inc: 'A19', veh: 'F19', dep: 'A20', depTime: 'G20', ret: 'A21', retTime: 'G21', purpose: ['A22', 'A23'], recName: 'A29', recTitle: 'A30', apprName: 'A36', apprTitle: 'A37' },
  'TO-SB': { number: 'A10', numberText: 'TRAVEL ORDER NO: SB 2026-11-7', date: 'H10', names: [12, 13, 14], dest: 'A17', destLabel: 'DESTINATION:', inc: 'A18', veh: 'F18', dep: 'A19', depTime: 'G19', ret: 'A20', retTime: 'G20', purpose: ['A21', 'A22'], recName: 'A28', recTitle: 'A29', apprName: 'A34', apprTitle: 'A35' },
};

const record = (formType, issuingOffice, over = {}) => ({
  form_type: formType, issuing_office: issuingOffice, period: '2026-11', seq: 7,
  number: `${issuingOffice === 'SB' ? 'SB ' : ''}2026-11-7`, status: 'filled', archived_at: null,
  date_filed: '2026-11-21', destination: 'Provincial Capitol, Bayombong', vehicle: '',
  inclusive_from: '2026-11-20', inclusive_to: '2026-11-22', departure_at: '2026-11-20 08:00:00', return_at: null,
  purpose: 'Submit quarterly reports', recommending_name: 'JUAN P. SANTOS', recommending_title: 'DEPARTMENT HEAD',
  approving_name: 'VINCENT E. HERMOSO', approving_title: 'OIC - MUNICIPAL MAYOR',
  employees: [
    { full_name: 'MARIA PEÑA', designation: 'Nurse I', employment_status: 'Permanent' },
    { full_name: 'Ben Reyes', designation: 'Clerk', employment_status: 'Job Order' },
  ],
  ...over,
});

async function read(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[0];
}
const t = (ws, addr) => ws.getCell(addr).text;

describe.each(Object.entries(MAP))('%s', (key, m) => {
  const [formType, office] = key.split('-');

  test('filled record lands in the template cells', async () => {
    const ws = await read(await buildWorkbook(record(formType, office)));
    expect(t(ws, m.number)).toBe(m.numberText);
    expect(t(ws, m.date)).toBe('DATE: November 21, 2026');
    const [r1, r2, r3] = m.names;
    expect([t(ws, `A${r1}`), t(ws, `E${r1}`), t(ws, `H${r1}`)]).toEqual(['MARIA PEÑA', 'Nurse I', 'Permanent']);
    expect([t(ws, `A${r2}`), t(ws, `E${r2}`), t(ws, `H${r2}`)]).toEqual(['Ben Reyes', 'Clerk', 'Job Order']);
    expect(t(ws, `A${r3}`)).toBe('');
    expect(t(ws, m.dest)).toBe(`${m.destLabel} Provincial Capitol, Bayombong`);
    expect(t(ws, m.inc)).toBe('INCLUSIVE DATE(S): November 20-22, 2026');
    expect(t(ws, m.dep)).toBe('DEPARTURE: November 20, 2026');
    expect(t(ws, m.depTime)).toBe('TIME: 8:00 AM');
    expect(t(ws, m.purpose[0])).toBe('PURPOSE(S): Submit quarterly reports');
    expect(t(ws, m.purpose[1])).toBe('');
    expect(ws.getCell(m.purpose[0]).font.size).toBe(11);
    expect([t(ws, m.recName), t(ws, m.recTitle)]).toEqual(['JUAN P. SANTOS', 'DEPARTMENT HEAD']);
    expect([t(ws, m.apprName), t(ws, m.apprTitle)]).toEqual(['VINCENT E. HERMOSO', 'OIC - MUNICIPAL MAYOR']);
    expect(ws.getImages()).toHaveLength(1);
    expect(ws.pageSetup).toMatchObject({ fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9, orientation: 'portrait' });
  });

  test('empty vehicle and return keep the blank lines; set ones print', async () => {
    const empty = await read(await buildWorkbook(record(formType, office)));
    expect(t(empty, m.veh)).toBe('VEHICLE:');
    expect(t(empty, m.ret)).toMatch(/^ RETURN:_+$/);
    const set = await read(await buildWorkbook(record(formType, office, { vehicle: 'Service vehicle', return_at: '2026-11-22 17:00:00' })));
    expect(t(set, m.veh)).toBe('VEHICLE: Service vehicle');
    expect(t(set, m.ret)).toBe(' RETURN: November 22, 2026');
    expect(t(set, m.retTime)).toBe('TIME: 5:00 PM');
  });

  test('blank form: number and signatories only', async () => {
    const ws = await read(await buildWorkbook(record(formType, office, {
      status: 'blank', employees: [], date_filed: null, destination: '', purpose: '', inclusive_from: null, inclusive_to: null, departure_at: null,
    })));
    expect(t(ws, m.number)).toBe(m.numberText);
    expect(t(ws, m.date)).toMatch(/^DATE:_+$/);
    expect(t(ws, `A${m.names[0]}`)).toBe('');
    expect(t(ws, m.dest)).toBe(m.destLabel);
    expect([t(ws, m.recName), t(ws, m.apprName)]).toEqual(['JUAN P. SANTOS', 'VINCENT E. HERMOSO']);
  });
});

test('templates have no whitespace-only cells (they stop text overflowing into the next cell)', async () => {
  for (const f of ['pls-mayor', 'to-mayor', 'pls-sb', 'to-sb']) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(`src/main/templates/${f}.xlsx`);
    const junk = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => {
      if (typeof c.value === 'string' && c.value.trim() === '') junk.push(c.address);
    }));
    expect(junk, f).toEqual([]);
  }
});

test('long inclusive, destination and vehicle values shrink to fit their space (min 8 pt)', async () => {
  const ws = await read(await buildWorkbook(record('PLS', 'MAYOR', {
    inclusive_from: '2026-12-30', inclusive_to: '2027-01-02',
    destination: 'Department of the Interior and Local Government Provincial Office, Capitol Compound, Bayombong, Nueva Vizcaya',
    vehicle: 'Municipal service vehicle Toyota Hilux SAB 1234',
  })));
  // INCLUSIVE DATE(S): December 30, 2026 - January 2, 2027 = 54 chars; 44 fit at 12 pt -> floor(12*44/54) = 9
  expect(ws.getCell('A21').font.size).toBe(9);
  // DESTINATION: + 111 chars = 124 chars; 100 fit at 12 pt -> floor(12*100/124) = 9
  expect(ws.getCell('A20').font.size).toBe(9);
  // VEHICLE: + 47 = 56 chars; 44 fit at 12 pt -> floor(12*44/56) = 9
  expect(ws.getCell('F21').font.size).toBe(9);
  const short = await read(await buildWorkbook(record('PLS', 'MAYOR')));
  expect(short.getCell('A21').font.size).toBe(12); // template size kept when it fits
});

test('long-word purposes within 360 chars shrink the overflowing line instead of running off the page', async () => {
  const purpose = Array.from({ length: 20 }, (_, i) => `abcdefghijklmno${String(i).padStart(2, '0')}`).join(' ').slice(0, 359); // 17-char words
  expect(purpose.length).toBe(359);
  const lines = wrapPurpose(purpose);
  expect(lines[3].length).toBeGreaterThan(104); // greedy wrap leaves line 4 too long at 11 pt
  const ws = await read(await buildWorkbook(record('PLS', 'MAYOR', { purpose })));
  // line 4 = A27; floor(11 * 104 / length) — hand-derived from the line length above
  expect(ws.getCell('A27').font.size).toBe(Math.max(8, Math.floor((11 * 104) / lines[3].length)));
  expect(ws.getCell('A25').font.size).toBe(11);
});

// ---------- Phase 7: preview ----------

const cellText = (c) => c.runs.map((r) => r.text).join('');
const colLetter = (n) => String.fromCharCode(64 + n);

test('previewOf: grid, title merge, number runs, name row, image', async () => {
  const p = await previewOf(record('PLS', 'MAYOR'));
  const tpl = new ExcelJS.Workbook();
  await tpl.xlsx.readFile('src/main/templates/pls-mayor.xlsx');
  expect(p.cols).toHaveLength(11);
  expect(p.rows).toHaveLength(48);
  expect(p.cols[2]).toBe(Math.round(tpl.worksheets[0].getColumn('C').width * 7 + 5));
  const at = (row, col) => p.rows[row - 1].cells.find((c) => c.col === col);
  expect(at(10, 1)).toMatchObject({ colSpan: 11, align: 'center' });
  expect(cellText(at(10, 1))).toBe('PERSONNEL LOCATOR SLIP');
  expect(at(10, 2)).toBeUndefined(); // covered by the merge
  expect(at(12, 1).runs.map((r) => r.text)).toEqual(['PLS NO: ', '2026-11-', '7']);
  expect(at(12, 1).runs.slice(1).every((r) => r.underline)).toBe(true);
  expect([cellText(at(14, 1)), cellText(at(14, 5)), cellText(at(14, 8))]).toEqual(['MARIA PEÑA', 'Nurse I', 'Permanent']);
  expect(at(14, 1).border.bottom).toBe(true);
  expect(p.image.src.startsWith('data:image/')).toBe(true);
  expect(p.image.top).toBe(Math.round(25977 / 9525)); // template anchor: row 0, rowOff 25977 EMU
  expect(p.image.width).toBeGreaterThan(500);
});

test.each(['PLS-MAYOR', 'TO-MAYOR', 'PLS-SB', 'TO-SB'])('previewOf %s shows exactly the values of the saved file', async (key) => {
  const [formType, office] = key.split('-');
  const rec = record(formType, office, { vehicle: 'Service vehicle', return_at: '2026-11-22 17:00:00' });
  const p = await previewOf(rec);
  const ws = await read(await buildWorkbook(rec));
  const fromPreview = {};
  p.rows.forEach((row, r) => row.cells.forEach((c) => {
    const t = cellText(c);
    if (t.trim()) fromPreview[`${colLetter(c.col)}${r + 1}`] = t;
  }));
  const fromFile = {};
  for (let r = 1; r <= p.rows.length; r++) {
    for (let c = 1; c <= p.cols.length; c++) {
      const cell = ws.getCell(r, c);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      if (cell.text.trim()) fromFile[cell.address] = cell.text;
    }
  }
  expect(fromPreview).toEqual(fromFile);
});

// ---------- Phase 8: blank stacks ----------

const workbookOf = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
};
const blankOf = (formType, issuingOffice, seq, over = {}) => record(formType, issuingOffice, {
  status: 'blank', seq, number: `${issuingOffice === 'SB' ? 'SB ' : ''}2026-11-${seq}`, date_filed: null, destination: '',
  inclusive_from: null, inclusive_to: null, departure_at: null, purpose: '', employees: [], ...over,
});

describe.each(Object.keys(MAP))('stack %s', (key) => {
  const [form, office] = key.split('-');
  test('one sheet per number, each with its own number, the logo, A4 fit to one page, and all selected', async () => {
    const buffer = await buildStackWorkbook([5, 6, 7].map((n) => blankOf(form, office, n)));
    const wb = await workbookOf(buffer);
    const prefix = office === 'SB' ? 'SB ' : '';
    expect(wb.worksheets.map((w) => w.name)).toEqual([5, 6, 7].map((n) => `${prefix}2026-11-${n}`));
    wb.worksheets.forEach((ws, i) => {
      expect(ws.getCell(MAP[key].number).text).toBe(MAP[key].numberText.replace('-7', `-${5 + i}`));
      expect(ws.getImages()).toHaveLength(1);
      expect(ws.pageSetup).toMatchObject({ fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9, orientation: 'portrait' });
      expect(ws.model.merges.length).toBe(wb.worksheets[0].model.merges.length);
    });
    // Excel prints the selected (grouped) sheets: every sheet selected and the active tab inside the workbook.
    const zip = await JSZip.loadAsync(buffer);
    const sheets = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
    expect(sheets).toHaveLength(3);
    for (const f of sheets) expect(await zip.file(f).async('string')).toContain('tabSelected="1"');
    expect(await zip.file('xl/workbook.xml').async('string')).toMatch(/activeTab="0"/);
  });
});

test("a Mayor's Office blank leaves the recommending signatory as on the paper", async () => {
  const none = { recommending_name: null, recommending_title: null };
  const pls = await read(await buildWorkbook(blankOf('PLS', 'MAYOR', 5, none)));
  expect([pls.getCell('A31').text, pls.getCell('A32').text]).toEqual(['', 'DEPARTMENT HEAD']);
  const to = await read(await buildWorkbook(blankOf('TO', 'MAYOR', 5, none)));
  expect([to.getCell('A29').text, to.getCell('A30').text]).toEqual(['', '']);
  expect(to.getCell('A36').text).toBe('VINCENT E. HERMOSO');
});
