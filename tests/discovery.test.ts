// tests/discovery.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FileOps } from '../src/files';
import { Executor } from '../src/executor';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

function makeTree(): string {
  const root = join(tmpdir(), `mdquery-disc-${randomUUID()}`);
  mkdirSync(join(root, 'sub', 'deep'), { recursive: true });
  mkdirSync(join(root, '.hidden'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });

  writeFileSync(join(root, 'top.md'), '---\ntitle: Top\n---\n');
  writeFileSync(join(root, 'sub', 'mid.md'), '---\ntitle: Mid\n---\n');
  writeFileSync(join(root, 'sub', 'deep', 'deep.md'), '---\ntitle: Deep\n---\n');
  writeFileSync(join(root, '.hidden', 'secret.md'), '---\ntitle: Secret\n---\n');
  writeFileSync(join(root, 'node_modules', 'dep.md'), '---\ntitle: Dep\n---\n');
  writeFileSync(join(root, 'ignored.md'), '---\ntitle: Ignored\n---\n');
  writeFileSync(join(root, '.gitignore'), 'ignored.md\nnode_modules/\n');
  return root;
}

describe('FileOps discovery', () => {
  let dir: string;

  beforeAll(() => {
    dir = makeTree();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('depth 0 (default) only reads top-level files', async () => {
    const files = await FileOps.readFiles(dir);
    const names = files.map(f => f.filename).sort();
    expect(names).toEqual(['top']);
  });

  it('depth 1 reads one subdirectory level', async () => {
    const files = await FileOps.readFiles(dir, { depth: 1 });
    const names = files.map(f => f.filename).sort();
    expect(names).toEqual(['mid', 'top']);
  });

  it('depth -1 reads recursively', async () => {
    const files = await FileOps.readFiles(dir, { depth: -1 });
    const names = files.map(f => f.filename).sort();
    expect(names).toEqual(['deep', 'mid', 'top']);
  });

  it('hidden files are skipped by default and included with hidden: true', async () => {
    const without = await FileOps.readFiles(dir, { depth: -1 });
    expect(without.some(f => f.filename === 'secret')).toBe(false);

    const withHidden = await FileOps.readFiles(dir, { depth: -1, hidden: true });
    expect(withHidden.some(f => f.filename === 'secret')).toBe(true);
  });

  it('respects .gitignore by default', async () => {
    const files = await FileOps.readFiles(dir, { depth: -1 });
    expect(files.some(f => f.filename === 'ignored')).toBe(false);
    expect(files.some(f => f.filename === 'dep')).toBe(false);
  });

  it('ignore: false includes gitignored files', async () => {
    const files = await FileOps.readFiles(dir, { depth: -1, ignore: false });
    expect(files.some(f => f.filename === 'ignored')).toBe(true);
  });

  it('always skips .git', async () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'config.md'), '---\ntitle: Git\n---\n');
    const files = await FileOps.readFiles(dir, { depth: -1, hidden: true, ignore: false });
    expect(files.some(f => f.filename === 'config')).toBe(false);
  });

  it('explicit file list overrides directory walking', async () => {
    const files = await FileOps.readFiles(dir, { files: [join(dir, 'sub', 'mid.md')] });
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('mid');
  });

  it('exposes filename, path, abspath', async () => {
    const files = await FileOps.readFiles(dir, { depth: 1 });
    const mid = files.find(f => f.filename === 'mid')!;
    expect(mid.path).toBe(join('sub', 'mid.md'));
    expect(mid.abspath).toBe(join(dir, 'sub', 'mid.md'));
    expect(mid.filepath).toBe(mid.abspath);
  });
});

describe('Executor with discovery options', () => {
  let dir: string;

  beforeAll(() => {
    dir = makeTree();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('select respects depth option', async () => {
    const executor = new Executor(dir, undefined, undefined, { depth: -1 });
    const result = await executor.execute('select filename');
    const names = result.data!.map(f => f.filename).sort();
    expect(names).toEqual(['deep', 'mid', 'top']);
  });

  it('update without matches errors with a helpful message', async () => {
    const executor = new Executor(dir);
    await expect(executor.execute('update where filename = "nope" set title = "x"'))
      .rejects.toThrow("no file with filename 'nope'");
  });

  it('delete without matches errors', async () => {
    const executor = new Executor(dir);
    await expect(executor.execute('delete where filename = "nope"'))
      .rejects.toThrow("no file with filename 'nope'");
  });

  it('update preserves the original file path', async () => {
    const executor = new Executor(dir);
    await executor.execute('update where filename = "top" set title = "Updated"');
    const files = await FileOps.readFiles(dir);
    const top = files.find(f => f.filename === 'top')!;
    expect(top.title).toBe('Updated');
    expect(top.path).toBe('top.md');
  });

  it('create with file writes to the dir', async () => {
    const executor = new Executor(dir);
    await executor.execute('create title = "New" file = "brand-new"');
    const files = await FileOps.readFiles(dir);
    expect(files.some(f => f.filename === 'brand-new')).toBe(true);
  });

  it('create with path writes to a relative path', async () => {
    const executor = new Executor(dir);
    await executor.execute('create title = "Nested" path = "sub/created.md"');
    const files = await FileOps.readFiles(dir, { depth: -1 });
    expect(files.some(f => f.path === join('sub', 'created.md'))).toBe(true);
  });
});