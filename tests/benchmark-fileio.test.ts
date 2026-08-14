// tests/benchmark-fileio.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { FileOps } from '../src/files';
import { FastFileOps } from '../src/file-io';
import { LegacyFileOps } from './fixtures/legacy-files';

function generateTask(id: number): string {
  const frontmatter = [
    `id: ${id}`,
    `title: "Task ${id}"`,
    `status: ${id % 3 === 0 ? 'todo' : id % 3 === 1 ? 'doing' : 'done'}`,
    `priority: ${id % 5 + 1}`,
    `createdAt: 2026-01-${String(id % 28 + 1).padStart(2, '0')}T10:00:00Z`
  ].join('\n');
  const body = `# Task ${id}\n\n## Section 1\n\nSome content mentioning BUG-${id}.\n\n## Section 2\n\nMore lines.\n`;
  return `---\n${frontmatter}\n---\n\n${body}`;
}

async function time<T>(fn: () => Promise<T>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

describe('Benchmark: File I/O (legacy vs current vs fdir/grepts)', () => {
  const scales = [
    { name: 'Small', count: 10 },
    { name: 'Medium', count: 100 },
    { name: 'Large', count: 1000 }
  ];

  for (const scale of scales) {
    describe(`${scale.name} (${scale.count} files)`, () => {
      let dir: string;

      beforeAll(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdquery-fio-bench-'));
        for (let i = 0; i < scale.count; i++) {
          await fs.writeFile(path.join(dir, `task-${i}.md`), generateTask(i));
        }
      });

      afterAll(async () => {
        await fs.rm(dir, { recursive: true, force: true });
      });

      it('lists files', { timeout: 60000 }, async () => {
        const legacy = await time(() => LegacyFileOps.readFiles(dir));
        const current = await time(() => FileOps.readFiles(dir));
        const fast = await time(() => FastFileOps.listFiles(dir));

        console.log(`\n[${scale.name}] list ${scale.count} files:`);
        console.log(`  legacy (walk+read): ${legacy.toFixed(2)}ms`);
        console.log(`  current (walk+read): ${current.toFixed(2)}ms`);
        console.log(`  fdir (list only):   ${fast.toFixed(2)}ms`);

        // fdir listing alone must be dramatically faster than full walk+read
        expect(fast).toBeLessThan(current);
      });

      it('reads files (frontmatter only)', { timeout: 60000 }, async () => {
        const paths = await FastFileOps.listFiles(dir);
        const analysis = { requiresContent: false, bodyPredicates: [] as { field: string; op: string; value: string }[] };

        const legacy = await time(() => LegacyFileOps.readFiles(dir));
        const current = await time(() => FileOps.readFiles(dir));
        const fast = await time(() => FastFileOps.readFiles(dir, paths, analysis));

        console.log(`\n[${scale.name}] read ${scale.count} files (frontmatter only):`);
        console.log(`  legacy: ${legacy.toFixed(2)}ms`);
        console.log(`  current: ${current.toFixed(2)}ms`);
        console.log(`  fdir/grepts (lazy): ${fast.toFixed(2)}ms`);

        // Allow a small tolerance: at Small scale (10 files) sub-ms timer noise
        // dominates, but a real regression (e.g. the async readFile path, which
        // measured ~3x slower) must still fail. 1.5x + 1ms noise floor.
        expect(fast).toBeLessThanOrEqual(current * 1.5 + 1);
      });

      it('pre-filters content with grepts', { timeout: 60000 }, async () => {
        const paths = await FastFileOps.listFiles(dir);
        const pattern = `BUG-${Math.floor(scale.count / 2)}`;

        const start = performance.now();
        const matches = await FastFileOps.preFilterByContent(dir, paths, pattern);
        const fast = performance.now() - start;

        console.log(`\n[${scale.name}] pre-filter content for "${pattern}":`);
        console.log(`  fdir/grepts: ${fast.toFixed(2)}ms (${matches.length} matches)`);

        expect(matches.length).toBeGreaterThan(0);
      });
    });
  }
});
