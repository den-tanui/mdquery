// tests/benchmark-scale.test.ts

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Executor } from '../src/executor';

// Generate test task file
function generateTask(
  id: number,
  options: {
    fields?: number;
    sections?: number;
    links?: number;
    codeblocks?: number;
  } = {},
): string {
  const { fields = 10, sections = 3, links = 5, codeblocks = 2 } = options;

  const frontmatter: string[] = [];
  for (let i = 0; i < fields; i++) {
    frontmatter.push(`field${i}: "value${i}"`);
  }

  const sectionsMd: string[] = [];
  for (let s = 0; s < sections; s++) {
    sectionsMd.push(`\n## Section ${s + 1}\n`);
    for (let l = 0; l < 10; l++) {
      sectionsMd.push(`Line ${l + 1} of section ${s + 1}.`);
      // Add links
      if (l % 2 === 0 && links > 0) {
        sectionsMd.push(`[Link ${l}](task-${(id + l) % 100})`);
      }
    }
    // Add code blocks
    if (s % 2 === 0 && codeblocks > 0) {
      sectionsMd.push('```typescript');
      sectionsMd.push('const x = 1;');
      sectionsMd.push('```');
    }
  }

  return `---
${frontmatter.join('\n')}
---

# Task ${id}

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

describe('Benchmark: Scale Tests', () => {
  const scales = [
    { name: 'Small', count: 10, fields: 10, sections: 3, links: 5, codeblocks: 2 },
    { name: 'Medium', count: 100, fields: 15, sections: 5, links: 10, codeblocks: 3 },
    // Large scale commented out for CI - run locally with: vitest run --testNamePattern="Large Scale"
    // { name: 'Large', count: 1000, fields: 20, sections: 8, links: 15, codeblocks: 5 },
  ];

  for (const scale of scales) {
    describe(`${scale.name} Scale (${scale.count} files)`, () => {
      let tempDir: string;

      beforeAll(async () => {
        // Create temp directory
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdquery-bench-'));

        // Generate test files
        for (let i = 0; i < scale.count; i++) {
          const content = generateTask(i, {
            fields: scale.fields,
            sections: scale.sections,
            links: scale.links,
            codeblocks: scale.codeblocks,
          });
          const filePath = path.join(tempDir, `task-${i}.md`);
          await fs.writeFile(filePath, content);
        }
      });

      afterAll(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      });

      it('parse speed', { timeout: 60000 }, async () => {
        const executor = new Executor(tempDir);
        const queries = [
          'select title, status',
          'select title where status = "todo"',
          'select title, toc()',
        ];

        const results: { query: string; time: number }[] = [];

        // Reduce iterations for larger scales
        const iterations = scale.count <= 10 ? 100 : 10;

        for (const query of queries) {
          const start = performance.now();

          for (let i = 0; i < iterations; i++) {
            await executor.execute(query);
          }

          const end = performance.now();
          results.push({ query, time: (end - start) / iterations });
        }

        console.log(`\n${scale.name} Scale - Parse Speed (${iterations} iterations):`);
        for (const r of results) {
          console.log(`  ${r.query}: ${r.time.toFixed(3)}ms`);
        }

        // Verify reasonable performance
        if (scale.count <= 10) {
          expect(results.every((r) => r.time < 100)).toBe(true);
        } else {
          expect(results.every((r) => r.time < 500)).toBe(true);
        }
      });

      it('read speed', async () => {
        const executor = new Executor(tempDir);

        const start = performance.now();

        await executor.execute('select');

        const end = performance.now();
        const time = end - start;
        const throughput = scale.count / (time / 1000);

        console.log(`\n${scale.name} Scale - Read Speed:`);
        console.log(`  Total: ${time.toFixed(2)}ms`);
        console.log(`  Per file: ${(time / scale.count).toFixed(3)}ms`);
        console.log(`  Throughput: ${throughput.toFixed(0)} files/sec`);

        expect(time).toBeLessThan(scale.count * 10); // < 10ms per file
      });

      it('execute speed', { timeout: 30000 }, async () => {
        const executor = new Executor(tempDir);

        const queries = [
          'select title, status',
          'select title where status = "todo"',
          'select title, toc()',
        ];

        const results: { query: string; time: number }[] = [];

        for (const query of queries) {
          const start = performance.now();
          await executor.execute(query);
          const end = performance.now();

          results.push({ query, time: end - start });
        }

        console.log(`\n${scale.name} Scale - Execute Speed:`);
        for (const r of results) {
          console.log(`  ${r.query}: ${r.time.toFixed(2)}ms`);
        }

        expect(results.every((r) => r.time < 1000)).toBe(true); // < 1s
      });

      it('end-to-end speed', { timeout: 60000 }, async () => {
        const executor = new Executor(tempDir);

        const queries = [
          'select title, status',
          'select title where status = "todo"',
          'select title, toc()',
        ];

        const results: { query: string; time: number }[] = [];

        for (const query of queries) {
          const start = performance.now();
          await executor.execute(query);
          const end = performance.now();
          results.push({ query, time: end - start });
        }

        console.log(`\n${scale.name} Scale - End-to-End:`);
        for (const r of results) {
          console.log(`  ${r.query}: ${r.time.toFixed(2)}ms`);
        }

        // Verify reasonable performance
        if (scale.count <= 10) {
          expect(results.every((r) => r.time < 100)).toBe(true); // < 100ms for small
        } else {
          expect(results.every((r) => r.time < 1000)).toBe(true); // < 1s for medium
        }
      });

      it('memory usage', { timeout: 30000 }, async () => {
        // Force GC if available
        if (global.gc) {
          global.gc();
        }

        const before = getMemoryUsage();

        const executor = new Executor(tempDir);
        await executor.execute('select title, toc()');

        const after = getMemoryUsage();
        const delta = {
          heapUsed: after.heapUsed - before.heapUsed,
          heapTotal: after.heapTotal - before.heapTotal,
          external: after.external - before.external,
          rss: after.rss - before.rss,
        };

        console.log(`\n${scale.name} Scale - Memory Usage:`);
        console.log(`  Heap Used: ${delta.heapUsed.toFixed(2)} MB`);
        console.log(`  Heap Total: ${delta.heapTotal.toFixed(2)} MB`);
        console.log(`  External: ${delta.external.toFixed(2)} MB`);
        console.log(`  RSS: ${delta.rss.toFixed(2)} MB`);
        console.log(`  Files processed: ${scale.count}`);
        console.log(`  Memory per file: ${((delta.heapUsed / scale.count) * 1024).toFixed(2)} KB`);

        // Verify reasonable memory usage
        if (scale.count <= 100) {
          expect(delta.heapUsed).toBeLessThan(50); // < 50MB
        } else {
          expect(delta.heapUsed).toBeLessThan(200); // < 200MB
        }
      });
    });
  }
});
