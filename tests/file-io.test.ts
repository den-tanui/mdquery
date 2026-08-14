// tests/file-io.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastFileOps, applyContentPrefilter, type PrefilterSieve } from '../src/file-io';
import { Executor } from '../src/executor';
import { Parser } from '../src/parser';
import { buildContentPrefilterTree, type ContentPrefilterNode } from '../src/query-analyzer';
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

describe('Executor fast path body field references', () => {
  let dir: string;
  beforeAll(() => {
    dir = join(tmpdir(), `mdquery-fio-body-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n\nHas BUG-123 in body.\n');
    writeFileSync(join(dir, 'b.md'), '---\ntitle: B\n---\n\nClean body.\n');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('body contains works in fast mode (body loaded when referenced)', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select title where body contains "BUG-123"');
    expect(result.data!.map((f: any) => f.title)).toEqual(['A']);
  });

  it('body contains matches legacy mode', async () => {
    const legacy = new Executor(dir, undefined, undefined, { fast: false });
    const fast = new Executor(dir, undefined, undefined, { fast: true });
    const legacyResult = await legacy.execute('select title where body contains "BUG-123"');
    const fastResult = await fast.execute('select title where body contains "BUG-123"');
    expect(fastResult.data!.map((f: any) => f.title)).toEqual(legacyResult.data!.map((f: any) => f.title));
  });

  it('select body in fast mode returns the body content', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select body where title = "A"');
    expect(result.data![0].body).toContain('BUG-123');
  });

  it('select body with a body predicate in fast mode returns the body content', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select body where body contains "BUG-123"');
    expect(result.data).toHaveLength(1);
    expect(result.data![0].body).toContain('BUG-123');
  });
});

describe('FastFileOps.preFilterByContent negate', () => {
  let dir: string;
  beforeAll(() => {
    dir = join(tmpdir(), `mdquery-fio-pfn-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n\nHas BUG-123.\n');
    writeFileSync(join(dir, 'b.md'), '---\ntitle: B\n---\n\nClean.\n');
    // Every line matches the pattern (no frontmatter, no trailing newline) so
    // invertMatch drops it. A trailing newline would create an empty final line
    // that does not match, which grepts' line-based invertMatch would keep.
    writeFileSync(join(dir, 'c.md'), 'BUG-123\nBUG-123');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns files with at least one non-matching line when negate is true', async () => {
    const all = await FastFileOps.listFiles(dir);
    const matches = await FastFileOps.preFilterByContent(dir, all, 'BUG-123', true);
    const rel = matches.map(f => f.replace(dir + '/', '')).sort();
    // a.md and b.md have non-matching lines; c.md's every line matches → dropped.
    expect(rel).toEqual(['a.md', 'b.md']);
  });

  it('defaults to positive matching when negate is omitted', async () => {
    const all = await FastFileOps.listFiles(dir);
    const matches = await FastFileOps.preFilterByContent(dir, all, 'BUG-123');
    const rel = matches.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['a.md', 'c.md']);
  });
});

describe('Executor fast path negated content predicates', () => {
  let dir: string;
  beforeAll(() => {
    dir = join(tmpdir(), `mdquery-fio-exneg-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), 'Alpha has BUG-123.\n');
    writeFileSync(join(dir, 'b.md'), 'Beta is clean');
    writeFileSync(join(dir, 'c.md'), 'BUG-123\nBUG-123\n');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  async function filenamesFor(query: string, fast: boolean): Promise<string[]> {
    const executor = new Executor(dir, undefined, undefined, { fast });
    const result = await executor.execute(query);
    return result.data!.map((f: any) => f.filename).sort();
  }

  it('content NOT CONTAINS returns same results in fast and legacy mode', async () => {
    const legacy = await filenamesFor('select filename where content NOT CONTAINS "BUG-123"', false);
    const fast = await filenamesFor('select filename where content NOT CONTAINS "BUG-123"', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['b']);
  });

  it('content NOT STARTS_WITH returns same results in fast and legacy mode', async () => {
    const legacy = await filenamesFor('select filename where content NOT STARTS_WITH "Alpha"', false);
    const fast = await filenamesFor('select filename where content NOT STARTS_WITH "Alpha"', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['b', 'c']);
  });

  it('content NOT ENDS_WITH returns same results in fast and legacy mode', async () => {
    const legacy = await filenamesFor('select filename where content NOT ENDS_WITH "clean"', false);
    const fast = await filenamesFor('select filename where content NOT ENDS_WITH "clean"', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['a', 'c']);
  });

  it('content != returns same results in fast and legacy mode', async () => {
    const legacy = await filenamesFor('select filename where content != "Beta is clean"', false);
    const fast = await filenamesFor('select filename where content != "Beta is clean"', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['a', 'c']);
  });
});

describe('buildContentPrefilterTree', () => {
  function treeFor(query: string): ContentPrefilterNode | null {
    const ast = new Parser(query).parse();
    return buildContentPrefilterTree(ast.type === 'select' ? ast.where : undefined);
  }

  it('preserves OR structure', () => {
    expect(treeFor('select filename where content contains "a" OR content contains "b"')).toEqual({
      type: 'or',
      left: { type: 'leaf', op: 'CONTAINS', pattern: 'a' },
      right: { type: 'leaf', op: 'CONTAINS', pattern: 'b' }
    });
  });

  it('preserves AND structure with a negated leaf', () => {
    expect(treeFor('select filename where content contains "a" AND content NOT CONTAINS "b"')).toEqual({
      type: 'and',
      left: { type: 'leaf', op: 'CONTAINS', pattern: 'a' },
      right: { type: 'leaf', op: 'NOT CONTAINS', pattern: 'b' }
    });
  });

  it('pushes NOT down to the leaf (De Morgan)', () => {
    expect(treeFor('select filename where NOT (content contains "a")')).toEqual({
      type: 'leaf', op: 'NOT CONTAINS', pattern: 'a'
    });
  });

  it('pushes NOT over OR down to AND of negated leaves', () => {
    expect(treeFor('select filename where NOT (content contains "a" OR content contains "b")')).toEqual({
      type: 'and',
      left: { type: 'leaf', op: 'NOT CONTAINS', pattern: 'a' },
      right: { type: 'leaf', op: 'NOT CONTAINS', pattern: 'b' }
    });
  });

  it('treats a non-content AND branch as identity', () => {
    expect(treeFor('select filename where status = "todo" AND content contains "a"')).toEqual({
      type: 'leaf', op: 'CONTAINS', pattern: 'a'
    });
  });

  it('returns null when a non-content branch participates in OR', () => {
    expect(treeFor('select filename where status = "todo" OR content contains "a"')).toBeNull();
  });

  it('returns null when there are no content predicates', () => {
    expect(treeFor('select filename where status = "todo"')).toBeNull();
    expect(treeFor('select filename')).toBeNull();
  });

  it('expands IN to a union of equality leaves', () => {
    expect(treeFor('select filename where content IN ("a", "b")')).toEqual({
      type: 'or',
      left: { type: 'leaf', op: '=', pattern: 'a' },
      right: { type: 'leaf', op: '=', pattern: 'b' }
    });
  });

  it('expands NOT IN to an intersection of inequality leaves', () => {
    expect(treeFor('select filename where content NOT IN ("a", "b")')).toEqual({
      type: 'and',
      left: { type: 'leaf', op: '!=', pattern: 'a' },
      right: { type: 'leaf', op: '!=', pattern: 'b' }
    });
  });
});

describe('applyContentPrefilter', () => {
  const paths = ['/x/a.md', '/x/b.md', '/x/c.md'];

  it('runs the sieve once per distinct pattern and combines AND/OR', async () => {
    const calls: string[] = [];
    const sieve: PrefilterSieve = async (op, pattern) => {
      calls.push(`${op}:${pattern}`);
      return paths.filter(p => p.includes(pattern));
    };
    const tree: ContentPrefilterNode = {
      type: 'or',
      left: { type: 'leaf', op: 'CONTAINS', pattern: 'a' },
      right: {
        type: 'and',
        left: { type: 'leaf', op: 'CONTAINS', pattern: 'a' },
        right: { type: 'leaf', op: 'NOT CONTAINS', pattern: 'b' }
      }
    };
    const result = await applyContentPrefilter(paths, tree, sieve);
    // 'a' appears twice (positive) → one call; 'b' once (negated) → one call
    expect(calls).toEqual(['CONTAINS:a', 'NOT CONTAINS:b']);
    // union(match(a), intersect(match(a), notMatch(b)))
    expect(result.sort()).toEqual(['/x/a.md']);
  });

  it('AND intersects and OR unions the sieve results', async () => {
    const sieve: PrefilterSieve = async (_op, pattern) => {
      if (pattern === 'a') return ['/x/a.md', '/x/c.md'];
      if (pattern === 'b') return ['/x/b.md', '/x/c.md'];
      return [];
    };
    const andTree: ContentPrefilterNode = {
      type: 'and',
      left: { type: 'leaf', op: 'CONTAINS', pattern: 'a' },
      right: { type: 'leaf', op: 'CONTAINS', pattern: 'b' }
    };
    expect((await applyContentPrefilter(paths, andTree, sieve)).sort()).toEqual(['/x/c.md']);

    const orTree: ContentPrefilterNode = {
      type: 'or',
      left: { type: 'leaf', op: 'CONTAINS', pattern: 'a' },
      right: { type: 'leaf', op: 'CONTAINS', pattern: 'b' }
    };
    expect((await applyContentPrefilter(paths, orTree, sieve)).sort()).toEqual(['/x/a.md', '/x/b.md', '/x/c.md']);
  });
});

describe('Executor fast path AND/OR/NOT content prefilter', () => {
  let dir: string;
  beforeAll(() => {
    dir = join(tmpdir(), `mdquery-fio-exbool-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\nstatus: todo\n---\n\nAlpha has BUG-123.\n');
    writeFileSync(join(dir, 'b.md'), '---\ntitle: B\nstatus: done\n---\n\nBeta has OTHER-456.\n');
    writeFileSync(join(dir, 'c.md'), '---\ntitle: C\nstatus: todo\n---\n\nGamma has BUG-123 and OTHER-456.\n');
    writeFileSync(join(dir, 'd.md'), '---\ntitle: D\nstatus: done\n---\n\nDelta is clean.\n');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  async function filenamesFor(query: string, fast: boolean): Promise<string[]> {
    const executor = new Executor(dir, undefined, undefined, { fast });
    const result = await executor.execute(query);
    return result.data!.map((f: any) => f.filename).sort();
  }

  it('OR returns the union in fast mode', async () => {
    const legacy = await filenamesFor('select filename where content contains "BUG-123" OR content contains "OTHER-456"', false);
    const fast = await filenamesFor('select filename where content contains "BUG-123" OR content contains "OTHER-456"', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['a', 'b', 'c']);
  });

  it('AND intersects in fast mode', async () => {
    const legacy = await filenamesFor('select filename where content contains "BUG-123" AND content contains "OTHER-456"', false);
    const fast = await filenamesFor('select filename where content contains "BUG-123" AND content contains "OTHER-456"', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['c']);
  });

  it('NOT complements in fast mode', async () => {
    const legacy = await filenamesFor('select filename where NOT (content contains "BUG-123")', false);
    const fast = await filenamesFor('select filename where NOT (content contains "BUG-123")', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['b', 'd']);
  });

  it('NOT over OR complements the union in fast mode', async () => {
    const legacy = await filenamesFor('select filename where NOT (content contains "BUG-123" OR content contains "OTHER-456")', false);
    const fast = await filenamesFor('select filename where NOT (content contains "BUG-123" OR content contains "OTHER-456")', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['d']);
  });

  it('mixed frontmatter AND content predicate matches legacy', async () => {
    const legacy = await filenamesFor('select filename where status = "todo" AND content contains "BUG-123"', false);
    const fast = await filenamesFor('select filename where status = "todo" AND content contains "BUG-123"', true);
    expect(fast).toEqual(legacy);
    expect(fast).toEqual(['a', 'c']);
  });

  it('content IN prefilter stays a superset and matches legacy', async () => {
    const legacy = await filenamesFor('select filename where content IN ("BUG-123", "OTHER-456")', false);
    const fast = await filenamesFor('select filename where content IN ("BUG-123", "OTHER-456")', true);
    expect(fast).toEqual(legacy);
  });
});