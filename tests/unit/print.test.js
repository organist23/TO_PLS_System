import { test, expect, describe } from 'vitest';
import ExcelJS from 'exceljs';
import { formatDate, formatRange, formatTime, wrapPurpose, buildWorkbook } from '../../src/main/print.js';

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
