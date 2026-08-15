// tests/cli.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, statSync, existsSync } from 'fs';
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

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(cliPath, args, { encoding: 'utf-8' });
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

  it('throws on undefined env var without fallback', () => {
    expect(() => resolveDir('$UNDEFINED_VAR_XYZ')).toThrow('not set');
  });

  it('resolves $UNDEFINED_VAR/fallback to fallback', () => {
    expect(resolveDir('$UNDEFINED_VAR_XYZ/foo')).toBe(resolve('foo'));
  });

  it('throws on ~other', () => {
    expect(() => resolveDir('~other')).toThrow('Only ~');
  });

  it('resolves relative paths via path.resolve', () => {
    expect(resolveDir('../foo')).toBe(resolve('..', 'foo'));
  });
});