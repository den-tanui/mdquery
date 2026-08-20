// tests/benchmark-complexity.test.ts

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Executor } from '../src/executor';

// Generate test task file with specific content
function generateTask(
  id: number,
  options: {
    titleLength?: number;
    sections?: number;
    links?: number;
    codeblocks?: number;
  } = {},
): string {
  const { titleLength = 20, sections = 5, links = 10, codeblocks = 3 } = options;

  // Generate title of specific length
  const title = `Task ${id} - ${'x'.repeat(titleLength)}`;

  const sectionsMd: string[] = [];
  for (let s = 0; s < sections; s++) {
    sectionsMd.push(`\n## Section ${s + 1}\n`);
    for (let l = 0; l < 20; l++) {
      sectionsMd.push(`Line ${l + 1} of section ${s + 1}.`);
      // Add links
      if (l % 3 === 0 && links > 0) {
        sectionsMd.push(`[Link ${l}](task-${(id + l) % 100})`);
      }
    }
    // Add code blocks
    if (s % 2 === 0 && codeblocks > 0) {
      sectionsMd.push('```typescript');
      sectionsMd.push('const x = 1;');
      sectionsMd.push('const y = 2;');
      sectionsMd.push('```');
    }
  }

  return `---
title: "${title}"
status: ${id % 3 === 0 ? 'todo' : id % 3 === 1 ? 'doing' : 'done'}
priority: ${(id % 5) + 1}
createdAt: 2026-01-${String((id % 28) + 1).padStart(2, '0')}T10:00:00Z
---

# ${title}

${sectionsMd.join('\n')}
`;
}

// Measure memory usage
function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed / 1024 / 1024,
    heapTotal: mem.heapTotal / 1024 / 1024,
    external: mem.external / 1024 / 1024,
    rss: mem.rss / 1024 / 1024,
  };
}

describe('Benchmark: Complexity Tests', () => {
  let tempDir: string;

  beforeAll(async () => {
    // Create temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdquery-complexity-'));

    // Generate 100 test files with varied content
    for (let i = 0; i < 100; i++) {
      const content = generateTask(i, {
        titleLength: 20 + (i % 10) * 5, // Varying title lengths
        sections: 3 + (i % 5),
        links: 5 + (i % 10),
        codeblocks: 2 + (i % 3),
      });
      const filePath = path.join(tempDir, `task-${i}.md`);
      await fs.writeFile(filePath, content);
    }
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Query Complexity', () => {
    it('simple query - SELECT with WHERE', async () => {
      const executor = new Executor(tempDir);

      const start = performance.now();
      const result = await executor.execute('select title, status where status = "todo"');
      const end = performance.now();

      console.log(`\nSimple Query: ${(end - start).toFixed(2)}ms`);
      console.log(`  Results: ${result.data?.length || 0}`);

      expect(end - start).toBeLessThan(1000); // < 1s
      expect(result.data?.length).toBeGreaterThan(0);
    });

    it('body extraction - toc()', async () => {
      const executor = new Executor(tempDir);

      const start = performance.now();
      const result = await executor.execute('select title, toc()');
      const end = performance.now();

      console.log(`\nBody Extraction (toc): ${(end - start).toFixed(2)}ms`);
      console.log(`  Results: ${result.data?.length || 0}`);

      expect(end - start).toBeLessThan(500); // < 500ms
      expect(result.data?.length).toBe(100);
    });

    it('complex body - toc()', async () => {
      const executor = new Executor(tempDir);

      const start = performance.now();
      const result = await executor.execute('select title, toc()');
      const end = performance.now();

      console.log(`\nComplex Body (toc): ${(end - start).toFixed(2)}ms`);
      console.log(`  Results: ${result.data?.length || 0}`);

      expect(end - start).toBeLessThan(1000); // < 1s
      expect(result.data?.length).toBe(100);
    });

    it('combined - body + frontmatter', async () => {
      const executor = new Executor(tempDir);

      const start = performance.now();
      const result = await executor.execute('select title, status, toc() where status = "todo"');
      const end = performance.now();

      console.log(`\nCombined: ${(end - start).toFixed(2)}ms`);
      console.log(`  Results: ${result.data?.length || 0}`);

      expect(end - start).toBeLessThan(1000); // < 1s
    });

    it('write query - UPDATE', async () => {
      const executor = new Executor(tempDir);

      const start = performance.now();
      const result = await executor.execute(
        'update set status = "done" where status = "todo" and priority > 3',
      );
      const end = performance.now();

      console.log(`\nWrite Query: ${(end - start).toFixed(2)}ms`);
      console.log(`  Updated: ${result.updated || 0}`);

      expect(end - start).toBeLessThan(1000); // < 1s
      expect(result.updated).toBeGreaterThan(0);
    });
  });

  describe('Content Type Performance', () => {
    it('frontmatter-heavy files', async () => {
      // Create files with many frontmatter fields
      const heavyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdquery-heavy-'));

      for (let i = 0; i < 50; i++) {
        const frontmatter: string[] = [];
        for (let f = 0; f < 30; f++) {
          frontmatter.push(`field${f}: "value${f}"`);
        }

        const content = `---
${frontmatter.join('\n')}
---

# Task ${i}

Simple content.
`;
        await fs.writeFile(path.join(heavyDir, `task-${i}.md`), content);
      }

      const executor = new Executor(heavyDir);

      const start = performance.now();
      const result = await executor.execute('select title, field0, field15, field29');
      const end = performance.now();

      console.log(`\nFrontmatter-Heavy: ${(end - start).toFixed(2)}ms`);
      console.log(`  Results: ${result.data?.length || 0}`);

      await fs.rm(heavyDir, { recursive: true, force: true });

      expect(end - start).toBeLessThan(500); // < 500ms
    });

    it('body-heavy files', async () => {
      // Create files with many sections
      const heavyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdquery-body-'));

      for (let i = 0; i < 50; i++) {
        const sections: string[] = [];
        for (let s = 0; s < 20; s++) {
          sections.push(`\n## Section ${s + 1}\n`);
          for (let l = 0; l < 50; l++) {
            sections.push(`Line ${l + 1} of section ${s + 1}.`);
          }
        }

        const content = `---
title: "Task ${i}"
---

# Task ${i}

${sections.join('\n')}
`;
        await fs.writeFile(path.join(heavyDir, `task-${i}.md`), content);
      }

      const executor = new Executor(heavyDir);

      const start = performance.now();
      const result = await executor.execute('select title, toc()');
      const end = performance.now();

      console.log(`\nBody-Heavy: ${(end - start).toFixed(2)}ms`);
      console.log(`  Results: ${result.data?.length || 0}`);

      await fs.rm(heavyDir, { recursive: true, force: true });

      expect(end - start).toBeLessThan(1000); // < 1s
    });

    it('link-heavy files', async () => {
      // Create files with many links
      const heavyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdquery-links-'));

      for (let i = 0; i < 50; i++) {
        const links: string[] = [];
        for (let l = 0; l < 50; l++) {
          links.push(`[Link ${l}](task-${(i + l) % 100})`);
        }

        const content = `---
title: "Task ${i}"
---

# Task ${i}

${links.join('\n')}
`;
        await fs.writeFile(path.join(heavyDir, `task-${i}.md`), content);
      }

      const executor = new Executor(heavyDir);

      const start = performance.now();
      const result = await executor.execute('select title');
      const end = performance.now();

      console.log(`\nLink-Heavy: ${(end - start).toFixed(2)}ms`);
      console.log(`  Results: ${result.data?.length || 0}`);

      await fs.rm(heavyDir, { recursive: true, force: true });

      expect(end - start).toBeLessThan(1000); // < 1s
    });
  });

  describe('Memory Profiling', () => {
    it('memory scaling with query complexity', async () => {
      if (global.gc) {
        global.gc();
      }

      const executor = new Executor(tempDir);
      const queries = ['select title', 'select title, status', 'select title, status, toc()'];

      console.log('\nMemory Scaling:');

      for (const query of queries) {
        if (global.gc) {
          global.gc();
        }

        const before = getMemoryUsage();
        await executor.execute(query);
        const after = getMemoryUsage();

        const delta = after.heapUsed - before.heapUsed;
        console.log(`  ${query}: +${delta.toFixed(2)} MB`);
      }
    });
  });
});
