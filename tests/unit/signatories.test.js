import { test, expect, beforeEach, afterEach } from 'vitest';
import { freshTestDb } from '../helpers/testDb.js';
import * as s from '../../src/main/signatories.js';

let pool;
beforeEach(async () => (pool = await freshTestDb()));
afterEach(() => pool.end());

const add = async (name, title, role) => (await s.createSignatory(pool, { name, title, role })).data.id;
const names = (res) => res.data.map((r) => r.name);

test('name and title required, role must be valid', async () => {
  expect((await s.createSignatory(pool, { name: ' ', title: '', role: 'approving' })).errors).toEqual({
    name: 'Required', title: 'Required',
  });
  expect((await s.createSignatory(pool, { name: 'A', title: 'B', role: 'boss' })).errors).toEqual({ role: 'Choose a role' });
});

test('duplicate active and archived signatories', async () => {
  const id = await add('GLENDA P. MINA', 'SB SECRETARY', 'recommending');
  expect((await s.createSignatory(pool, { name: 'glenda p.  mina', title: 'SB SECRETARY', role: 'recommending' })).errors).toEqual({
    name: 'This signatory already exists',
  });
  await s.archiveSignatory(pool, { id });
  expect((await s.createSignatory(pool, { name: 'GLENDA P. MINA', title: 'SB SECRETARY', role: 'recommending' })).errors).toEqual({
    name: 'This signatory is archived. Restore it instead.',
  });
});

test('same person may hold two roles or titles', async () => {
  await add('ARNEL A. HERRERA', 'OIC-MUNICIPAL VICE MAYOR', 'approving');
  expect((await s.createSignatory(pool, { name: 'ARNEL A. HERRERA', title: 'SB MEMBER', role: 'recommending' })).ok).toBe(true);
});

test('update changes name and title', async () => {
  const id = await add('X', 'MAYOR', 'approving');
  expect((await s.updateSignatory(pool, { id, name: 'VINCENT E. HERMOSO', title: 'OIC - MUNICIPAL MAYOR', role: 'approving' })).ok).toBe(true);
  expect((await s.listSignatories(pool, {})).data[0]).toMatchObject({ name: 'VINCENT E. HERMOSO', title: 'OIC - MUNICIPAL MAYOR' });
});

test('archive and restore with archived filter', async () => {
  const id = await add('A', 'T', 'approving');
  expect((await s.archiveSignatory(pool, { id })).ok).toBe(true);
  expect(names(await s.listSignatories(pool, {}))).toEqual([]);
  expect(names(await s.listSignatories(pool, { archived: true }))).toEqual(['A']);
  await s.restoreSignatory(pool, { id });
  expect(names(await s.listSignatories(pool, {}))).toEqual(['A']);
});

test('list filters by role', async () => {
  await add('R', 'T', 'recommending');
  await add('P', 'T', 'approving');
  expect(names(await s.listSignatories(pool, { role: 'approving' }))).toEqual(['P']);
});

test('defaults start empty and can be set', async () => {
  expect((await s.getDefaults(pool)).data).toEqual({
    MAYOR: { recommending: null, approving: null },
    SB: { recommending: null, approving: null },
  });
  const r = await add('R', 'DEPARTMENT HEAD', 'recommending');
  const a = await add('A', 'MUNICIPAL MAYOR', 'approving');
  await s.setDefault(pool, { issuingOffice: 'MAYOR', role: 'recommending', signatoryId: r });
  await s.setDefault(pool, { issuingOffice: 'MAYOR', role: 'approving', signatoryId: a });
  expect((await s.getDefaults(pool)).data.MAYOR).toEqual({ recommending: r, approving: a });
  const a2 = await add('B', 'OIC - MUNICIPAL MAYOR', 'approving');
  await s.setDefault(pool, { issuingOffice: 'MAYOR', role: 'approving', signatoryId: a2 });
  expect((await s.getDefaults(pool)).data.MAYOR.approving).toBe(a2);
});

test('setDefault rejects wrong role, archived, unknown office', async () => {
  const r = await add('R', 'T', 'recommending');
  const a = await add('A', 'T', 'approving');
  expect((await s.setDefault(pool, { issuingOffice: 'MAYOR', role: 'approving', signatoryId: r })).errors).toEqual({
    signatoryId: 'Choose an active approving signatory',
  });
  await s.archiveSignatory(pool, { id: a });
  expect((await s.setDefault(pool, { issuingOffice: 'SB', role: 'approving', signatoryId: a })).errors).toEqual({
    signatoryId: 'Choose an active approving signatory',
  });
  expect(await s.setDefault(pool, { issuingOffice: 'CITY', role: 'approving', signatoryId: r })).toEqual({ ok: false, error: 'Invalid default' });
});

test('archive and role change blocked while default', async () => {
  const a = await add('A', 'VICE MAYOR', 'approving');
  await s.setDefault(pool, { issuingOffice: 'SB', role: 'approving', signatoryId: a });
  expect(await s.archiveSignatory(pool, { id: a })).toEqual({
    ok: false, error: 'It is the default for Sangguniang Bayan. Choose another default first.',
  });
  expect(await s.updateSignatory(pool, { id: a, name: 'A', title: 'VICE MAYOR', role: 'recommending' })).toEqual({
    ok: false, error: 'It is the default for Sangguniang Bayan. Choose another default first.',
  });
  expect(names(await s.listSignatories(pool, {}))).toEqual(['A']);
});
