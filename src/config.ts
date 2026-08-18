// src/config.ts
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

export type TitleFormat = 'none' | 'upper' | 'capitalize' | 'camel-case' | 'pascal-case';

export interface TableConfig {
  trim?: boolean;
  'title-formatting'?: TitleFormat;
  colors?: Record<string, string>;
  normalize?: boolean;
}

export interface Config {
  depth?: number;
  hidden?: boolean;
  ignore?: boolean;
  format?: 'json' | 'table' | 'csv';
  color?: 'auto' | 'always' | 'never';
  compact?: boolean;
  rows?: number;
  columns?: string;
  colors?: Record<string, string>;
  table?: TableConfig;
}

// Resolve the config file path: $XDG_CONFIG_HOME/mdquery/config.yaml or
// ~/.config/mdquery/config.yaml when XDG_CONFIG_HOME is unset.
export function resolveConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : join(homedir(), '.config');
  return join(base, 'mdquery', 'config.yaml');
}

// Load and validate the config file. Returns null when the file is missing.
export async function loadConfig(path?: string): Promise<Config | null> {
  const configPath = path ?? resolveConfigPath();
  if (!existsSync(configPath)) return null;
  const raw = await readFile(configPath, 'utf-8');
  const parsed = yamlLoad(raw);
  if (parsed == null) return null;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid config: expected a YAML mapping at the top level');
  }
  return validateConfig(parsed as Record<string, unknown>);
}

// Validate and normalize raw YAML into a typed Config. Unknown keys are
// ignored (forward-compatible); wrong types throw with a clear message.
export function validateConfig(raw: Record<string, unknown>): Config {
  const config: Config = {};
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'depth':
        config.depth = expectNumber(value, key);
        break;
      case 'hidden':
        config.hidden = expectBoolean(value, key);
        break;
      case 'ignore':
        config.ignore = expectBoolean(value, key);
        break;
      case 'format':
        config.format = expectEnum(value, key, ['json', 'table', 'csv'] as const);
        break;
      case 'color':
        config.color = expectEnum(value, key, ['auto', 'always', 'never'] as const);
        break;
      case 'compact':
        config.compact = expectBoolean(value, key);
        break;
      case 'rows':
        config.rows = expectNumber(value, key);
        break;
      case 'columns':
        config.columns = expectString(value, key);
        break;
      case 'colors':
        config.colors = expectStringMap(value, key);
        break;
      case 'table':
        config.table = expectTableConfig(value, key);
        break;
      default:
        // Unknown keys are ignored for forward compatibility
        break;
    }
  }
  return config;
}

function expectString(value: unknown, key: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid config: ${key} must be a string`);
  return value;
}

function expectNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid config: ${key} must be a number`);
  }
  return value;
}

function expectBoolean(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid config: ${key} must be a boolean`);
  return value;
}

function expectEnum<T extends string>(value: unknown, key: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid config: ${key} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function expectStringMap(value: unknown, key: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid config: ${key} must be a mapping of string to string`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') throw new Error(`Invalid config: ${key}.${k} must be a string`);
    out[k] = v;
  }
  return out;
}

function expectTableConfig(value: unknown, key: string): TableConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid config: ${key} must be a mapping`);
  }
  const table: TableConfig = {};
  for (const [k, v] of Object.entries(value)) {
    switch (k) {
      case 'trim':
        table.trim = expectBoolean(v, `${key}.trim`);
        break;
      case 'title-formatting':
        table['title-formatting'] = expectEnum(v, `${key}.title-formatting`, ['none', 'upper', 'capitalize', 'camel-case', 'pascal-case'] as const);
        break;
      case 'colors':
        table.colors = expectStringMap(v, `${key}.colors`);
        break;
      case 'normalize':
        table.normalize = expectBoolean(v, `${key}.normalize`);
        break;
      default:
        // Unknown table keys are ignored for forward compatibility
        break;
    }
  }
  return table;
}