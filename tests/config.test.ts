// tests/config.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { resolveConfigPath, loadConfig, validateConfig } from '../src/config';

describe('resolveConfigPath', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    const p = resolveConfigPath({ XDG_CONFIG_HOME: '/tmp/xdg' } as NodeJS.ProcessEnv);
    expect(p).toBe(join('/tmp/xdg', 'mdquery', 'config.yaml'));
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    const p = resolveConfigPath({} as NodeJS.ProcessEnv);
    expect(p).toBe(join(require('os').homedir(), '.config', 'mdquery', 'config.yaml'));
  });

  it('ignores empty XDG_CONFIG_HOME', () => {
    const p = resolveConfigPath({ XDG_CONFIG_HOME: '' } as NodeJS.ProcessEnv);
    expect(p).toBe(join(require('os').homedir(), '.config', 'mdquery', 'config.yaml'));
  });
});

describe('validateConfig', () => {
  it('parses a full config', () => {
    const c = validateConfig({
      dir: ['./tasks', './notes'],
      depth: 2,
      hidden: true,
      ignore: false,
      format: 'table',
      color: 'always',
      compact: true,
      rows: 5,
      columns: '20,*,40',
      colors: { title: '31', border: '90' },
    });
    expect(c).toEqual({
      dir: ['./tasks', './notes'],
      depth: 2,
      hidden: true,
      ignore: false,
      format: 'table',
      color: 'always',
      compact: true,
      rows: 5,
      columns: '20,*,40',
      colors: { title: '31', border: '90' },
    });
  });

  it('accepts a single string for dir', () => {
    const c = validateConfig({ dir: './tasks' });
    expect(c.dir).toEqual(['./tasks']);
  });

  it('ignores unknown keys (forward compatible)', () => {
    const c = validateConfig({ futureKey: 'x', format: 'json' });
    expect(c).toEqual({ format: 'json' });
  });

  it('throws on wrong types', () => {
    expect(() => validateConfig({ depth: 'deep' })).toThrow('Invalid config: depth must be a number');
    expect(() => validateConfig({ hidden: 'yes' })).toThrow('Invalid config: hidden must be a boolean');
    expect(() => validateConfig({ format: 'xml' })).toThrow('Invalid config: format must be one of: json, table, csv');
    expect(() => validateConfig({ color: 'sometimes' })).toThrow('Invalid config: color must be one of: auto, always, never');
    expect(() => validateConfig({ dir: 42 })).toThrow('Invalid config: dir must be a string or array of strings');
    expect(() => validateConfig({ colors: { title: 7 } })).toThrow('Invalid config: colors.title must be a string');
  });
});

describe('loadConfig', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `mdquery-config-test-${randomUUID()}`));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the file is missing', async () => {
    expect(await loadConfig(join(dir, 'nope.yaml'))).toBeNull();
  });

  it('loads a valid YAML config', async () => {
    const p = join(dir, 'config.yaml');
    writeFileSync(p, 'format: table\nrows: 3\ncolors:\n  title: "31"\n');
    const c = await loadConfig(p);
    expect(c).toEqual({ format: 'table', rows: 3, colors: { title: '31' } });
  });

  it('throws on malformed YAML', async () => {
    const p = join(dir, 'bad.yaml');
    writeFileSync(p, 'format: [unclosed\n');
    await expect(loadConfig(p)).rejects.toThrow();
  });

  it('throws on non-mapping top level', async () => {
    const p = join(dir, 'list.yaml');
    writeFileSync(p, '- a\n- b\n');
    await expect(loadConfig(p)).rejects.toThrow('expected a YAML mapping');
  });
});