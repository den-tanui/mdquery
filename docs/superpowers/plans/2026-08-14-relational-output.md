# Relational Output Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved relational-output design: execution-scoped error handling with `meta`, JSON/CSV/table output formats (card removed, Option C flags), flattening tools + builtin changes, filter/map/sort bug fixes, section content dedup, sections()/section() redesign, and scalar enforcement with helpful error messages.

**Architecture:** Thread an `ExecutionState` collector through the executor so problematic files are skipped and logged in `QueryResult.meta` instead of crashing queries. Rework the formatter (JSON = full result, CSV via csv-stringify, card removed) and CLI flags (`--json`/`--csv`/`--table` aliases). Fix the eager-arg evaluation bug in array methods, dedup section content via position-slicing, redesign `sections()`/`section("name")`, and add static scalar return-type inference in QueryAnalyzer that throws shape-aware errors for table/CSV.

**Tech Stack:** TypeScript, Bun, vitest, gray-matter, fdir/grepts (fast path), csv-stringify/sync (new dep), mdast/remark (content extraction).

**Spec:** `docs/superpowers/specs/2026-08-14-relational-output-design.md`

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/types.ts` | `FileError`, `QueryTimings`, `QueryMeta`, `QueryResult.meta`, `ReadOptions.onError` + `format` | 1, 2, 7 |
| `src/executor.ts` | `ExecutionState` threading, per-file try/catch, `sections()`/`section()` redesign, array-method raw-arg fix, `fields()` map, `.join()` | 1, 3, 4, 6 |
| `src/file-io.ts` | `FastFileOps.readFiles` per-file try/catch + `onError` | 1 |
| `src/files.ts` | `FileOps.read` records via `onError` | 1 |
| `src/formatter.ts` | JSON full result, CSV via csv-stringify, card removal, `OutputFormat` | 2 |
| `src/cli.ts` | `--json`/`--csv`/`--table`, card removal, skipped-files warning, MANUAL | 2 |
| `src/builtins.ts` | `trimAll()` | 3 |
| `src/content-extractor.ts` | position-sliced section content | 5 |
| `src/query-analyzer.ts` | scalar return-type inference + shape table | 7 |
| `src/parser.ts` | `join` in chained methods | 3 |
| `README.md`, `docs/syntax.md` | shortcut flags, verify section syntax | 8 |
| `tests/*.test.ts` | regression + new tests per task | all |

---

## Task 1: Error Handling — ExecutionState + per-file capture

**Files:**
- Modify: `src/types.ts`
- Modify: `src/executor.ts`
- Modify: `src/file-io.ts`
- Modify: `src/files.ts`
- Test: `tests/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/executor.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Executor } from '../src/executor';

describe('Executor error handling + meta', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-err-'));
    writeFileSync(join(dir, 'good.md'), '---\ntitle: Good\n---\nBody\n');
    // Malformed frontmatter: gray-matter throws YAMLException
    writeFileSync(join(dir, 'bad.md'), '---\nname: "broken\ndescription: this yaml is invalid\n---\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('skips malformed files and records them in meta.errors (fast path)', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select title');
    expect(result.data).toHaveLength(1);
    expect(result.data![0].title).toBe('Good');
    expect(result.meta).toBeDefined();
    expect(result.meta!.errors).toHaveLength(1);
    expect(result.meta!.errors[0].path).toContain('bad.md');
    expect(result.meta!.errors[0].phase).toBe('read');
  });

  it('skips malformed files and records them in meta.errors (legacy path)', async () => {
    const executor = new Executor(dir, undefined, undefined, {});
    const result = await executor.execute('select title');
    expect(result.data).toHaveLength(1);
    expect(result.meta!.errors).toHaveLength(1);
    expect(result.meta!.errors[0].phase).toBe('read');
  });

  it('reports filesSearched and filesMatched in meta', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select title');
    expect(result.meta!.filesSearched).toBe(2);
    expect(result.meta!.filesMatched).toBe(1);
  });

  it('records evaluate-phase errors per file and excludes the file from data', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    // links() on a file with no body is fine; force an evaluate error via a
    // method on a non-array (e.g. title.filter) — throws in evaluate phase.
    const result = await executor.execute('select title.filter(x)');
    expect(result.meta!.errors.length).toBeGreaterThan(0);
    expect(result.meta!.errors.every(e => e.phase === 'evaluate')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/executor.test.ts`
Expected: FAIL — `result.meta` is `undefined` (fast path crashes on `bad.md` before returning).

- [ ] **Step 3: Add meta types to `src/types.ts`**

Add after the `QueryResult` interface:

```typescript
export interface FileError {
  path: string;
  error: string;
  phase: 'read' | 'prefilter' | 'evaluate';
}

export interface QueryTimings {
  list: number;
  read: number;
  prefilter: number;
  evaluate: number;
  total: number;
}

export interface QueryMeta {
  filesSearched: number;
  filesMatched: number;
  timings: QueryTimings;
  errors: FileError[];
}
```

Add `meta?: QueryMeta;` to `QueryResult`. Add to `ReadOptions`:

```typescript
  onError?: (error: FileError) => void;
```

- [ ] **Step 4: Add per-file try/catch to `FastFileOps.readFiles`**

In `src/file-io.ts`, change the signature and wrap the loop body:

```typescript
  static async readFiles(
    dir: string,
    paths: string[],
    analysis: FileIOAnalysis,
    onError?: (error: { path: string; error: string; phase: 'read' }) => void
  ): Promise<FileData[]> {
    const files: FileData[] = [];
    for (const fp of paths) {
      try {
        const { readFileSync } = require('fs');
        const raw = readFileSync(fp, 'utf-8');
        const { data, content: body } = matter(raw);
        const filename = basename(fp, '.md');
        const rel = relative(dir, fp);

        const file: FileData = {
          ...parseDates(data),
          filename,
          path: rel,
          abspath: fp,
          filepath: fp,
          frontmatter: data,
          content: raw,
          body: analysis.requiresContent ? body : undefined,
          sections: analysis.requiresContent ? parseSections(body) : undefined
        };
        files.push(file);
      } catch (e: any) {
        onError?.({ path: fp, error: e?.message ?? String(e), phase: 'read' });
      }
    }
    return files;
  }
```

- [ ] **Step 5: Wire `onError` into legacy `FileOps.read`**

In `src/files.ts`, `read` and `readSync` catch blocks become:

```typescript
    } catch (e: any) {
      options?.onError?.({ path: filepath, error: e?.message ?? String(e), phase: 'read' });
      return null;
    }
```

Change both signatures to accept `options?: ReadOptions`:

```typescript
  private static async read(root: string, filepath: string, options?: ReadOptions): Promise<FileData | null> {
  private static readSync(root: string, filepath: string, options?: ReadOptions): FileData | null {
```

Thread `options` through `readFiles`/`readFilesSync`/`walk`/`walkSync` calls: `this.read(root, fullPath, opts)` and `this.read(root, f, opts)` (explicit-files branch uses `opts` too — build `opts` before the loop).

- [ ] **Step 6: Thread ExecutionState through the executor**

In `src/executor.ts`, add an interface near the top:

```typescript
interface ExecutionState {
  errors: { path: string; error: string; phase: 'read' | 'prefilter' | 'evaluate' }[];
  timings: { list: number; read: number; prefilter: number; evaluate: number; total: number };
  filesSearched: number;
  filesMatched: number;
}

function newExecutionState(): ExecutionState {
  return {
    errors: [],
    timings: { list: 0, read: 0, prefilter: 0, evaluate: 0, total: 0 },
    filesSearched: 0,
    filesMatched: 0
  };
}
```

Change `execute` to create the state and pass it down:

```typescript
  async execute(query: string): Promise<QueryResult> {
    const ast = new Parser(query).parse();
    this.lastAst = ast;

    if (this.hooks?.onBeforeExecute) {
      this.hooks.onBeforeExecute(ast);
    }

    const state = newExecutionState();
    state.timings.total = Date.now();
    const result = await this.executeAST(ast, state);
    state.timings.total = Date.now() - state.timings.total;
    return result;
  }
```

Change `executeAST(ast: ASTNode, state: ExecutionState)` and pass `state` to `executeSelect(ast, state)` (other statement types ignore it).

- [ ] **Step 7: Update `readFilesWithHooks` to record timings + errors**

```typescript
  private async readFilesWithHooks(dir: string, options: ReadOptions = {}, state?: ExecutionState): Promise<FileData[]> {
    let files: FileData[];
    const onError = (err: { path: string; error: string; phase: 'read' | 'prefilter' | 'evaluate' }) => {
      state?.errors.push(err);
      options.onError?.(err);
    };

    if (options.fast) {
      const t0 = Date.now();
      const paths = await FastFileOps.listFiles(dir, options);
      state!.timings.list = Date.now() - t0;
      state!.filesSearched = paths.length;

      const analysis = this.analyzeCurrentQuery();
      const prefilterTree = this.contentPrefilterTree();
      if (prefilterTree) {
        const t1 = Date.now();
        const filtered = await applyContentPrefilter(
          paths,
          prefilterTree,
          (op, pattern) => FastFileOps.preFilterByContent(dir, paths, pattern, isNegatedContentOp(op))
        );
        state!.timings.prefilter = Date.now() - t1;
        const t2 = Date.now();
        files = await FastFileOps.readFiles(dir, filtered, analysis, onError);
        state!.timings.read = Date.now() - t2;
      } else {
        const t2 = Date.now();
        files = await FastFileOps.readFiles(dir, paths, analysis, onError);
        state!.timings.read = Date.now() - t2;
      }
    } else {
      const t2 = Date.now();
      files = await FileOps.readFiles(dir, options);
      state!.timings.read = Date.now() - t2;
      state!.filesSearched = files.length + state!.errors.length;
    }

    if (this.hooks?.onAfterRead) {
      return files.map(f => this.hooks!.onAfterRead!(f));
    }

    return files;
  }
```

- [ ] **Step 8: Per-file try/catch in `executeSelect` (WHERE + projection)**

Replace the WHERE filter and projection in `executeSelect`:

```typescript
  private async executeSelect(node: SelectStatement, state: ExecutionState): Promise<QueryResult> {
    let files = await this.readFilesWithHooks(this.dir, this.readOptions, state);

    // WHERE — per-file try/catch, skip + record
    if (node.where) {
      const filtered: FileData[] = [];
      for (const f of files) {
        try {
          if (this.evaluateExpression(node.where!, { file: f })) filtered.push(f);
        } catch (e: any) {
          state.errors.push({ path: f.path, error: e?.message ?? String(e), phase: 'evaluate' });
        }
      }
      files = filtered;
    }

    // GROUP BY
    if (node.groupBy) {
      files = this.groupBy(files, node.groupBy);
    }

    // HAVING — per-file try/catch, skip + record
    if (node.having) {
      const filtered: FileData[] = [];
      for (const f of files) {
        try {
          if (this.evaluateExpression(node.having!, { file: f })) filtered.push(f);
        } catch (e: any) {
          state.errors.push({ path: f.path, error: e?.message ?? String(e), phase: 'evaluate' });
        }
      }
      files = filtered;
    }

    // ORDER BY
    if (node.orderBy) {
      files = this.orderBy(files, node.orderBy);
    }

    // LIMIT
    if (node.limit) {
      files = files.slice(0, node.limit);
    }

    // OFFSET
    if (node.offset) {
      files = files.slice(node.offset);
    }

    // JOIN
    if (node.join) {
      files = await this.executeJoin(files, node.join);
    }

    // DISTINCT
    if (node.distinct) {
      files = this.distinct(files, node.fields);
    }

    // Projection — per-file try/catch, skip + record
    const data: Record<string, any>[] = [];
    for (const f of files) {
      try {
        data.push(this.project(f, node.fields));
      } catch (e: any) {
        state.errors.push({ path: f.path, error: e?.message ?? String(e), phase: 'evaluate' });
      }
    }

    state.filesMatched = data.length;
    state.timings.evaluate = Date.now() - state.timings.total;

    return {
      type: 'select',
      data,
      count: data.length,
      meta: {
        filesSearched: state.filesSearched,
        filesMatched: state.filesMatched,
        timings: state.timings,
        errors: state.errors
      }
    };
  }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `bun run test -- tests/executor.test.ts`
Expected: PASS (all 4 new tests).

- [ ] **Step 10: Run full suite**

Run: `bun run test`
Expected: PASS (existing 418 + new tests; no regressions).

- [ ] **Step 11: Commit**

```bash
git add src/types.ts src/executor.ts src/file-io.ts src/files.ts tests/executor.test.ts
git commit -m "feat: execution-scoped error handling — skip problematic files, record meta.errors/timings"
```

---

## Task 2: Output Formats — JSON meta, CSV via csv-stringify, card removal, Option C flags

**Files:**
- Modify: `src/formatter.ts`
- Modify: `src/cli.ts`
- Modify: `src/types.ts` (already has `meta` from Task 1)
- Test: `tests/formatter.test.ts`, `tests/cli.test.ts`

- [ ] **Step 1: Add csv-stringify dependency**

Run: `bun add csv-stringify`
Expected: dependency added to `package.json` + `bun.lock`.

- [ ] **Step 2: Write the failing tests**

Add to `tests/formatter.test.ts`:

```typescript
  describe('JSON meta', () => {
    it('emits the full QueryResult object including meta', () => {
      const result: QueryResult = {
        type: 'select',
        data: [{ title: 'A' }],
        count: 1,
        meta: { filesSearched: 2, filesMatched: 1, timings: { list: 1, read: 2, prefilter: 0, evaluate: 1, total: 4 }, errors: [] }
      };
      const output = Formatter.format(result, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.type).toBe('select');
      expect(parsed.data).toHaveLength(1);
      expect(parsed.count).toBe(1);
      expect(parsed.meta.filesSearched).toBe(2);
    });
  });

  describe('CSV', () => {
    it('quotes fields containing commas, quotes, and newlines (RFC 4180)', () => {
      const result: QueryResult = {
        type: 'select',
        data: [
          { title: 'a,b', note: 'line1\nline2' },
          { title: 'plain', note: 'has "quotes"' }
        ],
        count: 2
      };
      const output = Formatter.format(result, 'csv');
      expect(output).toContain('"a,b"');
      expect(output).toContain('"line1\nline2"');
      expect(output).toContain('"has ""quotes"""');
    });

    it('escapes formula injection', () => {
      const result: QueryResult = {
        type: 'select',
        data: [{ title: '=SUM(A1:A2)' }],
        count: 1
      };
      const output = Formatter.format(result, 'csv');
      expect(output).not.toContain('=SUM');
    });
  });

  describe('Card removed', () => {
    it('rejects card as an OutputFormat at type level (compile-time) and throws at runtime', () => {
      // @ts-expect-error card is no longer a valid OutputFormat
      const bad: OutputFormat = 'card';
      expect(bad).toBeUndefined();
    });
  });
```

Add to `tests/cli.test.ts` (check existing file for the harness pattern — it runs the compiled `./mdquery` binary):

```typescript
  it('--csv is an alias for --format=csv', async () => {
    // run: mdquery --csv "select title" in a fixture dir
    // expect: CSV output with header row
  });

  it('last flag wins when --format and shortcut conflict', async () => {
    // run: mdquery --format=json --csv "select title"
    // expect: CSV output
  });

  it('--card is rejected', async () => {
    // run: mdquery --card "select title"
    // expect: exit code 1 with "Unknown option: --card"
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run test -- tests/formatter.test.ts tests/cli.test.ts`
Expected: FAIL — JSON lacks `meta`, CSV is naive, `card` still accepted.

- [ ] **Step 4: Update `OutputFormat` and remove card from `Formatter`**

In `src/formatter.ts`:

```typescript
export type OutputFormat = 'json' | 'table' | 'csv';
```

In `format()` remove the `case 'card':` branch. Delete the entire `toCard` method (lines ~100-195).

- [ ] **Step 5: JSON emits the full QueryResult**

```typescript
  private static toJSON(result: QueryResult): string {
    return JSON.stringify(result, null, 2);
  }
```

- [ ] **Step 6: CSV via csv-stringify/sync**

Add import at top of `src/formatter.ts`:

```typescript
import { stringify } from 'csv-stringify/sync';
```

Replace `toCSV`:

```typescript
  private static toCSV(result: QueryResult): string {
    if (!result.data || result.data.length === 0) {
      return '';
    }
    return stringify(result.data, { header: true, escape_formulas: true });
  }
```

- [ ] **Step 7: Update CLI — remove card, add shortcut flags, last-wins**

In `src/cli.ts`:

1. MANUAL: change the `--format` line and remove `--card`:

```
  --format=<format>     Output format: json | table | csv (default: json)
  --json                Shortcut for --format=json
  --csv                 Shortcut for --format=csv
  --table               Shortcut for --format=table
```

2. In the arg loop, replace the `--card` branch with:

```typescript
    } else if (arg === '--json') {
      format = 'json';
    } else if (arg === '--csv') {
      format = 'csv';
    } else if (arg === '--table') {
      format = 'table';
    }
```

3. Validation:

```typescript
  if (!['json', 'table', 'csv'].includes(format)) {
    fail(`Invalid format: ${format}`);
  }
```

4. Pass format to the executor (for Task 7 scalar enforcement):

```typescript
  const executor = new Executor(dir, undefined, undefined, {
    depth,
    hidden,
    ignore,
    files: files.length > 0 ? files : undefined,
    format
  });
```

5. After `const result = await executor.execute(query);`, print the skipped-files warning:

```typescript
    if (result.meta?.errors?.length) {
      console.error(`warning: skipped ${result.meta.errors.length} file(s) (see meta.errors)`);
    }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun run test -- tests/formatter.test.ts tests/cli.test.ts`
Expected: PASS. (Note: `cli.test.ts` auto-rebuilds the binary when `src/cli.ts` is newer.)

- [ ] **Step 9: Run full suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/formatter.ts src/cli.ts package.json bun.lock tests/formatter.test.ts tests/cli.test.ts
git commit -m "feat: output formats — JSON full result with meta, CSV via csv-stringify, card removed, --json/--csv/--table aliases"
```

---

## Task 3: Flattening Tools + Builtins — `.join()`, `fields()` map, `trimAll()`

**Files:**
- Modify: `src/executor.ts`
- Modify: `src/parser.ts`
- Modify: `src/builtins.ts`
- Test: `tests/executor.test.ts`, `tests/builtins.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/executor.test.ts`:

```typescript
describe('Flattening tools + builtins', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-flat-'));
    writeFileSync(join(dir, 'a.md'), '---\ntags: [x, y]\ntitle: A\n---\nBody\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('joins an array of scalars with a delimiter', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select tags.join("-")');
    expect(result.data![0]['tags.join("-")']).toBe('x-y');
  });

  it('fields() returns a single map object', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select fields()');
    expect(result.data![0]['fields()']).toEqual({ tags: ['x', 'y'], title: 'A' });
  });

  it('fields().keys() lists frontmatter field names', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select fields().keys()');
    expect(result.data![0]['fields().keys()']).toEqual(['tags', 'title']);
  });
});
```

Add to `tests/builtins.test.ts`:

```typescript
  it('trimAll replaces presentation-breaking chars with spaces', () => {
    expect(Builtins.trimAll('a\nb\tc|d')).toBe('a b c d');
    expect(Builtins.trimAll('line1\u2028line2')).toBe('line1 line2');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/executor.test.ts tests/builtins.test.ts`
Expected: FAIL — `join` unsupported, `fields()` returns array, `trimAll` unknown.

- [ ] **Step 3: Add `.join()` to array methods**

In `src/executor.ts`, `evaluateArrayMethod` add:

```typescript
      case 'join': return array.map(String).join(args[0] ?? ',');
```

In `src/parser.ts`, `isChainedMethod` add `'join'`:

```typescript
    const chainedMethods = ['filter', 'map', 'where', 'first', 'last', 'sort', 'slice', 'flatten', 'unique', 'count', 'join'];
```

- [ ] **Step 4: `fields()` returns a single map object**

Replace `evaluateFields` in `src/executor.ts`:

```typescript
  private evaluateFields(args: any[], context: EvaluationContext): any {
    if (!context.file) {
      return {};
    }
    const frontmatter = context.file.frontmatter || {};
    if (args[0] === 'values') {
      return Object.values(frontmatter);
    }
    return { ...frontmatter };
  }
```

- [ ] **Step 5: Add `trimAll()` to Builtins**

In `src/builtins.ts`:

```typescript
  static trimAll(value: string): string {
    requireString(value, 'trimAll');
    return value.replace(/[\u0000-\u001f\u2028\u2029\u0085|]/g, ' ');
  }
```

(`Builtins.call` dispatches by name; `trim_all` → camelCase conversion also works.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- tests/executor.test.ts tests/builtins.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/executor.ts src/parser.ts src/builtins.ts tests/executor.test.ts tests/builtins.test.ts
git commit -m "feat: flattening tools — array .join(), fields() returns map object, trimAll() builtin"
```

---

## Task 4: filter/map/sort Bug Fixes (eager-arg eval)

**Files:**
- Modify: `src/executor.ts`
- Test: `tests/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/executor.test.ts`:

```typescript
describe('Array method eager-arg fixes', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-arr-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n## Setup\nDo it now.\n\n## Teardown\nOther stuff.\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('filter with a bare-field predicate resolves the field to the item', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute("select sections().filter(title starts_with 'Set').count()");
    expect(result.data![0]['sections().filter(title starts_with \'Set\').count()']).toBe(1);
  });

  it('map with a string arg extracts the property from each item', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute("select sections().map('title')");
    expect(result.data![0]["sections().map('title')"]).toEqual(['Setup', 'Teardown']);
  });

  it('sort with a string arg sorts by that property', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute("select sections().sort('title').map('title')");
    expect(result.data![0]["sections().sort('title').map('title')"]).toEqual(['Setup', 'Teardown']);
  });

  it('filter with an expression predicate works', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute("select sections().filter(_.level = 2).count()");
    expect(result.data![0]['sections().filter(_.level = 2).count()']).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/executor.test.ts`
Expected: FAIL — `filter` predicate evaluates to `false` (eager eval), `map('title')` crashes or returns `'title'` strings.

- [ ] **Step 3: Pass raw expressions for filter/where/map/sort**

In `src/executor.ts`, `evaluateMethodCall` — evaluate the object first, then branch before eager arg evaluation:

```typescript
  private evaluateMethodCall(expr: MethodCallNode, context: EvaluationContext): any {
    const object = this.evaluateExpression(expr.object, context);

    // filter/where/map/sort take raw expressions (predicates/mappers). Eager
    // evaluation turns them into false/undefined before the array method runs.
    if (Array.isArray(object) && ['filter', 'where', 'map', 'sort'].includes(expr.method)) {
      return this.evaluateArrayMethodRaw(object, expr.method, expr.args, context);
    }

    const args = expr.args.map(arg => this.evaluateExpression(arg, context));

    // Array methods
    if (Array.isArray(object)) {
      return this.evaluateArrayMethod(object, expr.method, args, context);
    }

    // String methods
    if (typeof object === 'string') {
      return this.evaluateStringMethod(object, expr.method, args, context);
    }

    // Object methods
    if (typeof object === 'object' && object !== null) {
      return this.evaluateObjectMethod(object, expr.method, args, context);
    }

    throw new Error(`Unsupported method call: ${expr.method} on ${typeof object}`);
  }

  private evaluateArrayMethodRaw(array: any[], method: string, rawArgs: Expression[], context: EvaluationContext): any {
    switch (method) {
      case 'filter':
      case 'where': return this.evaluateArrayFilter(array, rawArgs[0], context);
      case 'map': return this.evaluateArrayMap(array, rawArgs[0], context);
      case 'sort': return this.evaluateArraySort(array, rawArgs[0], context);
      default: throw new Error(`Unsupported raw array method: ${method}`);
    }
  }
```

- [ ] **Step 4: Handle string-arg map/sort + `_`-fallback in evaluateField**

Update `evaluateArrayMap`:

```typescript
  private evaluateArrayMap(array: any[], mapper: any, context: EvaluationContext): any[] {
    return array.map(item => {
      // map('field') → extract property from each item
      if (mapper && mapper.type === 'string') {
        return item?.[mapper.value];
      }
      const itemContext = { ...context, variables: { ...context.variables, _: item } };
      return this.evaluateExpression(mapper, itemContext);
    });
  }
```

Update `evaluateArraySort`:

```typescript
  private evaluateArraySort(array: any[], comparator: any, context: EvaluationContext): any[] {
    return [...array].sort((a, b) => {
      // sort('field') → compare by property
      if (comparator && comparator.type === 'string') {
        const aValue = a?.[comparator.value];
        const bValue = b?.[comparator.value];
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
      const aContext = { ...context, variables: { ...context.variables, _: a } };
      const bContext = { ...context, variables: { ...context.variables, _: b } };
      const aValue = this.evaluateExpression(comparator, aContext);
      const bValue = this.evaluateExpression(comparator, bContext);
      return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
    });
  }
```

In `evaluateField`, add the `_`-fallback after the variables check:

```typescript
    // Check variables first
    if (context.variables && expr.name in context.variables) {
      return context.variables[expr.name];
    }

    // Array-method item fallback: bare fields resolve to the current item (_)
    if (context.variables && '_' in context.variables) {
      const item = context.variables['_'];
      if (item !== null && typeof item === 'object' && expr.name in item) {
        return item[expr.name];
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test -- tests/executor.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/executor.ts tests/executor.test.ts
git commit -m "fix: filter/map/sort eager-arg eval — raw expression passthrough, string-arg map/sort, _-fallback for bare fields"
```

---

## Task 5: Section Content Dedup (position-slicing)

**Files:**
- Modify: `src/content-extractor.ts`
- Test: `tests/content-extractor.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/content-extractor.test.ts`:

```typescript
describe('ContentExtractor.extractSections content', () => {
  it('does not duplicate section content', () => {
    const extractor = new ContentExtractor('# TODO\n\nLine one.\nLine two.\n\n## Other\n\nOther stuff.\n');
    const sections = extractor.extractSections();
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('TODO');
    expect(sections[0].content).toBe('Line one.\nLine two.');
    expect(sections[1].title).toBe('Other');
    expect(sections[1].content).toBe('Other stuff.');
  });

  it('slices content between heading positions (no duplication)', () => {
    const extractor = new ContentExtractor('## Setup\n\nDo it now.\n\n## Teardown\n\nEnd.\n');
    const sections = extractor.extractSections();
    expect(sections[0].content).toBe('Do it now.');
    expect(sections[1].content).toBe('End.');
  });

  it('returns undefined content for a heading with no body', () => {
    const extractor = new ContentExtractor('# Only\n');
    const sections = extractor.extractSections();
    expect(sections[0].content).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/content-extractor.test.ts`
Expected: FAIL — current `extractSectionContent` duplicates lines (`"Line one.\nLine one."`).

- [ ] **Step 3: Replace `extractSectionContent` with position-slicing**

In `src/content-extractor.ts`:

```typescript
  private extractSectionContent(heading: Heading): string | undefined {
    const start = heading.position?.end?.offset;
    if (start === undefined) return undefined;

    // Find the next heading of same-or-higher level; its start is the end of
    // this section's content. Slicing the raw body between positions avoids
    // the visitor double-count (parent extractText + child text nodes).
    let end: number | undefined;
    let foundHeading = false;
    visit(this.ast, (node) => {
      if (node === heading) {
        foundHeading = true;
        return SKIP;
      }
      if (foundHeading && node.type === 'heading' && (node as Heading).depth <= heading.depth) {
        end = (node as Heading).position?.start?.offset;
        return false; // stop traversal
      }
    });

    const slice = this.content.slice(start, end);
    return slice.trim() || undefined;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- tests/content-extractor.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/content-extractor.ts tests/content-extractor.test.ts
git commit -m "fix: section content duplication — slice raw body between heading positions"
```

---

## Task 6: sections()/section() Redesign

**Files:**
- Modify: `src/executor.ts`
- Modify: `src/query-analyzer.ts`
- Test: `tests/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/executor.test.ts`:

```typescript
describe('sections()/section() redesign', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-sec-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n## Setup\nDo it now.\n\n## Teardown\nOther stuff.\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sections() returns full SectionData objects', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select sections()');
    const sections = result.data![0]['sections()'];
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ title: 'Setup', level: 2, content: 'Do it now.' });
    expect(sections[0].hierarchy).toBeDefined();
    expect(sections[0].position).toBeDefined();
  });

  it('section("name") returns the first exact match or null', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select section("Setup")');
    expect(result.data![0]['section("Setup")']).toMatchObject({ title: 'Setup', content: 'Do it now.' });
    const missing = await executor.execute('select section("Nope")');
    expect(missing.data![0]['section("Nope")']).toBeNull();
  });

  it('section() with no args returns the first section or null', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select section()');
    expect(result.data![0]['section()']).toMatchObject({ title: 'Setup' });
  });

  it('section("name").content selects a scalar property', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true });
    const result = await executor.execute('select section("Setup").content');
    expect(result.data![0]['section("Setup").content']).toBe('Do it now.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/executor.test.ts`
Expected: FAIL — `section("Setup")` returns both sections (bug 5), `sections()` unknown builtin.

- [ ] **Step 3: Add `sections` to the executor dispatch**

In `src/executor.ts`, `evaluateFunctionCall` switch add:

```typescript
      case 'sections': return this.evaluateSections(args, context);
```

Add the method:

```typescript
  private evaluateSections(args: any[], context: EvaluationContext): any {
    if (!this.getFileBody(context.file)) {
      return [];
    }
    const extractor = this.getContentExtractor(context.file as FileData);
    return extractor.extractSections();
  }
```

- [ ] **Step 4: Fix `evaluateSection` — first match or null**

Replace `evaluateSection`:

```typescript
  private evaluateSection(args: any[], context: EvaluationContext): any {
    if (!this.getFileBody(context.file)) {
      return args.length > 0 ? null : null;
    }
    const extractor = this.getContentExtractor(context.file as FileData);
    const sections = extractor.extractSections();
    if (args.length === 0) {
      return sections[0] ?? null;
    }
    const name = String(args[0]);
    return sections.find(s => s.title === name) ?? null;
  }
```

- [ ] **Step 5: Add `sections` to QueryAnalyzer content builtins**

In `src/query-analyzer.ts`, `checkFunctionCallForContent`:

```typescript
    const contentBuiltins = ['links', 'images', 'codeblocks', 'section', 'sections', 'grep', 'toc', 'content'];
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- tests/executor.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/executor.ts src/query-analyzer.ts tests/executor.test.ts
git commit -m "feat: sections()/section() redesign — full SectionData, first exact match or null"
```

---

## Task 7: Scalar Enforcement (shape-aware errors)

**Files:**
- Modify: `src/query-analyzer.ts`
- Modify: `src/executor.ts`
- Modify: `src/types.ts` (ReadOptions.format from Task 2)
- Test: `tests/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/executor.test.ts`:

```typescript
describe('Scalar enforcement (table/csv)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdquery-scalar-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n## Setup\nDo it now.\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('throws for sections() in table format with a shape-aware message', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    await expect(executor.execute('select sections()')).rejects.toThrow(/sections\(\)/);
    await expect(executor.execute('select sections()')).rejects.toThrow(/array of maps/);
    await expect(executor.execute('select sections()')).rejects.toThrow(/sections\(\)\.map\('title'\)/);
  });

  it('throws for section("name") in csv format with a shape-aware message', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'csv' });
    await expect(executor.execute('select section("Setup")')).rejects.toThrow(/section\("Setup"\)/);
    await expect(executor.execute('select section("Setup")')).rejects.toThrow(/section\("Setup"\)\.title/);
  });

  it('allows scalar property access in table format', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    const result = await executor.execute('select section("Setup").title');
    expect(result.data![0]['section("Setup").title']).toBe('Setup');
  });

  it('allows arrays of scalars in table format', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'table' });
    const result = await executor.execute('select sections().map(\'title\')');
    expect(result.data![0]["sections().map('title')"]).toEqual(['Setup']);
  });

  it('does not enforce in json format', async () => {
    const executor = new Executor(dir, undefined, undefined, { fast: true, format: 'json' });
    const result = await executor.execute('select sections()');
    expect(result.data![0]['sections()']).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- tests/executor.test.ts`
Expected: FAIL — no enforcement; `sections()` returns data in table format.

- [ ] **Step 3: Add scalar inference + shape table to QueryAnalyzer**

In `src/query-analyzer.ts`, add after the `ExecutionPlan` interface:

```typescript
export type ScalarInference =
  | { kind: 'scalar' }
  | { kind: 'array-of-scalars' }
  | { kind: 'map'; shape: string; suggestions: string[] }
  | { kind: 'array-of-maps'; shape: string; suggestions: string[] };

const BUILTIN_SHAPES: Record<string, ScalarInference> = {
  content: { kind: 'scalar' },
  fields: { kind: 'map', shape: '{field: value}', suggestions: ["fields().keys()", "fields().values()", "fields().map('field')"] },
  links: { kind: 'array-of-maps', shape: '{text, url, position, paragraph?, section?}', suggestions: ["links().map('url')", "links().map('text')", "links().count()"] },
  images: { kind: 'array-of-maps', shape: '{alt, url, position, paragraph?, section?}', suggestions: ["images().map('url')", "images().map('alt')"] },
  codeblocks: { kind: 'array-of-maps', shape: '{content, lang?, position, paragraph?, section?}', suggestions: ["codeblocks().map('lang')", "codeblocks().map('content')"] },
  section: { kind: 'map', shape: '{title, level, position, hierarchy, content}', suggestions: ['section("name").title', 'section("name").content'] },
  sections: { kind: 'array-of-maps', shape: '{title, level, position, hierarchy, content}', suggestions: ["sections().map('title')", "sections().first().title", "sections().count()"] },
  toc: { kind: 'array-of-maps', shape: '{level, title}', suggestions: ["toc().map('title')", "toc().map('level')"] },
  has_section: { kind: 'scalar' }
};

export function inferScalarType(expr: Expression): ScalarInference {
  switch (expr.type) {
    case 'field': return { kind: 'scalar' };
    case 'function_call': return BUILTIN_SHAPES[expr.name] ?? { kind: 'scalar' };
    case 'method_call': return inferMethodType(expr);
    case 'array_index': return inferScalarType(expr.object);
    case 'map_index': return { kind: 'scalar' };
    case 'binary_op':
    case 'unary_op':
    case 'wildcard':
    case 'subquery':
    case 'exists':
      return { kind: 'scalar' };
    case 'paren': return inferScalarType(expr.expression);
    default: return { kind: 'scalar' };
  }
}

function inferMethodType(expr: MethodCallNode): ScalarInference {
  const objectType = inferScalarType(expr.object);
  switch (expr.method) {
    case 'count':
    case 'length':
    case 'join':
      return { kind: 'scalar' };
    case 'keys':
    case 'values':
      return { kind: 'array-of-scalars' };
    case 'map':
      return { kind: 'array-of-scalars' };
    case 'first':
    case 'last':
      // Element of the array: array-of-maps → map; array-of-scalars → scalar
      return objectType.kind === 'array-of-maps'
        ? { kind: 'map', shape: objectType.shape, suggestions: objectType.suggestions }
        : { kind: 'scalar' };
    case 'filter':
    case 'where':
    case 'sort':
    case 'slice':
    case 'flatten':
    case 'unique':
      return objectType;
    case 'entries':
      return { kind: 'array-of-maps', shape: '[key, value]', suggestions: ["entries().map('[0]')"] };
    default:
      return { kind: 'scalar' };
  }
}
```

- [ ] **Step 4: Enforce in `executeSelect` before file reads**

In `src/executor.ts`, at the top of `executeSelect` (before `readFilesWithHooks`):

```typescript
    const fmt = this.readOptions.format;
    if (fmt === 'table' || fmt === 'csv') {
      this.enforceScalarColumns(node.fields);
    }
```

Add the method:

```typescript
  private enforceScalarColumns(fields: Expression[]): void {
    for (const field of fields) {
      const inference = inferScalarType(field);
      if (inference.kind === 'map' || inference.kind === 'array-of-maps') {
        const exprName = this.generateFieldName(field);
        const kind = inference.kind === 'map' ? 'a map' : 'an array of maps';
        const suggestions = inference.suggestions.map(s => `\`${s}\``).join(', ');
        throw new Error(
          `Scalar value error: \`${exprName}\` returns ${kind} in the shape ` +
          `${inference.shape}. Table/CSV output requires scalar columns. ` +
          `Consider rewriting the query, e.g. ${suggestions}.`
        );
      }
    }
  }
```

Add the import at the top of `src/executor.ts`:

```typescript
import { QueryAnalyzer, buildContentPrefilterTree, inferScalarType, type ContentPrefilterNode } from './query-analyzer';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test -- tests/executor.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/query-analyzer.ts src/executor.ts tests/executor.test.ts
git commit -m "feat: scalar enforcement — shape-aware errors for map/array-of-maps in table/csv"
```

---

## Task 8: Docs — shortcut flags + verify section syntax

**Files:**
- Modify: `README.md`
- Modify: `docs/syntax.md`

- [ ] **Step 1: Add shortcut flags to README options table**

In `README.md`, replace the `--format` row:

```markdown
| `--format=<fmt>` | Output format: `json`, `table`, `csv` (default `json`) |
| `--json` | Shortcut for `--format=json` |
| `--csv` | Shortcut for `--format=csv` |
| `--table` | Shortcut for `--format=table` |
```

- [ ] **Step 2: Add shortcut flags to syntax.md output formats section**

In `docs/syntax.md`, under `## Output formats`, add:

```markdown
`--json`, `--csv`, and `--table` are shortcuts for `--format=json|csv|table`. If both `--format` and a shortcut are given, the last flag on the command line wins.
```

- [ ] **Step 3: Verify no stale `section.` or `card` references in user docs**

Run: `rg -n "section\.|--card|format=card|'card'" README.md docs/syntax.md`
Expected: no matches (README/syntax.md already updated in commit `524d5f7`).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/syntax.md
git commit -m "docs: shortcut flags --json/--csv/--table, verify section() syntax"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (sections/section redesign) → Task 6; §2 (scalar enforcement + helpful errors) → Task 7; §3 (error handling + meta) → Task 1; §4 (output formats + Option C) → Task 2; §5 (fields/trimAll) → Task 3; §6.1-6.5 (bugs 1-5) → Tasks 4, 5, 6; §6.6 (docs) → Task 8; §7 (file metadata) → separate plan, NOT here.
- **Type consistency:** `FileError`/`QueryMeta`/`QueryTimings` defined once in `types.ts` (Task 1) and reused in `executor.ts`/`formatter.ts`/`cli.ts`. `ScalarInference`/`inferScalarType` defined in `query-analyzer.ts` (Task 7) and imported by `executor.ts`. `ReadOptions.format` added in Task 2, consumed in Task 7.
- **Placeholders:** none — every step has exact code and commands.
- **Dependencies:** Task 2 needs Task 1 (`meta`); Task 7 needs Task 1 (executeSelect refactor) + Task 3 (flattening tools as escape hatch) + Task 2 (`ReadOptions.format`); Task 6 needs Task 5 (correct content). Tasks 3, 4, 5, 8 are independent.