// tests/toc-section-syntax.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Executor } from '../src/executor';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname, 'fixtures', 'toc-section-syntax');

describe('TOC and Section Syntax', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });

    writeFileSync(join(TEST_DIR, 'doc1.md'), `---
title: Doc 1
---
# Project
## TODO
### Fix bugs

## DONE
### All done
`);
    writeFileSync(join(TEST_DIR, 'doc2.md'), `---
title: Doc 2
---
# Project
## FIXME
## DONE
`);
    writeFileSync(join(TEST_DIR, 'doc3.md'), `---
title: Doc 3
---
# Project
## TODO
## FIXME
`);
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('"value" in toc() syntax', () => {
    it('parses and evaluates "TODO" in toc()', async () => {
      const executor = new Executor(TEST_DIR);
      const result = await executor.execute('SELECT title WHERE "TODO" in toc()');
      expect(result.data).toHaveLength(2);
      const titles = result.data?.map((r: any) => r.title) || [];
      expect(titles).toContain('Doc 1');
      expect(titles).toContain('Doc 3');
    });

    it('"DONE" in toc() finds all docs with DONE', async () => {
      const executor = new Executor(TEST_DIR);
      const result = await executor.execute('SELECT title WHERE "DONE" in toc()');
      expect(result.data).toHaveLength(2);
      const titles = result.data?.map((r: any) => r.title) || [];
      expect(titles).toContain('Doc 1');
      expect(titles).toContain('Doc 2');
    });

    it('"FIXME" in toc() finds doc2 and doc3', async () => {
      const executor = new Executor(TEST_DIR);
      const result = await executor.execute('SELECT title WHERE "FIXME" in toc()');
      expect(result.data).toHaveLength(2);
      const titles = result.data?.map((r: any) => r.title) || [];
      expect(titles).toContain('Doc 2');
      expect(titles).toContain('Doc 3');
    });

    it('"NONEXISTENT" in toc() returns empty', async () => {
      const executor = new Executor(TEST_DIR);
      const result = await executor.execute('SELECT title WHERE "NONEXISTENT" in toc()');
      expect(result.data).toHaveLength(0);
    });
  });

  describe('has section("name") syntax', () => {
    it('has section("TODO") filters correctly', async () => {
      const executor = new Executor(TEST_DIR);
      const result = await executor.execute('SELECT title WHERE has section("TODO")');
      expect(result.data).toHaveLength(2);
      const titles = result.data?.map((r: any) => r.title) || [];
      expect(titles).toContain('Doc 1');
      expect(titles).toContain('Doc 3');
    });

    it('has section("DONE") finds all docs with DONE', async () => {
      const executor = new Executor(TEST_DIR);
      const result = await executor.execute('SELECT title WHERE has section("DONE")');
      expect(result.data).toHaveLength(2);
      const titles = result.data?.map((r: any) => r.title) || [];
      expect(titles).toContain('Doc 1');
      expect(titles).toContain('Doc 2');
    });

    it('has section("FIXME") finds doc2 and doc3', async () => {
      const executor = new Executor(TEST_DIR);
      const result = await executor.execute('SELECT title WHERE has section("FIXME")');
      expect(result.data).toHaveLength(2);
      const titles = result.data?.map((r: any) => r.title) || [];
      expect(titles).toContain('Doc 2');
      expect(titles).toContain('Doc 3');
    });

    it('has section("NONEXISTENT") returns empty', async () => {
      const executor = new Executor(TEST_DIR);
      const result = await executor.execute('SELECT title WHERE has section("NONEXISTENT")');
      expect(result.data).toHaveLength(0);
    });
  });
});
