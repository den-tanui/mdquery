// tests/advanced-features.test.ts

import { randomUUID } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { Executor } from '../src/executor';
import { Parser } from '../src/parser';

function createFixtures(): string {
  const dir = join(tmpdir(), `mdquery-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, 'task-001.md'),
    `---
id: 1
title: Test Task
status: todo
projectId: 1
priority: 3
tags: [backend, auth]
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is a test task.
`,
  );

  writeFileSync(
    join(dir, 'task-002.md'),
    `---
id: 2
title: Another Task
status: done
projectId: 1
priority: 5
tags: [frontend, ui]
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is another test task.
`,
  );

  writeFileSync(
    join(dir, 'task-003.md'),
    `---
id: 3
title: Third Task
status: doing
projectId: 2
priority: 1
tags: [backend, api]
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

This is the third test task.
`,
  );

  return dir;
}

describe('DISTINCT', () => {
  it('removes duplicate rows', async () => {
    const dir = createFixtures();
    try {
      const executor = new Executor(dir);
      const result = await executor.execute('select distinct projectId');
      expect(result.data).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ANY/ALL operators', () => {
  it('any operator on array field', async () => {
    const dir = createFixtures();
    try {
      const executor = new Executor(dir);
      const result = await executor.execute('select where tags any = "backend"');
      expect(result.data).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('all operator on array field', async () => {
    const dir = createFixtures();
    try {
      const executor = new Executor(dir);
      const result = await executor.execute('select where tags all contains "backend"');
      expect(result.data).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('HAVING clause', () => {
  it('filters grouped results', async () => {
    const dir = createFixtures();
    try {
      const executor = new Executor(dir);
      const result = await executor.execute(
        'select projectId, count(*) group by projectId having count(*) > 1',
      );
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].projectId).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Pipe syntax', () => {
  it('parses pipe syntax', () => {
    const ast = new Parser('select where id = 1 | clipboard()').parse();
    expect(ast).toEqual({
      type: 'pipe',
      expr: {
        type: 'select',
        fields: [{ type: 'wildcard' }],
        where: {
          type: 'binary_op',
          left: { type: 'field', name: 'id' },
          op: '=',
          right: { type: 'number', value: 1 },
        },
      },
      fn: 'clipboard',
      args: [],
    });
  });
});

describe('next_date() builtin', () => {
  it('parses next_date in select', async () => {
    const dir = createFixtures();
    try {
      const executor = new Executor(dir);
      const result = await executor.execute('select next_date("daily")');
      expect(result).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
