// tests/files.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FileOps } from '../src/files';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'files-test');

describe('FileOps', () => {
  beforeAll(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    
    // Create test task files
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
    
    writeFileSync(join(FIXTURES_DIR, 'task-002.md'), `---
id: 2
title: Another Task
status: done
projectId: 1
priority: 5
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
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is the third test task.
`);
  });

  afterAll(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it('reads all task files from directory', async () => {
    const files = await FileOps.readFiles(FIXTURES_DIR);
    expect(files).toHaveLength(3);
  });

  it('parses frontmatter correctly', async () => {
    const files = await FileOps.readFiles(FIXTURES_DIR);
    const task1 = files.find(f => f.filename === 'task-001');
    expect(task1).toBeDefined();
    expect(task1?.title).toBe('Test Task');
    expect(task1?.status).toBe('todo');
    expect(task1?.projectId).toBe(1);
  });

  it('reads content correctly', async () => {
    const files = await FileOps.readFiles(FIXTURES_DIR);
    const task1 = files.find(f => f.filename === 'task-001');
    expect(task1?.content).toContain('This is a test task.');
  });

  it('returns correct file paths', async () => {
    const files = await FileOps.readFiles(FIXTURES_DIR);
    const task1 = files.find(f => f.filename === 'task-001');
    expect(task1?.filepath).toContain('task-001.md');
    expect(task1?.path).toBe('task-001.md');
    expect(task1?.abspath).toContain('task-001.md');
  });

  it('handles empty directory', async () => {
    const emptyDir = join(FIXTURES_DIR, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    const files = await FileOps.readFiles(emptyDir);
    expect(files).toHaveLength(0);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('writes task file correctly', async () => {
    const newTask = {
      id: '4',
      title: 'New Task',
      status: 'todo',
      projectId: 1,
      priority: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await FileOps.writeFile(join(FIXTURES_DIR, 'task-004.md'), newTask, 'This is new content.');
    
    const files = await FileOps.readFiles(FIXTURES_DIR);
    const newFile = files.find(f => f.filename === 'task-004');
    expect(newFile).toBeDefined();
    expect(newFile?.title).toBe('New Task');
    
    // Clean up
    rmSync(join(FIXTURES_DIR, 'task-004.md'), { force: true });
  });
});
