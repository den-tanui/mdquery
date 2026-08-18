# Library tutorial

Run your first mdquery in under 5 minutes. Each section builds on the previous one.

## Prerequisites

- **Bun** (recommended) or Node.js 18+
- TypeScript optional — all examples work in plain JS too

## Installation

```bash
bun add @den-tanui/mdquery
# or
npm install @den-tanui/mdquery
```

## Your first query

Create a file `demo.ts` and paste this complete script:

```typescript
import { Executor, Formatter } from '@den-tanui/mdquery';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 1. Set up some markdown files with YAML frontmatter
const dir = mkdtempSync(join(tmpdir(), 'mdquery-demo-'));

writeFileSync(join(dir, 'auth.md'), `---
title: Implement login flow
status: in-progress
priority: high
tags: [auth, backend]
---

## TODO
- Add OAuth provider
- Write unit tests
`);

writeFileSync(join(dir, 'docs.md'), `---
title: Write API reference
status: todo
priority: medium
tags: [docs]
---

## Notes
External docs need更新.
`);

writeFileSync(join(dir, 'deps.md'), `---
title: Upgrade dependencies
status: done
priority: low
tags: [maintenance]
---

Everything upgraded on 2026-01-15.
`);

// 2. Run a query
const executor = new Executor(dir);
const result = await executor.execute("select title, status, priority where status != 'done' order by priority");

// 3. Print results
console.log(`Found ${result.count} tasks:\n`);
console.log(Formatter.format(result, 'table'));
```

Run it:

```bash
bun run demo.ts
```

You should see a formatted table with the two non-done tasks.

## Understanding the result

`executor.execute()` returns a `QueryResult`:

```typescript
interface QueryResult {
  type: 'select' | 'update' | 'create' | 'delete';
  data?: Record<string, any>[];   // result rows
  count?: number;                  // number of rows
  meta?: QueryMeta;                // execution metadata
}
```

Key fields:

- **`result.data`** — Array of objects. Each object has the fields you selected, plus identity fields (`filename`, `path`, `abspath`).
- **`result.count`** — Number of rows returned (same as `result.data.length` for SELECT).
- **`result.meta`** — Execution stats and any errors that occurred.

```typescript
// Access metadata
console.log('Files searched:', result.meta?.filesSearched);
console.log('Files matched:', result.meta?.filesMatched);
console.log('Total time:', result.meta?.timings.total, 'ms');
console.log('Errors:', result.meta?.errors);
```

## Reading specific directories

By default, Executor reads all `.md` files recursively in the given directory. You can control this with `ReadOptions`:

```typescript
import { Executor } from '@den-tanui/mdquery';

// Limit depth (1 = top-level only)
const executor1 = new Executor('./tasks', undefined, undefined, { depth: 1 });

// Include hidden files
const executor2 = new Executor('./tasks', undefined, undefined, { hidden: true });

// Query multiple directories — each result row gets a source_dir field
const executor3 = new Executor(['./tasks', './inbox']);
const result = await executor3.execute("select title, status");

// Query specific files
const executor4 = new Executor('./tasks', undefined, undefined, {
  files: ['auth.md', 'docs.md']
});
```

## Filtering and sorting

Query strings support SQL-like syntax:

```typescript
const executor = new Executor('./tasks');

// WHERE clause — filter results
await executor.execute("select title where status = 'todo'");
await executor.execute("select title where priority in ['high', 'critical']");
await executor.execute("select title where tags contains 'backend'");

// ORDER BY — sort results
await executor.execute("select title order by priority");
await executor.execute("select title order by created_at desc");

// LIMIT — cap results
await executor.execute("select title order by priority limit 5");

// Combine them
await executor.execute("select title, status where status != 'done' order by priority limit 10");
```

## Output formatting

```typescript
import { Formatter, OutputFormat } from '@den-tanui/mdquery';

const result = await executor.execute("select title, status");

// Table format (box-drawing grid)
console.log(Formatter.format(result, 'table'));
// ┌────────────────────────┬────────────┐
// │ title                  │ status     │
// ├────────────────────────┼────────────┤
// │ Implement login flow   │ in-progress│
// │ Write API reference    │ todo       │
// └────────────────────────┴────────────┘

// JSON format
console.log(Formatter.format(result, 'json'));
// [{"title":"Implement login flow","status":"in-progress"},...]

// CSV format
console.log(Formatter.format(result, 'csv'));
// title,status
// Implement login flow,in-progress
// Write API reference,todo

// Table customization
console.log(Formatter.format(result, 'table', {
  compact: true,
  titleFormat: 'upper',     // headers in UPPERCASE
  trim: true,               // trim whitespace from cells
  columnWidths: [{ kind: 'chars', value: 30 }],  // fixed width column
}));
```

## Error handling

Queries never crash on bad files — errors are recorded in metadata:

```typescript
const result = await executor.execute("select title, status");

// Check for skipped files
if (result.meta?.errors && result.meta.errors.length > 0) {
  console.warn('Some files were skipped:');
  for (const err of result.meta.errors) {
    console.warn(`  ${err.path}: ${err.error} (${err.phase})`);
  }
}

// Use onError callback to handle errors as they happen
const executor2 = new Executor('./tasks', undefined, undefined, {
  onError: (error) => {
    console.warn(`Skipping ${error.path}: ${error.error}`);
  }
});
```

You can also pass an error handler via `ReadOptions.onError`:

```typescript
const executor = new Executor('./tasks', undefined, undefined, {
  onError: ({ path, error, phase }) => {
    console.warn(`[${phase}] ${path}: ${error}`);
  }
});
```

## Next steps

- **[Library recipes](./library-recipes.md)** — How-to guides for common tasks (multi-dir queries, hooks, fast path, mutations)
- **[API reference](../reference/api.md)** — Complete API documentation for every export
- **[Architecture](./architecture.md)** — How the query pipeline works internally
- **[Query syntax](../../syntax.md)** — Full language reference for query strings
- **[Examples](../../examples.md)** — More query examples
