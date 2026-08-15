// tests/file-metadata.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir, userInfo } from 'os';
import { join } from 'path';
import { buildFileMetadata, FileOps } from '../src/files';
import { FastFileOps } from '../src/file-io';
import { QueryAnalyzer } from '../src/query-analyzer';
import { Parser } from '../src/parser';
import { Executor } from '../src/executor';
import type { SelectStatement } from '../src/types';

describe('buildFileMetadata', () => {
  it('builds a metadata map from a file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdquery-meta-'));
    const f = join(dir, 'a.md');
    writeFileSync(f, '---\ntitle: A\n---\n');
    const meta = buildFileMetadata(f)!;
    expect(meta).toBeDefined();
    expect(meta.abspath).toBe(f);
    expect(meta.mtime).toBeInstanceOf(Date);
    expect(meta.atime).toBeInstanceOf(Date);
    expect(meta.ctime).toBeInstanceOf(Date);
    expect(meta.size).toBeGreaterThan(0);
    expect(meta.mode).toMatch(/^[rwx-]{9}$/);
    expect(meta.owner).toBe(userInfo().username);
    expect(meta.group).toBe(String(process.getgid()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when stat fails (missing file)', () => {
    expect(buildFileMetadata('/nonexistent/definitely-missing.md')).toBeUndefined();
  });
});

describe('read paths load metadata lazily', () => {
  it('FileOps.readFiles loads metadata only when requested', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdquery-meta-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n');
    const withMeta = await FileOps.readFiles(dir, { metadata: true });
    expect(withMeta[0].metadata).toBeDefined();
    expect(withMeta[0].metadata!.mtime).toBeInstanceOf(Date);
    const withoutMeta = await FileOps.readFiles(dir);
    expect(withoutMeta[0].metadata).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('FastFileOps.readFiles loads metadata only when analysis requires it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdquery-meta-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n');
    const paths = await FastFileOps.listFiles(dir);
    const withMeta = await FastFileOps.readFiles(dir, paths, {
      requiresContent: false, bodyPredicates: [], requiresMetadata: true
    });
    expect(withMeta[0].metadata).toBeDefined();
    const withoutMeta = await FastFileOps.readFiles(dir, paths, {
      requiresContent: false, bodyPredicates: [], requiresMetadata: false
    });
    expect(withoutMeta[0].metadata).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('QueryAnalyzer requiresMetadata detection', () => {
  it('flags requiresMetadata for file() in select fields (not requiresContent)', () => {
    const ast = new Parser('select file().mtime').parse();
    const plan = new QueryAnalyzer(ast).analyze();
    expect(plan.lazyLoading.requiresMetadata).toBe(true);
    expect(plan.lazyLoading.requiresContent).toBe(false);
  });

  it('flags requiresMetadata for file() in WHERE', () => {
    const ast = new Parser('select filename where file().size > 1000').parse();
    const plan = new QueryAnalyzer(ast).analyze();
    expect(plan.lazyLoading.requiresMetadata).toBe(true);
  });

  it('flags requiresMetadata for file() in HAVING', () => {
    const ast = new Parser('select filename having file().size > 1000').parse();
    const plan = new QueryAnalyzer(ast).analyze();
    expect(plan.lazyLoading.requiresMetadata).toBe(true);
  });

  it('flags requiresMetadata for file() in ORDER BY (hand-built AST)', () => {
    const ast: SelectStatement = {
      type: 'select',
      fields: [{ type: 'field', name: 'filename' }],
      orderBy: [{
        field: {
          type: 'map_index',
          object: { type: 'function_call', name: 'file', args: [] },
          key: { type: 'string', value: 'mtime' }
        },
        direction: 'asc'
      }]
    };
    const plan = new QueryAnalyzer(ast).analyze();
    expect(plan.lazyLoading.requiresMetadata).toBe(true);
  });

  it('flags requiresMetadata for file() in parenthesized WHERE', () => {
    const ast = new Parser('select filename where (file().size > 1000)').parse();
    const plan = new QueryAnalyzer(ast).analyze();
    expect(plan.lazyLoading.requiresMetadata).toBe(true);
  });

  it('does not flag requiresMetadata for queries without file()', () => {
    const ast = new Parser('select filename').parse();
    const plan = new QueryAnalyzer(ast).analyze();
    expect(plan.lazyLoading.requiresMetadata).toBe(false);
  });
});

describe('file() evaluation', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-meta-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('file().mtime returns a real Date', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select file().mtime');
    expect(result.data![0]['file().mtime']).toBeInstanceOf(Date);
  });

  it('file() returns the full metadata map in JSON', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select file()');
    const meta = result.data![0]['file()'];
    expect(meta).toMatchObject({
      abspath: join(dir, 'a.md'),
      size: expect.any(Number),
      mode: expect.stringMatching(/^[rwx-]{9}$/)
    });
    expect(meta.mtime).toBeInstanceOf(Date);
  });

  it('file().mtime serializes to ISO in JSON output', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select file().mtime');
    const json = JSON.parse(JSON.stringify(result));
    expect(json.data[0]['file().mtime']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('file().abspath works as a scalar in table format', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    const result = await executor.execute('select file().abspath');
    expect(result.data![0]['file().abspath']).toBe(join(dir, 'a.md'));
  });

  it('lazy-loads metadata only when the query uses file()', async () => {
    const seen: any[] = [];
    const executor = new Executor(dir, undefined, undefined, { fast: true }, {
      onAfterRead: (f: any) => { seen.push(f); return f; }
    });
    await executor.execute('select filename');
    expect(seen[0].metadata).toBeUndefined();
    seen.length = 0;
    await executor.execute('select file().mtime');
    expect(seen[0].metadata).toBeDefined();
    expect(seen[0].metadata.mtime).toBeInstanceOf(Date);
  });

  it('legacy (non-fast) path also lazy-loads metadata', async () => {
    const seen: any[] = [];
    const executor = new Executor(dir, undefined, undefined, {}, {
      onAfterRead: (f: any) => { seen.push(f); return f; }
    });
    await executor.execute('select filename');
    expect(seen[0].metadata).toBeUndefined();
    seen.length = 0;
    await executor.execute('select file().mtime');
    expect(seen[0].metadata).toBeDefined();
  });

  it('rejects file() with arguments — property access only', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select file(mtime)');
    expect(result.data).toEqual([]);
    expect(result.meta!.errors.some(e => /takes no arguments/.test(e.error))).toBe(true);
  });
});