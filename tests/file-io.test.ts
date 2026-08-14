// tests/file-io.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastFileOps } from '../src/file-io';
import { Executor } from '../src/executor';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

function makeTree(): string {
  const root = join(tmpdir(), `mdquery-fio-${randomUUID()}`);
  mkdirSync(join(root, 'sub', 'deep'), { recursive: true });
  mkdirSync(join(root, '.hidden'), { recursive: true });
  writeFileSync(join(root, 'top.md'), '---\ntitle: Top\n---\n');
  writeFileSync(join(root, 'sub', 'mid.md'), '---\ntitle: Mid\n---\n');
  writeFileSync(join(root, 'sub', 'deep', 'deep.md'), '---\ntitle: Deep\n---\n');
  writeFileSync(join(root, '.hidden', 'secret.md'), '---\ntitle: Secret\n---\n');
  writeFileSync(join(root, '.secret.md'), '---\ntitle: Secret File\n---\n');
  writeFileSync(join(root, 'notes.txt'), 'not markdown');
  return root;
}

function makeGitignoreTree(): string {
  const root = join(tmpdir(), `mdquery-fio-gi-${randomUUID()}`);
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'sub/\n');
  writeFileSync(join(root, 'top.md'), '---\ntitle: Top\n---\n');
  writeFileSync(join(root, 'sub', 'mid.md'), '---\ntitle: Mid\n---\n');
  writeFileSync(join(root, '.git', 'config.md'), '---\ntitle: Git Config\n---\n');
  return root;
}

describe('FastFileOps.listFiles', () => {
  let dir: string;
  beforeAll(() => { dir = makeTree(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('lists only .md files recursively by default', async () => {
    const files = await FastFileOps.listFiles(dir);
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['sub/deep/deep.md', 'sub/mid.md', 'top.md']);
  });

  it('respects depth 1 (top level only)', async () => {
    const files = await FastFileOps.listFiles(dir, { depth: 1 });
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['top.md']);
  });

  it('respects depth 2 (one subdirectory level)', async () => {
    const files = await FastFileOps.listFiles(dir, { depth: 2 });
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['sub/mid.md', 'top.md']);
  });

  it('skips hidden files by default, includes with hidden: true', async () => {
    const without = await FastFileOps.listFiles(dir);
    expect(without.some(f => f.includes('secret'))).toBe(false);
    const withHidden = await FastFileOps.listFiles(dir, { hidden: true });
    expect(withHidden.some(f => f.includes('secret'))).toBe(true);
  });

  it('returns absolute paths', async () => {
    const files = await FastFileOps.listFiles(dir);
    expect(files[0]).toMatch(/^\/.*\.md$/);
  });
});

describe('FastFileOps.listFiles gitignore + .git handling', () => {
  let dir: string;
  beforeAll(() => { dir = makeGitignoreTree(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('respects .gitignore (excludes sub/)', async () => {
    const files = await FastFileOps.listFiles(dir);
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['top.md']);
  });

  it('includes gitignored files when ignore: false', async () => {
    const files = await FastFileOps.listFiles(dir, { ignore: false });
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['sub/mid.md', 'top.md']);
  });

  it('always skips .git even with hidden: true', async () => {
    const files = await FastFileOps.listFiles(dir, { hidden: true });
    expect(files.some(f => f.includes('.git'))).toBe(false);
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['top.md']);
  });
});

describe('FastFileOps.readFiles', () => {
  let dir: string;
  beforeAll(() => { dir = makeTree(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads frontmatter always, body only when requiresContent', async () => {
    const paths = await FastFileOps.listFiles(dir, { depth: 1 });

    const noBody = await FastFileOps.readFiles(dir, paths, { requiresContent: false, bodyPredicates: [] });
    expect(noBody[0].title).toBe('Top');
    expect(noBody[0].body).toBeUndefined();
    expect(noBody[0].sections).toBeUndefined();
    expect(noBody[0].content).toBeDefined();

    const withBody = await FastFileOps.readFiles(dir, paths, { requiresContent: true, bodyPredicates: [] });
    // top.md's body is empty (frontmatter only), so assert it is defined rather
    // than containing a specific string.
    expect(withBody[0].body).toBeDefined();
    expect(withBody[0].sections).toBeDefined();
  });

  it('exposes filename, path, abspath, frontmatter', async () => {
    const paths = await FastFileOps.listFiles(dir, { depth: 1 });
    const files = await FastFileOps.readFiles(dir, paths, { requiresContent: false, bodyPredicates: [] });
    const top = files.find(f => f.filename === 'top')!;
    expect(top.path).toBe('top.md');
    expect(top.abspath).toBe(join(dir, 'top.md'));
    expect(top.frontmatter.title).toBe('Top');
  });
});

describe('FastFileOps.preFilterByContent', () => {
  let dir: string;
  beforeAll(() => {
    dir = join(tmpdir(), `mdquery-fio-pf-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n\nThis file mentions BUG-123.\n');
    writeFileSync(join(dir, 'b.md'), '---\ntitle: B\n---\n\nNo bug here.\n');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns only files whose content matches the pattern', async () => {
    const all = await FastFileOps.listFiles(dir);
    const matches = await FastFileOps.preFilterByContent(dir, all, 'BUG-123');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain('a.md');
  });

  it('returns empty when nothing matches', async () => {
    const all = await FastFileOps.listFiles(dir);
    const matches = await FastFileOps.preFilterByContent(dir, all, 'zzz-nothing');
    expect(matches).toHaveLength(0);
  });
});

describe('Executor fast file I/O', () => {
  let dir: string;
  beforeAll(() => {
    dir = join(tmpdir(), `mdquery-fio-ex-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\nstatus: todo\n---\n\nHas BUG-123.\n');
    writeFileSync(join(dir, 'b.md'), '---\ntitle: B\nstatus: done\n---\n\nClean.\n');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('select with fast:true returns correct results', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select title where status = "todo"');
    expect(result.data!.map((f: any) => f.title)).toEqual(['A']);
  });

  it('select with fast:true and content predicate pre-filters', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select title where content contains "BUG-123"');
    expect(result.data!.map((f: any) => f.title)).toEqual(['A']);
  });
});