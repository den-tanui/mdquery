// tests/ruki-semantics.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Executor } from '../src/executor';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const FIXTURES_DIR = join(tmpdir(), `mdquery-ruki-test-${randomUUID()}`);

describe('Ruki Semantics', () => {
  beforeAll(async () => {
    await mkdir(FIXTURES_DIR, { recursive: true });
    
    // Create test files
    await writeFile(join(FIXTURES_DIR, 'task-001.md'), `---
id: 1
title: Test Task
status: todo
priority: 3
tags: [backend, auth]
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is a test task.
`);

    await writeFile(join(FIXTURES_DIR, 'task-002.md'), `---
id: 2
title: Another Task
status: done
priority: 5
tags: [frontend]
createdAt: 2026-07-19T10:00:00Z
updatedAt: 2026-07-19T10:00:00Z
---

This is another test task.
`);

    await writeFile(join(FIXTURES_DIR, 'task-003.md'), `---
id: 3
title: Third Task
status: todo
priority: 1
createdAt: 2026-07-20T10:00:00Z
updatedAt: 2026-07-20T10:00:00Z
---

Task without tags.
`);
  });

  afterAll(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true });
  });

  describe('has() function', () => {
    it('returns true when field exists', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where has(title)');
      expect(result.data).toHaveLength(3);
    });

    it('returns false when field does not exist', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where has(nonexistent)');
      expect(result.data).toHaveLength(0);
    });

    it('can be combined with other conditions', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where has(tags) and status = "todo"');
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].title).toBe('Test Task');
    });
  });

  describe('in operator', () => {
    it('matches values in list', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where status in ("todo", "done")');
      expect(result.data).toHaveLength(3);
    });

    it('does not match values not in list', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where status in ("doing", "blocked")');
      expect(result.data).toHaveLength(0);
    });
  });

  describe('not in operator', () => {
    it('excludes values in list', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where status not in ("done")');
      expect(result.data).toHaveLength(2);
    });

    it('includes values not in list', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where status not in ("todo")');
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].title).toBe('Another Task');
    });
  });

  describe('not contains/starts_with/ends_with', () => {
    it('not contains excludes matching values', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where title not contains "Task"');
      expect(result.data).toHaveLength(0);
    });

    it('not starts_with excludes matching values', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where title not starts_with "Test"');
      expect(result.data).toHaveLength(2);
    });

    it('not ends_with excludes matching values', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where title not ends_with "Task"');
      expect(result.data).toHaveLength(0);
    });
  });

  describe('absent field contract', () => {
    it('returns false for = when field is absent', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where nonexistent = "value"');
      expect(result.data).toHaveLength(0);
    });

    it('returns true for != when field is absent', async () => {
      const executor = new Executor(FIXTURES_DIR);
      const result = await executor.execute('select where nonexistent != "value"');
      expect(result.data).toHaveLength(3);
    });
  });

  describe('array literals', () => {
    it('parses array literals in values', async () => {
      const executor = new Executor(FIXTURES_DIR);
      // This should parse without error
      const result = await executor.execute('select where tags in (["backend", "auth"])');
      // The result depends on how in handles array values
      expect(result).toBeDefined();
    });
  });

  describe('delete requires where', () => {
    it('rejects delete without where clause', async () => {
      const executor = new Executor(FIXTURES_DIR);
      await expect(executor.execute('delete')).rejects.toThrow('delete requires a where clause');
    });
  });
});
