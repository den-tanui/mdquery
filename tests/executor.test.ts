// tests/executor.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
});
