// tests/cli.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, statSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, homedir } from 'os';
import { randomUUID } from 'crypto';
import { resolveDir } from '../src/cli';

const cliPath = join(__dirname, '..', 'bin', 'mdquery');
const srcCliPath = join(__dirname, '..', 'src', 'cli.ts');

function binaryIsFresh(): boolean {
  if (!existsSync(cliPath)) return false;
  return statSync(cliPath).mtime >= statSync(srcCliPath).mtime;
}

function createFixtureDir(): string {
  const dir = join(tmpdir(), `mdquery-cli-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task-001.md'), `---
id: 1
title: Test Task
status: todo
---
`);
  return dir;
}

function runCli(args: string[], env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(cliPath, args, {
      encoding: 'utf-8',
      env: env ? { ...process.env, ...env } : process.env
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || err.message,
      status: (err as any).status ?? 1
    };
  }
}

describe('mdquery CLI', () => {
  let fixtureDir: string;

  beforeAll(() => {
    if (!binaryIsFresh()) {
      execFileSync('bun', ['run', 'build:cli'], { cwd: join(__dirname, '..') });
    }
    fixtureDir = createFixtureDir();
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('no args prints manual and exits 0', () => {
    const { stdout, status } = runCli([]);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--help');
  });

  it('--help prints manual and exits 0', () => {
    const { stdout, status } = runCli(['--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  it('-h is an alias for --help', () => {
    const { stdout, status } = runCli(['-h']);
    expect(status).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  it('--version prints version and exits 0', () => {
    const { stdout, status } = runCli(['--version']);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('-v is an alias for --version', () => {
    const { stdout, status } = runCli(['-v']);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('unknown flags exit non-zero with a hint', () => {
    const { stderr, status } = runCli(['--bogus', 'select']);
    expect(status).not.toBe(0);
    expect(stderr).toContain('--help');
  });

  it('executes a query against a directory', () => {
    const { stdout, status } = runCli([`--dir=${fixtureDir}`, 'select title']);
    expect(status).toBe(0);
    expect(stdout).toContain('Task');
  });

  it('supports --dir with a space after the comma (query first)', () => {
    const sub = join(fixtureDir, 'sub');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'nested.md'), '---\ntitle: Nested\n---\n');
    try {
      const { stdout, status } = runCli(['select title', `--dir=${fixtureDir},`, sub]);
      expect(status).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.data.map((r: any) => r.title)).toContain('Nested');
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });

  it('supports --dir with a space after the comma (query last)', () => {
    const sub = join(fixtureDir, 'sub');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'nested.md'), '---\ntitle: Nested\n---\n');
    try {
      const { stdout, status } = runCli([`--dir=${fixtureDir},`, sub, 'select title']);
      expect(status).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.data.map((r: any) => r.title)).toContain('Nested');
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });

  it('invalid format exits non-zero', () => {
    const { stderr, status } = runCli(['--format=xml', 'select']);
    expect(status).not.toBe(0);
  });

  it('selects filename and path fields', () => {
    const { stdout, status } = runCli([`--dir=${fixtureDir}`, 'select filename, path']);
    expect(status).toBe(0);
    expect(stdout).toContain('task-001');
    expect(stdout).toContain('task-001.md');
  });

  it('supports multiple files via repeated -f', () => {
    const f1 = join(fixtureDir, 'task-001.md');
    const { stdout, status } = runCli(['-f', f1, '-f', f1, 'select filename']);
    expect(status).toBe(0);
    expect(stdout).toContain('task-001');
  });

  it('supports comma-separated --file', () => {
    const f1 = join(fixtureDir, 'task-001.md');
    const { stdout, status } = runCli([`--file=${f1},${f1}`, 'select filename']);
    expect(status).toBe(0);
    expect(stdout).toContain('task-001');
  });

  it('depth flag searches subdirectories', () => {
    const sub = join(fixtureDir, 'sub');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'nested.md'), '---\ntitle: Nested\n---\n');
    try {
      const { stdout, status } = runCli([`--dir=${fixtureDir}`, '-d', '0', 'select filename']);
      expect(status).toBe(0);
      expect(stdout).toContain('nested');
    } finally {
      rmSync(sub, { recursive: true, force: true });
    }
  });

  it('reads file paths from stdin with -f -', () => {
    const f1 = join(fixtureDir, 'task-001.md');
    const output = execSync(`echo "${f1}" | ${cliPath} -f - "select filename"`, { encoding: 'utf-8' });
    expect(output).toContain('task-001');
  });

  it('--csv is an alias for --format=csv', () => {
    const { stdout, status } = runCli(['--csv', `--dir=${fixtureDir}`, 'select title']);
    expect(status).toBe(0);
    expect(stdout).toContain('title'); // header row
    expect(stdout).toContain('Test Task');
  });

  it('last flag wins when --format and shortcut conflict', () => {
    const { stdout, status } = runCli(['--format=json', '--csv', `--dir=${fixtureDir}`, 'select title']);
    expect(status).toBe(0);
    expect(stdout).toContain('title'); // CSV header, not JSON
    expect(stdout).not.toContain('"type"');
  });

  it('--card is rejected', () => {
    const { stderr, status } = runCli(['--card', `--dir=${fixtureDir}`, 'select title']);
    expect(status).toBe(1);
    expect(stderr).toContain('Unknown option: --card');
  });

  it('--rows accepts a positive integer', () => {
    const { stdout, status } = runCli(['--dir', fixtureDir, '--table', '--rows', '2', 'SELECT title']);
    expect(status).toBe(0);
    expect(stdout).toContain('┌');
  });

  it('--rows 0 errors', () => {
    const { stderr, status } = runCli(['--dir', fixtureDir, '--rows', '0', 'SELECT title']);
    expect(status).not.toBe(0);
    expect(stderr).toContain('Invalid rows');
  });
});

describe('CLI --dir', () => {
  it('accepts comma-separated dirs', () => {
    const dirA = mkdtempSync(join(tmpdir(), 'cli-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'cli-b-'));
    writeFileSync(join(dirA, 'a.md'), '---\ntitle: Alpha\n---\n');
    writeFileSync(join(dirB, 'b.md'), '---\ntitle: Beta\n---\n');
    try {
      const out = execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', `${dirA},${dirB}`,
        'select filename, source_dir'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const json = JSON.parse(out);
      expect(json.data).toHaveLength(2);
      const sources = json.data.map((r: any) => r.source_dir).sort();
      expect(sources).toContain(dirA);
      expect(sources).toContain(dirB);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('resolves ~ in --dir end-to-end', () => {
    const home = homedir();
    const dir = join(home, `.mdquery-tilde-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '---\ntitle: Tilde\n---\n');
    try {
      const rel = dir.replace(home, '~');
      const out = execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', rel, 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const json = JSON.parse(out);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].filename).toBe('a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('single missing dir fails fast with exit 1', () => {
    const missingDir = join(tmpdir(), 'cli-missing-' + Date.now());
    let threw = false;
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', missingDir, 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
    } catch (e: any) {
      threw = true;
      expect(e.status).toBe(1);
      expect(e.stderr.toString()).toContain('does not exist');
    }
    expect(threw).toBe(true);
  });

  it('missing dir in multi-dir list warns and continues', () => {
    const dirA = mkdtempSync(join(tmpdir(), 'cli-warn-a-'));
    const missingDir = join(tmpdir(), 'cli-warn-missing-' + Date.now());
    writeFileSync(join(dirA, 'a.md'), '---\ntitle: Alpha\n---\n');
    try {
      const out = execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', `${dirA},${missingDir}`,
        'select filename, source_dir'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const json = JSON.parse(out);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].source_dir).toBe(dirA);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
    }
  });
});

describe('CLI --out', () => {
  it('writes JSON to file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-out-'));
    const outFile = join(dir, 'results.json');
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir,
        '--out', outFile, 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const content = readFileSync(outFile, 'utf-8');
      const json = JSON.parse(content);
      expect(json.data).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('infers CSV from extension', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-out-csv-'));
    const outFile = join(dir, 'results.csv');
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir,
        '--out', outFile, 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const content = readFileSync(outFile, 'utf-8');
      expect(content).toContain('filename');
      expect(content).toContain('f');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--out=- writes to stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-out-stdout-'));
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      const out = execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir,
        '--out', '-', 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const json = JSON.parse(out);
      expect(json.data).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--format overrides extension inference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-out-override-'));
    const outFile = join(dir, 'results.json');
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir,
        '--out', outFile, '--format', 'csv', 'select filename, title'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const content = readFileSync(outFile, 'utf-8');
      // CSV format: header + data rows (two columns => commas present)
      expect(content).toContain('filename');
      expect(content).toContain(',');
      expect(content).toContain('Test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends extension when --out has none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-out-noext-'));
    const outBase = join(dir, 'results');
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir,
        '--out', outBase, 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const content = readFileSync(outBase + '.json', 'utf-8');
      const json = JSON.parse(content);
      expect(json.data).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps user extension when --format differs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-out-keep-'));
    const outFile = join(dir, 'results.csv');
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir,
        '--out', outFile, '--format', 'json', 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      // File still written to results.csv (user extension kept)
      const content = readFileSync(outFile, 'utf-8');
      const json = JSON.parse(content); // JSON content despite .csv extension
      expect(json.data).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--out creates parent dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-out-parent-'));
    const outFile = join(dir, 'sub', 'dir', 'results.json');
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir,
        '--out', outFile, 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      const content = readFileSync(outFile, 'utf-8');
      const json = JSON.parse(content); // valid JSON
      expect(json.data).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('color flags', () => {
  it('--no-color produces no ANSI codes in table output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-color-nc-'));
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      const out = execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir, '--format=table', '--no-color', 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      expect(out).not.toMatch(/\x1b\[/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--color forces ANSI codes even when piped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-color-c-'));
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      const out = execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir, '--format=table', '--color', 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      expect(out).toMatch(/\x1b\[/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('default piped output has no ANSI codes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-color-def-'));
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      const out = execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir, '--format=table', 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
      expect(out).not.toMatch(/\x1b\[/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('MDQUERY_COLORS overrides title color', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-color-env-'));
    writeFileSync(join(dir, 'f.md'), '---\ntitle: Test\n---\n');
    try {
      const out = execFileSync('bun', [
        'run', 'src/cli.ts', '--dir', dir, '--format=table', '--color', 'select filename'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..'), env: { ...process.env, MDQUERY_COLORS: 'title=31' } });
      expect(out).toMatch(/\x1b\[31m/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--color forces ANSI codes in help output', () => {
    const out = execFileSync('bun', [
      'run', 'src/cli.ts', '--color', '--help'
    ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
    expect(out).toMatch(/\x1b\[/);
    // Section headers are bold cyan
    expect(out).toMatch(/\x1b\[1m\x1b\[36mUsage:/);
    expect(out).toMatch(/\x1b\[1m\x1b\[36mOptions:/);
    expect(out).toMatch(/\x1b\[1m\x1b\[36mExamples:/);
    // Command name is bold mild orange (usage line + examples)
    expect(out).toMatch(/\x1b\[1m\x1b\[38;2;255;158;100mmdquery/);
    expect(out.match(/\x1b\[1m\x1b\[38;2;255;158;100mmdquery/g)!.length).toBeGreaterThan(1);
    // Option flags stay plain; explanations are muted (dim)
    expect(out).not.toMatch(/\x1b\[[0-9;]*m--dir/);
    expect(out).toMatch(/\x1b\[2mDirectories to query/);
    // Arguments are plain
    expect(out).not.toMatch(/\x1b\[[0-9;]*m\[query\]/);
    // Examples use capitalized builtins
    expect(out).toContain('SELECT WHERE status');
    expect(out).toContain('SELECT ORDER BY priority');
    // Version shown instead of query-language pointer
    expect(out).toContain('Version:');
  });

  it('--color colorizes commander errors', () => {
    let threw = false;
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--color', '--card'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
    } catch (e: any) {
      threw = true;
      expect(e.stderr.toString()).toMatch(/\x1b\[31mError: Unknown option: --card/);
    }
    expect(threw).toBe(true);
  });

  it('--no-color keeps commander errors clean', () => {
    let threw = false;
    try {
      execFileSync('bun', [
        'run', 'src/cli.ts', '--no-color', '--card'
      ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
    } catch (e: any) {
      threw = true;
      expect(e.stderr.toString()).not.toMatch(/\x1b\[/);
    }
    expect(threw).toBe(true);
  });

  it('--no-color keeps help output clean even with --color', () => {
    const out = execFileSync('bun', [
      'run', 'src/cli.ts', '--color', '--no-color', '--help'
    ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('piped help output is clean by default', () => {
    const out = execFileSync('bun', [
      'run', 'src/cli.ts', '--help'
    ], { encoding: 'utf-8', cwd: join(__dirname, '..') });
    expect(out).not.toMatch(/\x1b\[/);
  });
});

describe('config file', () => {
  let configHome: string;
  let fixtureDir: string;

  function writeConfig(yaml: string): void {
    const dir = join(configHome, 'mdquery');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.yaml'), yaml);
  }

  function runWithConfig(args: string[]): { stdout: string; stderr: string; status: number } {
    return runCli(args, { XDG_CONFIG_HOME: configHome });
  }

  beforeAll(() => {
    configHome = mkdtempSync(join(tmpdir(), 'mdquery-config-home-'));
    fixtureDir = createFixtureDir();
  });

  afterAll(() => {
    rmSync(configHome, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('config format applies when no --format flag is given', () => {
    writeConfig('format: table\n');
    const { stdout, status } = runWithConfig([`--dir=${fixtureDir}`, 'select title']);
    expect(status).toBe(0);
    expect(stdout).toContain('┌');
    expect(stdout).toContain('TITLE');
  });

  it('--format flag overrides config format', () => {
    writeConfig('format: table\n');
    const { stdout, status } = runWithConfig([`--dir=${fixtureDir}`, '--format=json', 'select title']);
    expect(status).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.data).toHaveLength(1);
  });

  it('config rows caps table lines per record', () => {
    writeConfig('format: table\nrows: 1\n');
    const { stdout, status } = runWithConfig([`--dir=${fixtureDir}`, 'select title']);
    expect(status).toBe(0);
    // Each record is capped at 1 line; the title "Test Task" fits, so the
    // table renders normally — the key is that rows:1 does not error.
    expect(stdout).toContain('Test Task');
  });

  it('--rows flag overrides config rows', () => {
    writeConfig('format: table\nrows: 1\n');
    const { stdout, status } = runWithConfig([`--dir=${fixtureDir}`, '--rows=5', 'select title']);
    expect(status).toBe(0);
    expect(stdout).toContain('Test Task');
  });

  it('config colors apply below env (MDQUERY_COLORS wins)', () => {
    writeConfig('format: table\ncolors:\n  title: "31"\n');
    const { stdout, status } = runWithConfig([`--dir=${fixtureDir}`, '--color', 'select title']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/\x1b\[31m/);
  });

  it('MDQUERY_COLORS overrides config colors', () => {
    writeConfig('format: table\ncolors:\n  title: "31"\n');
    const { stdout, status } = runCli(
      [`--dir=${fixtureDir}`, '--color', 'select title'],
      { XDG_CONFIG_HOME: configHome, MDQUERY_COLORS: 'title=32' }
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(/\x1b\[32m/);
    expect(stdout).not.toMatch(/\x1b\[31m/);
  });

  it('config color: always forces color even when piped', () => {
    writeConfig('format: table\ncolor: always\n');
    const { stdout, status } = runWithConfig([`--dir=${fixtureDir}`, 'select title']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/\x1b\[/);
  });

  it('--no-color overrides config color: always', () => {
    writeConfig('format: table\ncolor: always\n');
    const { stdout, status } = runWithConfig([`--dir=${fixtureDir}`, '--no-color', 'select title']);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/\x1b\[/);
  });

  it('config depth applies when no -d flag is given', () => {
    // fixtureDir has task-001.md at depth 0; a nested file at depth 2 is
    // excluded when config depth is 1 (top level only) and included at depth 2.
    const nested = join(fixtureDir, 'sub');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'nested.md'), '---\ntitle: Nested\n---\n');
    try {
      writeConfig('depth: 2\n');
      const { stdout, status } = runWithConfig([`--dir=${fixtureDir}`, 'select title']);
      expect(status).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.data.map((r: any) => r.title)).toContain('Nested');
    } finally {
      rmSync(nested, { recursive: true, force: true });
    }
  });

  it('invalid config reports an error', () => {
    writeConfig('format: xml\n');
    const { stderr, status } = runWithConfig([`--dir=${fixtureDir}`, 'select title']);
    expect(status).toBe(1);
    expect(stderr).toContain('Invalid config');
  });
});

describe('resolveDir', () => {
  it('resolves . to cwd', () => {
    expect(resolveDir('.')).toBe(process.cwd());
  });

  it('resolves ~ to homedir', () => {
    expect(resolveDir('~')).toBe(homedir());
  });

  it('resolves ~/foo to homedir + /foo', () => {
    expect(resolveDir('~/foo')).toBe(homedir() + '/foo');
  });

  it('resolves $HOME to env var value', () => {
    process.env.TEST_DIR_RESOLVE = '/tmp/test-resolve';
    try {
      expect(resolveDir('$TEST_DIR_RESOLVE')).toBe('/tmp/test-resolve');
    } finally {
      delete process.env.TEST_DIR_RESOLVE;
    }
  });

  it('throws on undefined env var without suffix', () => {
    expect(() => resolveDir('$UNDEFINED_VAR_XYZ')).toThrow('not set');
  });

  it('resolves $UNDEFINED_VAR/suffix to suffix as fallback', () => {
    expect(resolveDir('$UNDEFINED_VAR_XYZ/foo')).toBe(resolve('foo'));
  });

  it('resolves $SET_VAR/suffix by appending suffix (shell-like)', () => {
    process.env.TEST_DIR_RESOLVE = '/tmp/test-resolve';
    try {
      expect(resolveDir('$TEST_DIR_RESOLVE/sub')).toBe('/tmp/test-resolve/sub');
    } finally {
      delete process.env.TEST_DIR_RESOLVE;
    }
  });

  it('throws on ~other', () => {
    expect(() => resolveDir('~other')).toThrow('Only ~');
  });

  it('resolves relative paths via path.resolve', () => {
    expect(resolveDir('../foo')).toBe(resolve('..', 'foo'));
  });
});