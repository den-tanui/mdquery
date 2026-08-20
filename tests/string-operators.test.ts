// tests/string-operators.test.ts

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Executor } from '../src/executor';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'string-ops');

describe('String Operators', () => {
  beforeAll(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });

    writeFileSync(
      join(FIXTURES_DIR, 'task-001.md'),
      `---
id: 1
title: Fix Login Bug
status: todo
projectId: 1
tags: [backend, auth]
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

Fix the login bug.
`,
    );

    writeFileSync(
      join(FIXTURES_DIR, 'task-002.md'),
      `---
id: 2
title: Add User Profile
status: done
projectId: 1
tags: [frontend, ui]
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

Add user profile page.
`,
    );

    writeFileSync(
      join(FIXTURES_DIR, 'task-003.md'),
      `---
id: 3
title: Backend API
status: doing
projectId: 2
tags: [backend, api]
createdAt: 2026-07-18T10:00:00Z
updatedAt: 2026-07-18T10:00:00Z
---

Build backend API.
`,
    );
  });

  afterAll(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it('starts_with operator', async () => {
    const executor = new Executor(FIXTURES_DIR);
    const result = await executor.execute('select where title starts_with "Fix"');
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].title).toBe('Fix Login Bug');
  });

  it('ends_with operator', async () => {
    const executor = new Executor(FIXTURES_DIR);
    const result = await executor.execute('select where title ends_with "Bug"');
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].title).toBe('Fix Login Bug');
  });

  it('contains operator', async () => {
    const executor = new Executor(FIXTURES_DIR);
    const result = await executor.execute('select where title contains "Login"');
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].title).toBe('Fix Login Bug');
  });

  it('not operator', async () => {
    const executor = new Executor(FIXTURES_DIR);
    const result = await executor.execute('select where not status = "done"');
    expect(result.data).toHaveLength(2);
  });

  it('is empty operator', async () => {
    const executor = new Executor(FIXTURES_DIR);
    const result = await executor.execute('select where tags is empty');
    expect(result.data).toHaveLength(0);
  });

  it('is not empty operator', async () => {
    const executor = new Executor(FIXTURES_DIR);
    const result = await executor.execute('select where tags is not empty');
    expect(result.data).toHaveLength(3);
  });

  it('combined string operators', async () => {
    const executor = new Executor(FIXTURES_DIR);
    const result = await executor.execute(
      'select where title starts_with "Add" and title ends_with "Profile"',
    );
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].title).toBe('Add User Profile');
  });
});
