// tests/trigger-variables.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Executor, TriggerContext } from '../src/executor';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'trigger-vars');

describe('Trigger Variables', () => {
  beforeAll(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    
    writeFileSync(join(FIXTURES_DIR, 'task-001.md'), `---
id: 1
title: Test Task
status: todo
projectId: 1
priority: 3
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is a test task.
`);
  });

  afterAll(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it('compares new.field in trigger context', async () => {
    const triggerContext: TriggerContext = {
      old: { id: '1', title: 'Test Task', status: 'todo', projectId: 1, priority: 3, filepath: '', content: '', filename: 'task-001', path: 'task-001.md', abspath: '/tmp/task-001.md' },
      new: { id: '1', title: 'Test Task', status: 'done', projectId: 1, priority: 3, filepath: '', content: '', filename: 'task-001', path: 'task-001.md', abspath: '/tmp/task-001.md' }
    };
    
    const executor = new Executor(FIXTURES_DIR, undefined, triggerContext);
    const result = await executor.execute('select where new.status = "done"');
    expect(result.data).toHaveLength(1);
  });

  it('compares old.field in trigger context', async () => {
    const triggerContext: TriggerContext = {
      old: { id: '1', title: 'Test Task', status: 'todo', projectId: 1, priority: 3, filepath: '', content: '', filename: 'task-001', path: 'task-001.md', abspath: '/tmp/task-001.md' },
      new: { id: '1', title: 'Test Task', status: 'done', projectId: 1, priority: 3, filepath: '', content: '', filename: 'task-001', path: 'task-001.md', abspath: '/tmp/task-001.md' }
    };
    
    const executor = new Executor(FIXTURES_DIR, undefined, triggerContext);
    const result = await executor.execute('select where old.status = "todo"');
    expect(result.data).toHaveLength(1);
  });

  it('compares new.field with not equal', async () => {
    const triggerContext: TriggerContext = {
      old: { id: '1', title: 'Test Task', status: 'todo', projectId: 1, priority: 3, filepath: '', content: '', filename: 'task-001', path: 'task-001.md', abspath: '/tmp/task-001.md' },
      new: { id: '1', title: 'Test Task', status: 'done', projectId: 1, priority: 3, filepath: '', content: '', filename: 'task-001', path: 'task-001.md', abspath: '/tmp/task-001.md' }
    };
    
    const executor = new Executor(FIXTURES_DIR, undefined, triggerContext);
    const result = await executor.execute('select where new.status != old.status');
    expect(result.data).toHaveLength(1);
  });

  it('compares new.field with is empty', async () => {
    const triggerContext: TriggerContext = {
      old: { id: '1', title: 'Test Task', status: 'todo', projectId: 1, priority: 3, filepath: '', content: '', filename: 'task-001', path: 'task-001.md', abspath: '/tmp/task-001.md' },
      new: { id: '1', title: 'Test Task', status: 'done', projectId: 1, priority: 3, filepath: '', content: '', assignee: '', filename: 'task-001', path: 'task-001.md', abspath: '/tmp/task-001.md' }
    };
    
    const executor = new Executor(FIXTURES_DIR, undefined, triggerContext);
    const result = await executor.execute('select where new.assignee is empty');
    expect(result.data).toHaveLength(1);
  });
});
