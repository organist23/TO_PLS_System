import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/main/config.js';

const KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const tmpEnv = (text) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plsto-')), '.env');
  fs.writeFileSync(file, text);
  return file;
};

describe('loadConfig', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
    return () => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  });

  test('defaults when no file', () => {
    expect(loadConfig('C:/nope/.env')).toEqual({
      host: 'localhost', port: 3306, user: 'root', password: '', database: 'pls_to',
    });
  });

  test('file overrides defaults', () => {
    const cfg = loadConfig(tmpEnv('DB_NAME=pls_to_x\nDB_PORT=3307\n'));
    expect(cfg.database).toBe('pls_to_x');
    expect(cfg.port).toBe(3307);
  });

  test('env var beats file', () => {
    process.env.DB_NAME = 'pls_to_env';
    expect(loadConfig(tmpEnv('DB_NAME=pls_to_x\n')).database).toBe('pls_to_env');
  });
});
