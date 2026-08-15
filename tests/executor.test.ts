// tests/executor.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Executor } from '../src/executor';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'executor');

describe('Executor', () => {
  beforeAll(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    
    // Create test task files
    writeFileSync(join(FIXTURES_DIR, 'task-001.md'), `---
id: 1
title: Test Task
status: todo
projectId: 1
priority: 3
assignee: jane
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is a test task.
`);
    
    writeFileSync(join(FIXTURES_DIR, 'task-002.md'), `---
id: 2
title: Another Task
status: done
projectId: 1
priority: 5
assignee: john
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is another test task.
`);
    
    writeFileSync(join(FIXTURES_DIR, 'task-003.md'), `---
id: 3
title: Third Task
status: doing
projectId: 2
priority: 1
assignee: jane
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is the third test task.
`);
  });

  afterAll(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  describe('SELECT', () => {
    it('selects all tasks', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select');
      expect(result.data).toHaveLength(3);
    });

    it('selects with where clause', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where status = "todo"');
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].title).toBe('Test Task');
    });

    it('selects with multiple conditions', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where projectId = 1 and status = "done"');
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].title).toBe('Another Task');
    });

    it('selects with order by', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select order by priority desc');
      expect(result.data?.[0].priority).toBe(5);
      expect(result.data?.[2].priority).toBe(1);
    });

    it('selects with limit', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select order by priority limit 2');
      expect(result.data).toHaveLength(2);
    });

    it('selects specific fields', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select id, title, status');
      expect(result.data?.[0]).toHaveProperty('id');
      expect(result.data?.[0]).toHaveProperty('title');
      expect(result.data?.[0]).toHaveProperty('status');
    });
  });

  describe('UPDATE', () => {
    it('updates tasks', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('update where id = 1 set status = "doing"');
      expect(result.updated).toBe(1);
      
      // Verify update
      const selectResult = await executor.execute('select where id = 1');
      expect(selectResult.data?.[0].status).toBe('doing');
      
      // Reset
      await executor.execute('update where id = 1 set status = "todo"');
    });
  });

  describe('CREATE', () => {
    it('creates a new task', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('create title = "New Task" status = "todo" projectId = 1 file = "new-task"');
      expect(result.created).toBe(1);
      
      // Verify creation
      const selectResult = await executor.execute('select where title = "New Task"');
      expect(selectResult.data).toHaveLength(1);
      
      // Clean up
      await executor.execute('delete where title = "New Task"');
    });

    it('create without a target errors', async () => {
      const executor = new Executor(FIXTURES_DIR);
      await expect(executor.execute('create title = "No Target"')).rejects.toThrow('create requires path to file');
    });
  });

  describe('DELETE', () => {
    it('deletes tasks', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('delete where id = 3');
      expect(result.deleted).toBe(1);
      
      // Verify deletion
      const selectResult = await executor.execute('select');
      expect(selectResult.data).toHaveLength(2);
      
      // Recreate for other tests
      await executor.execute('create id = 3 title = "Third Task" status = "doing" projectId = 2 priority = 1 file = "task-003"');
    });
  });
});

describe('Executor error handling + meta', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-err-'));
    writeFileSync(join(dir, 'good.md'), '---\ntitle: Good\n---\nBody\n');
    // Malformed frontmatter: gray-matter throws YAMLException
    writeFileSync(join(dir, 'bad.md'), '---\nname: "broken\ndescription: this yaml is invalid\n---\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('skips malformed files and records them in meta.errors (fast path)', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select title');
    expect(result.data).toHaveLength(1);
    expect(result.data![0].title).toBe('Good');
    expect(result.meta).toBeDefined();
    expect(result.meta!.errors).toHaveLength(1);
    expect(result.meta!.errors[0].path).toContain('bad.md');
    expect(result.meta!.errors[0].phase).toBe('read');
  });

  it('skips malformed files and records them in meta.errors (legacy path)', async () => {
    const executor = new Executor(dir, undefined, undefined, {});
    const result = await executor.execute('select title');
    expect(result.data).toHaveLength(1);
    expect(result.meta!.errors).toHaveLength(1);
    expect(result.meta!.errors[0].phase).toBe('read');
  });

  it('reports filesSearched and filesMatched in meta', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select title');
    expect(result.meta!.filesSearched).toBe(2);
    expect(result.meta!.filesMatched).toBe(1);
  });

  it('records evaluate-phase errors per file and excludes the file from data', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    // Force an evaluate error via a method on a non-array (title.filter) —
    // throws in the evaluate phase. The shared fixture also has bad.md, whose
    // read-phase error is recorded too, so assert `some` evaluate error and
    // that the offending file is excluded from data.
    const result = await executor.execute('select title.filter(x)');
    expect(result.meta!.errors.some(e => e.phase === 'evaluate')).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  it('forwards read errors to a user-supplied ReadOptions.onError callback', async () => {
    const onError = vi.fn();
    const executor = new Executor(dir, undefined, undefined, { fast: true, onError });
    await executor.execute('select title');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].path).toContain('bad.md');
    expect(onError.mock.calls[0][0].phase).toBe('read');
  });

  it('reports timings with the expected shape and a bounded evaluate time', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select title');
    const timings = result.meta!.timings;
    for (const key of ['list', 'read', 'prefilter', 'evaluate', 'total'] as const) {
      expect(typeof timings[key]).toBe('number');
    }
    // Loose bounds: evaluate covers WHERE/HAVING/projection only, so it must
    // be a small non-negative slice of the total execution time.
    expect(timings.evaluate).toBeGreaterThanOrEqual(0);
    expect(timings.evaluate).toBeLessThan(timings.total);
  });
});

describe('Flattening tools + builtins', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-flat-'));
    writeFileSync(join(dir, 'a.md'), '---\ntags: [x, y]\ntitle: A\n---\nBody\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('joins an array of scalars with a delimiter', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select tags.join("-")');
    expect(result.data![0]['tags.join("-")']).toBe('x-y');
  });

  it('fields() returns a single map object', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select fields()');
    expect(result.data![0]['fields()']).toEqual({ tags: ['x', 'y'], title: 'A' });
  });

  it('fields().keys() lists frontmatter field names', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select fields().keys()');
    expect(result.data![0]['fields().keys()']).toEqual(['tags', 'title']);
  });

  it('fields("values") returns an array of scalars (allowed in table format)', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    const result = await executor.execute('select fields("values")');
    expect(result.data![0]['fields("values")']).toEqual([['x', 'y'], 'A']);
  });
});

describe('Array method eager-arg fixes', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-arr-'));
    // toc() returns [{level, title}] per section; the frontmatter `title: A`
    // guards the _-fallback: bare `title` in a filter predicate must resolve
    // to the item's title, not the file's frontmatter title.
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n## Setup\nDo it now.\n\n## Teardown\nOther stuff.\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('filter with a bare-field predicate resolves the field to the item', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute("select toc().filter(title starts_with 'Set').count()");
    expect(result.data![0]['toc().filter(title_STARTS_WITH_"Set").count()']).toBe(1);
  });

  it('map with a string arg extracts the property from each item', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute("select toc().map('title')");
    expect(result.data![0]['toc().map("title")']).toEqual(['Setup', 'Teardown']);
  });

  it('sort with a string arg sorts by that property', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute("select toc().sort('title').map('title')");
    expect(result.data![0]['toc().sort("title").map("title")']).toEqual(['Setup', 'Teardown']);
  });

  it('filter with an expression predicate works', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute("select toc().filter(_.level = 2).count()");
    expect(result.data![0]['toc().filter(_.level_=_2).count()']).toBe(2);
  });
});

describe('sections()/section() redesign', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-sec-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n## Setup\nDo it now.\n\n## Teardown\nOther stuff.\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sections() returns full SectionData objects', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select sections()');
    const sections = result.data![0]['sections()'];
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ title: 'Setup', level: 2, content: 'Do it now.' });
    expect(sections[0].hierarchy).toBeDefined();
    expect(sections[0].position).toBeDefined();
  });

  it('section("name") returns the first exact match or null', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select section("Setup")');
    expect(result.data![0]['section("Setup")']).toMatchObject({ title: 'Setup', content: 'Do it now.' });
    const missing = await executor.execute('select section("Nope")');
    expect(missing.data![0]['section("Nope")']).toBeNull();
  });

  it('section() with no args returns the first section or null', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select section()');
    expect(result.data![0]['section()']).toMatchObject({ title: 'Setup' });
  });

  it('section("name").content selects a scalar property', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select section("Setup").content');
    expect(result.data![0]['section("Setup").content']).toBe('Do it now.');
  });
});

describe('Scalar enforcement (table/csv)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-scalar-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n## Setup\nDo it now.\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('throws for sections() in table format with a shape-aware message', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    await expect(executor.execute('select sections()')).rejects.toThrow(/sections\(\)/);
    await expect(executor.execute('select sections()')).rejects.toThrow(/array of maps/);
    await expect(executor.execute('select sections()')).rejects.toThrow(/sections\(\)\.map\('title'\)/);
  });

  it('throws for section("name") in csv format with a shape-aware message', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'csv' });
    await expect(executor.execute('select section("Setup")')).rejects.toThrow(/section\("Setup"\)/);
    // The suggestion templates are static (`section("name").title`), so the
    // shape-aware message names the offending expression AND suggests the
    // scalar property-access alternative.
    await expect(executor.execute('select section("Setup")')).rejects.toThrow(/section\("name"\)\.title/);
  });

  it('allows scalar property access in table format', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    const result = await executor.execute('select section("Setup").title');
    expect(result.data![0]['section("Setup").title']).toBe('Setup');
  });

  it('allows arrays of scalars in table format', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    const result = await executor.execute('select sections().map(\'title\')');
    expect(result.data![0]["sections().map(\"title\")"]).toEqual(['Setup']);
  });

  it('does not enforce in json format', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'json' });
    const result = await executor.execute('select sections()');
    expect(result.data![0]['sections()']).toHaveLength(1);
  });
});

describe('grep() regex fixes', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-grep-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n## Setup\nDo it now.\nTODO: fix this.\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('grep(/TODO/) matches the pattern, not the literal "/TODO/"', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select grep(/TODO/).count()');
    expect(result.data![0]['grep(/TODO/).count()']).toBe(1);
  });

  it('grep(content, /x/) 2-arg form does not crash', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select grep(content, /TODO/).count()');
    expect(result.data![0]['grep(content, /TODO/).count()']).toBe(1);
  });

  it('grep() returns full GrepMatch objects', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select grep(/TODO/)');
    const matches = result.data![0]['grep(/TODO/)'];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ line: 3, column: 0, text: 'TODO', section: ['Setup'] });
  });

  it('throws a shape-aware error for grep() in table format', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    await expect(executor.execute('select grep(/TODO/)')).rejects.toThrow(/grep\(/);
    await expect(executor.execute('select grep(/TODO/)')).rejects.toThrow(/array of maps/);
  });
});

describe('Executor multi-dir', () => {
  let dirA: string;
  let dirB: string;

  beforeAll(() => {
    dirA = mkdtempSync(join(tmpdir(), 'mdq-a-'));
    dirB = mkdtempSync(join(tmpdir(), 'mdq-b-'));
    writeFileSync(join(dirA, 'a.md'), '---\ntitle: Alpha\n---\n');
    writeFileSync(join(dirB, 'b.md'), '---\ntitle: Beta\n---\n');
  });

  afterAll(() => {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it('queries multiple dirs and returns flat union with source_dir', async () => {
    const executor = new Executor([dirA, dirB]);
    const result = await executor.execute('select filename, source_dir');
    expect(result.data).toHaveLength(2);
    const filenames = result.data!.map(r => r.filename).sort();
    expect(filenames).toEqual(['a', 'b']);
    // source_dir is set on each row
    for (const row of result.data!) {
      expect(row.source_dir).toBeDefined();
      expect(typeof row.source_dir).toBe('string');
    }
  });

  it('single dir also includes source_dir', async () => {
    const executor = new Executor([dirA]);
    const result = await executor.execute('select filename, source_dir');
    expect(result.data).toHaveLength(1);
    expect(result.data![0].source_dir).toBe(dirA);
  });

  it('path is relative to source_dir', async () => {
    const executor = new Executor([dirA, dirB]);
    const result = await executor.execute('select filename, path, source_dir');
    const byName = Object.fromEntries(result.data!.map(r => [r.filename, r]));
    expect(byName['a'].path).toBe('a.md');
    expect(byName['a'].source_dir).toBe(dirA);
    expect(byName['b'].path).toBe('b.md');
    expect(byName['b'].source_dir).toBe(dirB);
  });

  it('backward compat: single string wraps in array', async () => {
    const executor = new Executor(dirA as any); // pass string, not array
    const result = await executor.execute('select filename');
    expect(result.data).toHaveLength(1);
  });

  it('missing dir records error in meta.errors and continues', async () => {
    const missingDir = join(tmpdir(), 'mdq-missing-' + Date.now());
    const executor = new Executor([dirA, missingDir]);
    const result = await executor.execute('select filename, source_dir');
    // dirA still queried
    expect(result.data).toHaveLength(1);
    expect(result.data![0].source_dir).toBe(dirA);
    // missing dir recorded in meta.errors with phase read
    expect(result.meta?.errors?.length).toBeGreaterThan(0);
    const err = result.meta!.errors.find(e => e.path === missingDir);
    expect(err).toBeDefined();
    expect(err!.phase).toBe('read');
  });
});
