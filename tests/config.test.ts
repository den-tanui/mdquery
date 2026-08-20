// tests/config.test.ts

import { randomUUID } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resolveConfigPath, validateConfig } from '../src/config';

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
      depth: 2,
      hidden: true,
      ignore: false,
      format: 'table',
      color: 'always',
      compact: true,
      rows: 5,
      columns: '20,*,40',
      colors: { title: '31', border: '90' },
      table: {
        trim: false,
        'title-formatting': 'pascal-case',
        colors: { header: '01;35', separator: '90', cell: '' },
        normalize: false,
      },
    });
    expect(c).toEqual({
      depth: 2,
      hidden: true,
      ignore: false,
      format: 'table',
      color: 'always',
      compact: true,
      rows: 5,
      columns: '20,*,40',
      colors: { title: '31', border: '90' },
      table: {
        trim: false,
        'title-formatting': 'pascal-case',
        colors: { header: '01;35', separator: '90', cell: '' },
        normalize: false,
      },
    });
  });

  it('ignores unknown keys (forward compatible)', () => {
    const c = validateConfig({ futureKey: 'x', format: 'json' });
    expect(c).toEqual({ format: 'json' });
  });

  it('throws on wrong types', () => {
    expect(() => validateConfig({ depth: 'deep' })).toThrow(
      'Invalid config: depth must be a number',
    );
    expect(() => validateConfig({ hidden: 'yes' })).toThrow(
      'Invalid config: hidden must be a boolean',
    );
    expect(() => validateConfig({ format: 'xml' })).toThrow(
      'Invalid config: format must be one of: json, table, csv',
    );
    expect(() => validateConfig({ color: 'sometimes' })).toThrow(
      'Invalid config: color must be one of: auto, always, never',
    );
    expect(() => validateConfig({ colors: { title: 7 } })).toThrow(
      'Invalid config: colors.title must be a string',
    );
  });

  it('validates the table group', () => {
    expect(() => validateConfig({ table: { trim: 'yes' } })).toThrow(
      'Invalid config: table.trim must be a boolean',
    );
    expect(() => validateConfig({ table: { 'title-formatting': 'title' } })).toThrow(
      'Invalid config: table.title-formatting must be one of: none, upper, capitalize, camel-case, pascal-case',
    );
    expect(() => validateConfig({ table: { colors: { header: 7 } } })).toThrow(
      'Invalid config: table.colors.header must be a string',
    );
    expect(() => validateConfig({ table: 'nope' })).toThrow(
      'Invalid config: table must be a mapping',
    );
    expect(() => validateConfig({ table: { normalize: 'yes' } })).toThrow(
      'Invalid config: table.normalize must be a boolean',
    );
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
