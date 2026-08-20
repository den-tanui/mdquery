// tests/benchmark-cli-input.test.ts
// End-to-end CLI benchmark comparing input modes:
//   --dir <path>          mdquery discovers files itself (fdir)
//   find | -f -           external discovery, paths piped via stdin
//   fd | -f -             external discovery (if fd is installed)
//   -f - (pre-gen paths)  stdin ingestion only, no discovery cost

import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { performance } from 'perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cliPath = join(__dirname, '..', 'bin', 'mdquery');
const srcCliPath = join(__dirname, '..', 'src', 'cli.ts');

function binaryIsFresh(): boolean {
  if (!existsSync(cliPath)) return false;
  return statSync(cliPath).mtime >= statSync(srcCliPath).mtime;
}

function generateTask(id: number): string {
  const frontmatter = [
    `id: ${id}`,
    `title: "Task ${id}"`,
    `status: ${id % 3 === 0 ? 'todo' : id % 3 === 1 ? 'doing' : 'done'}`,
    `priority: ${(id % 5) + 1}`,
    `createdAt: 2026-01-${String((id % 28) + 1).padStart(2, '0')}T10:00:00Z`,
  ].join('\n');
  const body = `# Task ${id}\n\n## Section 1\n\nSome content mentioning BUG-${id}.\n\n## Section 2\n\nMore lines.\n`;
  return `---\n${frontmatter}\n---\n\n${body}`;
}

function timeSync(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('Benchmark: CLI input modes (--dir vs piped paths)', () => {
  const scales = [
    { name: 'Small', count: 10 },
    { name: 'Medium', count: 100 },
    { name: 'Large', count: 1000 },
    // XLarge commented out for CI — run locally with --testNamePattern="XLarge"
    // { name: 'XLarge', count: 10000 },
  ];

  const queries = [
    { name: 'frontmatter', query: 'SELECT title, status' },
    { name: 'content', query: 'SELECT title, toc()' },
  ];

  for (const scale of scales) {
    describe(`${scale.name} (${scale.count} files)`, () => {
      let dir: string;
      let paths: string;

      beforeAll(() => {
        if (!binaryIsFresh()) {
          execFileSync('bun', ['run', 'build:cli'], { cwd: join(__dirname, '..') });
        }
        dir = mkdtempSync(join(tmpdir(), 'mdquery-cli-bench-'));
        for (let i = 0; i < scale.count; i++) {
          writeFileSync(join(dir, `task-${i}.md`), generateTask(i));
        }
        paths = Array.from({ length: scale.count }, (_, i) => join(dir, `task-${i}.md`)).join('\n');
      });

      afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
      });

      for (const q of queries) {
        it(`${q.name} query: --dir vs find/fd piped paths`, { timeout: 120000 }, () => {
          // 1. --dir: mdquery discovers files itself (fdir)
          const dirTime = timeSync(() => {
            execFileSync(cliPath, ['--dir', dir, q.query], {
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'pipe'],
            });
          });

          // 2. find | mdquery -f -: external discovery + pipe
          const findTime = timeSync(() => {
            execFileSync(
              'sh',
              ['-c', `find "${dir}" -name '*.md' | "${cliPath}" -f - "${q.query}"`],
              { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
            );
          });

          // 3. fd | mdquery -f -: external discovery + pipe (if installed)
          let fdTime: number | null = null;
          try {
            fdTime = timeSync(() => {
              execFileSync('sh', ['-c', `fd -e md . "${dir}" | "${cliPath}" -f - "${q.query}"`], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe'],
              });
            });
          } catch {
            fdTime = null; // fd not installed — skip
          }

          // 4. -f - with pre-generated paths: stdin ingestion only (no discovery)
          const stdinTime = timeSync(() => {
            execFileSync(cliPath, ['-f', '-', q.query], {
              encoding: 'utf-8',
              input: paths,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
          });

          console.log(`\n[${scale.name}] ${scale.count} files, ${q.name} query: ${q.query}`);
          console.log(`  --dir (fdir discovery): ${dirTime.toFixed(2)}ms`);
          console.log(`  find | -f -:            ${findTime.toFixed(2)}ms`);
          if (fdTime !== null) console.log(`  fd | -f -:              ${fdTime.toFixed(2)}ms`);
          console.log(`  -f - (pre-gen paths):   ${stdinTime.toFixed(2)}ms`);

          // Loose sanity: --dir discovery must not be pathologically slower than
          // external discovery (10x + 200ms noise floor for CI variance)
          expect(dirTime).toBeLessThan(findTime * 10 + 200);
          if (fdTime !== null) expect(dirTime).toBeLessThan(fdTime * 10 + 200);
        });
      }
    });
  }
});
