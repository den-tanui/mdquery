# Library recipes

How-to recipes for using `@den-tanui/mdquery` as a library. Each recipe is self-contained — copy, adapt, run.

## Install

```bash
bun install @den-tanui/mdquery
```

```typescript
import { Executor, Formatter, FileOps, FastFileOps } from '@den-tanui/mdquery';
```

> Works with Node.js too. The `import` paths are the same.

---

## Query files in a directory

**Problem:** You want to run an mdquery SELECT and get the results as a JavaScript object.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor('./tasks');
const result = await executor.execute("select title, status where status = 'todo'");

console.log(result.data);
// [
//   { title: "Write docs", status: "todo" },
//   { title: "Optimize queries", status: "todo" }
// ]
```

**How it works:** Pass a directory path to the `Executor` constructor. The `execute()` method parses the query, reads all matching `.md` files in the directory, and returns a `QueryResult`. The `data` field contains the result rows.

---

## Query multiple directories

**Problem:** You want to search several directories at once and know which directory each result came from.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor(['./tasks', './sprints']);
const result = await executor.execute("select title, status, source_dir");

console.log(result.data);
// [
//   { title: "Fix bug", status: "done", source_dir: "./tasks" },
//   { title: "Sprint 3", status: "active", source_dir: "./sprints" }
// ]
```

**How it works:** Pass an array of directory paths. Each row gets a `source_dir` field indicating which search directory it came from. The directories are combined into a single flat result set.

---

## Read specific files

**Problem:** You have a list of file paths and want to query only those files.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor('.', {}, undefined, {
  files: [
    './tasks/task-001.md',
    './tasks/task-003.md',
    './notes/setup.md'
  ]
});

const result = await executor.execute("select title, status");
```

**How it works:** The fourth argument to `Executor` is a `ReadOptions` object. When `files` is set, mdquery skips directory walking entirely and reads only those paths. This is useful when you've already gathered paths from another tool.

---

## Use the fast path

**Problem:** You're querying a large directory (3000+ files) and the default path is too slow.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor('./large-dir', {}, undefined, { fast: true });
const result = await executor.execute("select title where status = 'todo'");

console.log(result.meta?.timings);
// { list: 2, read: 15, prefilter: 1, evaluate: 8, total: 26 }
```

**How it works:** When `fast: true`, mdquery uses `fdir` for file listing and `grepts` for content prefiltering instead of the standard recursive walk. This can be 5-10x faster on large directories. The `meta.timings` breakdown shows where time is spent.

---

## Update frontmatter programmatically

**Problem:** You want to change frontmatter fields in files from your TypeScript code.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor('./tasks');
const result = await executor.execute("update where id = 2 set status = 'done', updatedAt = now()");

console.log(result.updated); // 1
```

**How it works:** The `update` statement matches files via `where` and applies changes via `set`. Without a `where` clause, it updates **all** files. To skip the interactive confirmation prompt (which only applies to the CLI), the library always executes write operations directly — the confirmation is a CLI concern only.

---

## Create new markdown files

**Problem:** You want to create new markdown files with frontmatter from code.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor('./tasks');
const result = await executor.execute(
  "create set path = 'tasks/task-004.md', title = 'Refactor parser', status = 'todo', priority = 1"
);

console.log(result.created); // 1
```

**How it works:** The `create` statement writes a new file at the path specified in the `set` clause. If the parent directory doesn't exist, it's created automatically. The `path` field determines the file location; all other `set` fields become YAML frontmatter.

---

## Extract sections from markdown

**Problem:** You want to pull specific sections out of the markdown body.

**Solution:**

```typescript
import { Executor, Formatter } from '@den-tanui/mdquery';

const executor = new Executor('./docs');

// Check if a section exists
const hasTodo = await executor.execute(
  "select filename where has section('TODO')"
);

// Get section content
const todos = await executor.execute(
  "select filename, section('TODO').content where has section('TODO')"
);

// List all sections as structured objects
const allSections = await executor.execute(
  "select filename, sections()"
);

// sections() returns JSON: [{title: "Setup", level: 1, content: "..."}, ...]
console.log(Formatter.toJSON(allSections));
```

**How it works:** `section("name")` returns the first matching section as a map with `title`, `level`, `position`, `hierarchy`, and `content`. `sections()` returns all sections as an array. `has section("name")` is a boolean check for filtering. For table/CSV output, use scalar accessors like `.title` or `.content`.

---

## Get table of contents

**Problem:** You want the table of contents from a markdown file's headings.

**Solution:**

```typescript
import { Executor, Formatter } from '@den-tanui/mdquery';

const executor = new Executor('./docs');
const result = await executor.execute("select filename, toc()");

// toc() returns [{level: 1, title: "Intro"}, {level: 2, title: "Setup"}, ...]
const formatted = Formatter.format(result, 'json');
console.log(formatted);
```

**How it works:** `toc()` returns an array of `{level, title}` objects representing the heading structure of each file's markdown body. It's JSON-only since it returns structured data. Use `.map('title')` to extract just the heading names.

---

## Customize table output

**Problem:** You want to control how table results look — colors, column widths, title casing, and trimming.

**Solution:**

```typescript
import { Executor, Formatter } from '@den-tanui/mdquery';

const executor = new Executor('./tasks');
const result = await executor.execute("select id, title, status order by id");

const table = Formatter.format(result, 'table', {
  colorize: true,
  trim: true,
  titleFormat: 'capitalize',
  normalize: true,
  maxLinesPerRecord: 3,
  columnWidths: [
    { kind: 'chars', value: 6 },   // fixed 6 chars for id
    { kind: 'auto' },              // auto for title
    { kind: 'pct', value: 20 },    // 20% of remaining width
  ],
});

console.log(table);
```

**How it works:** `TableOptions` controls presentation. `trim` strips control characters from cell values (default `true`). `titleFormat` sets header casing (`'capitalize'`, `'upper'`, `'none'`, `'camel-case'`, `'pascal-case'`). `normalize` replaces non-alphanumeric runs with spaces before casing. Column widths support fixed chars, percentages, and auto allocation.

---

## Hook into execution

**Problem:** You want to transform data before/after execution, or add custom built-in functions.

**Solution:**

```typescript
import { Executor, ASTNode } from '@den-tanui/mdquery';

const executor = new Executor('./tasks', undefined, undefined, {}, {
  // Transform AST before execution
  onBeforeExecute: (ast: ASTNode) => {
    console.log('Query parsed:', ast.type);
    return ast; // return modified or original AST
  },

  // Handle custom built-in functions
  onBuiltinCall: (name: string, args: any[], context?: Record<string, any>) => {
    if (name === 'double') {
      return args[0] * 2;
    }
    return undefined; // let default builtins handle it
  },

  // Transform values after evaluation
  onEvaluateValue: (value: any, field: string) => {
    if (field === 'title' && typeof value === 'string') {
      return value.trim().toUpperCase();
    }
    return value;
  },
});

// Now queries can use your custom 'double()' function
const result = await executor.execute("select title, double(priority) as doubled");
```

**How it works:** The fifth argument to `Executor` is an `ExecutorHooks` object. `onBeforeExecute` receives the parsed AST and can modify it. `onBuiltinCall` lets you define custom functions callable in queries. `onEvaluateValue` transforms every evaluated field value. Return `undefined` from hooks to fall through to defaults.

---

## Extend with custom builtins

**Problem:** You want domain-specific functions in your queries — like `priority_label()`, `sprint()`, or `progress()` — that aren't part of mdquery's standard library.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor('./tasks', undefined, undefined, undefined, {
  onBuiltinCall: (name: string, args: any[], context?: Record<string, any>) => {
    switch (name) {
      // priority_label() → emoji-prefixed label
      case 'priority_label': {
        const p = args[0] ?? context?.priority;
        if (p === 'high') return '🔴 High';
        if (p === 'medium') return '🟡 Medium';
        if (p === 'low') return '🟢 Low';
        return '⚪ Unknown';
      }

      // days_open() → days since file was created
      case 'days_open': {
        if (context?.createdAt) {
          const created = new Date(context.createdAt);
          return Math.floor((Date.now() - created.getTime()) / 86400000);
        }
        return 0;
      }

      // sprint() → current sprint number
      case 'sprint': {
        const epoch = new Date('2026-01-01').getTime();
        return Math.ceil((Date.now() - epoch) / (14 * 86400000));
      }

      default:
        return undefined; // unknown — let mdquery handle or throw
    }
  }
});

// Use custom builtins in queries:
const r1 = await executor.execute("select title, priority_label(priority) as label");
const r2 = await executor.execute("select title where days_open() > 30");
const r3 = await executor.execute("select title, sprint() as current_sprint");
```

**How it works:** When mdquery encounters an unknown function name, it calls `onBuiltinCall` before throwing. Your hook receives the function name, evaluated arguments, and the current file's frontmatter as `context`. Return a value to use it as the result, or return `undefined` to fall through. Resolution order: Executor handlers → your hook → Builtins class → your hook (fallback) → throw. This means you can also override standard builtins by returning a value for names like `'upper'` or `'len'`.

---

## Handle errors gracefully

**Problem:** Some files have malformed frontmatter or are unreadable, and you don't want the whole query to fail.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor('./docs');

const result = await executor.execute("select title, status");

// Check for errors
if (result.meta?.errors && result.meta.errors.length > 0) {
  for (const err of result.meta.errors) {
    console.warn(`Error reading ${err.path} (${err.phase}): ${err.error}`);
  }
}

console.log(`Matched ${result.meta?.filesMatched} of ${result.meta?.filesSearched} files`);
console.log(result.data);
```

**How it works:** Execution errors (unreadable files, malformed YAML) are collected in `meta.errors` rather than thrown. Each error includes the file `path`, the `error` message, and which `phase` it occurred in (`'read'`, `'prefilter'`, or `'evaluate'`). The query still returns results from the files that succeeded.

---

## Write results to a file

**Problem:** You want to save query results as JSON, CSV, or a formatted table file.

**Solution:**

```typescript
import { Executor, Formatter } from '@den-tanui/mdquery';
import { writeFileSync } from 'fs';

const executor = new Executor('./tasks');
const result = await executor.execute("select id, title, status");

// JSON — full result object with meta
writeFileSync('results.json', Formatter.format(result, 'json'));

// CSV — RFC 4180 compliant
writeFileSync('results.csv', Formatter.format(result, 'csv'));

// Table — readable formatted output
writeFileSync('results.txt', Formatter.format(result, 'table', { colorize: false }));
```

**How it works:** `Formatter.format()` takes a `QueryResult` and an output format. JSON output is the full `QueryResult` object (`{type, data, count, meta}`) — valid JSON with ISO date strings. CSV uses proper quoting via `csv-stringify`. Table is presentation-only and auto-truncates long content. Disable `colorize` when writing to a file.

---

## Delete files matching a query

**Problem:** You want to remove markdown files that match a condition.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

const executor = new Executor('./tasks');
const result = await executor.execute("delete where status = 'archived'");

console.log(result.deleted); // number of files removed
```

**How it works:** The `delete` statement removes files matching the `where` clause. Without a `where`, it deletes all files in the search directory. Unlike the CLI, the library doesn't prompt for confirmation — validate your query before executing destructive operations.

---

## Pass context to queries

**Problem:** You want to inject runtime values into a query without string interpolation.

**Solution:**

```typescript
import { Executor } from '@den-tanui/mdquery';

// Context values are accessible in queries
const executor = new Executor('./tasks', { targetStatus: 'todo', maxPriority: 2 });
const result = await executor.execute(
  "select title where status = targetStatus and priority <= maxPriority"
);

console.log(result.data);
```

**How it works:** The second argument to `Executor` is a `context` object. Its keys become query variables accessible as identifiers in `where` clauses and other expressions. This avoids SQL-injection-style issues from string concatenation and makes queries reusable.

---

# projext recipes

Recipes for using mdquery as the backbone of **projext**, a project management TUI that stores tasks and docs as markdown files in `.projext/`.

## projext data model

```
.projext/
├── fix-login-bug.md        ← id = "fix-login-bug" (from filename)
├── write-docs.md           ← id = "write-docs"
├── setup-ci.md
├── sprints/
│   └── sprint-042.md
└── docs/
    └── architecture.md
```

Task frontmatter:

```yaml
---
title: Fix login bug
status: todo              # todo | doing | done
priority: 3               # 1-5 (higher = more important)
tags: [backend, auth]
assignee: Alice
createdAt: 2026-08-18T10:00:00Z   # IMMUTABLE
updatedAt: 2026-08-18T10:00:00Z   # IMMUTABLE
---
```

**Key rules:**
- `id` = filename without `.md` — never stored in frontmatter
- `createdAt` / `updatedAt` are immutable (never overwritten by UPDATE/CREATE)
- projext controls file discovery, not mdquery

---

## Pass your project store to Executor

**Problem:** You've pre-scanned `.projext/` into memory and want to query those files without re-reading from disk.

**Solution:**

```typescript
import { Executor, FileOps } from '@den-tanui/mdquery';

// Scan .projext/ once at startup
const allFiles = await FileOps.readFiles('.projext', { depth: 0, hidden: true });

// Pass pre-loaded files via ReadOptions.files (paths relative to the dir)
const executor = new Executor('.projext', undefined, undefined, {
  files: allFiles.map(f => f.path),
});

// Or use the fast path for large projects
const executor = new Executor('.projext', undefined, undefined, {
  fast: true,
  hidden: true,
  depth: 0,
});
```

**How it works:** projext controls file discovery. Scan `.projext/` once at startup, then pass file paths via `ReadOptions.files`. The executor skips directory walking and reads only the listed files. For large projects (100+ files), use `fast: true` to leverage `fdir` + `grepts`.

---

## Build a ProjextStore class

**Problem:** You want a clean abstraction that wraps Executor with projext-specific builtins like `tasks()`, `docs()`, `project()`, `createTask()`, `done()`.

**Solution:**

```typescript
import { Executor, FileOps, QueryResult } from '@den-tanui/mdquery';
import { basename, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

interface TaskFile {
  id: string;
  path: string;
  title: string;
  status: string;
  priority: number;
  tags: string[];
  assignee?: string;
  createdAt: string;
  updatedAt: string;
}

class ProjextStore {
  private projectDir: string;
  private files: string[] = [];

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async initialize() {
    this.files = await FileOps.readFiles(this.projectDir, {
      depth: 0,
      hidden: true,
    }).then(files => files.map(f => f.path));
  }

  async query(sql: string): Promise<QueryResult> {
    const executor = new Executor(
      this.projectDir,
      undefined,              // context
      undefined,              // triggerContext
      { files: this.files },  // pre-scanned files
      { onBuiltinCall: (name, args, ctx) => this.handleBuiltin(name, args, ctx) }
    );
    return executor.execute(sql);
  }

  private handleBuiltin(name: string, args: any[], ctx?: Record<string, any>): any {
    switch (name) {
      case 'project': return this.builtinProject();
      case 'tasks':   return this.builtinTasks(args);
      case 'docs':    return this.builtinDocs(args);
      case 'done':    return this.builtinDone(args, ctx);
      default:        return undefined;
    }
  }

  // project() → { name, dir, taskCount, docCount }
  private builtinProject() {
    const taskCount = this.files.filter(f => !f.includes('/docs/')).length;
    const docCount = this.files.filter(f => f.includes('/docs/')).length;
    return {
      name: basename(this.projectDir),
      dir: this.projectDir,
      taskCount,
      docCount,
    };
  }

  // tasks([status]) → filtered task files
  private builtinTasks(args: any[]) {
    // Returns all files — the query's WHERE clause does the filtering
    // Usage: select title where tasks() and status = 'todo'
    return this.files;
  }

  // docs() → doc files only
  private builtinDocs(args: any[]) {
    return this.files.filter(f => f.includes('/docs/'));
  }

  // done() → mark current task as done
  private builtinDone(args: any[], ctx?: Record<string, any>) {
    if (!ctx?.path) return null;
    const now = new Date().toISOString();
    // The update is handled by the executor's mutation pipeline
    return { status: 'done', updatedAt: now };
  }
}
```

**How it works:** `ProjextStore` wraps `Executor` and injects custom builtins via `onBuiltinCall`. The `project()` builtin returns project metadata, `tasks()` and `docs()` filter by directory convention, and `done()` returns the mutation payload for the executor's UPDATE pipeline. Each builtin receives the evaluated args and current file context.

---

## Query tasks by status

**Problem:** You want to list all tasks in a given status.

**Solution:**

```typescript
const store = new ProjextStore('.projext');
await store.initialize();

const result = await store.query("select title, priority, assignee where status = 'todo' order by priority desc");
console.log(result.data);
// [
//   { title: "Fix login bug", priority: 5, assignee: "Alice" },
//   { title: "Write docs", priority: 3, assignee: "Bob" },
// ]
```

**How it works:** Standard mdquery SELECT against the `.projext/` directory. The `status` field is a string enum (`todo`, `doing`, `done`). `ORDER BY priority DESC` puts high-priority tasks first.

---

## Create a task

**Problem:** You want to create a new task file with proper frontmatter.

**Solution:**

```typescript
import { FileOps } from '@den-tanui/mdquery';

async function createTask(
  dir: string,
  id: string,
  title: string,
  opts: { status?: string; priority?: number; tags?: string[]; assignee?: string } = {}
) {
  const now = new Date().toISOString();
  const content = `## TODO\n\nDescribe what needs to be done.\n`;

  const path = await FileOps.writeFile(join(dir, `${id}.md`), {
    title,
    status: opts.status || 'todo',
    priority: opts.priority || 3,
    tags: opts.tags || [],
    assignee: opts.assignee || '',
    createdAt: now,
    updatedAt: now,
  }, content);

  return path;
}

// Usage
const path = await createTask('.projext', 'setup-ci', 'Set up CI pipeline', {
  priority: 4,
  tags: ['devops'],
  assignee: 'Alice',
});
```

**How it works:** `FileOps.writeFile()` writes a markdown file with YAML frontmatter. The filename becomes the task `id`. `createdAt` and `updatedAt` are set to now — they're immutable after this.

---

## Mark a task as done

**Problem:** You want to update a task's status to `done` and record the completion time.

**Solution:**

```typescript
const store = new ProjextStore('.projext');
await store.initialize();

// Using mdquery UPDATE
const result = await store.query(
  "update set status = 'done', updatedAt = now() where filename = 'fix-login-bug'"
);
console.log(result.updated, 'files updated');

// Or using FileOps directly
const files = await FileOps.readFiles('.projext', { depth: 0 });
const task = files.find(f => f.filename === 'fix-login-bug');
if (task) {
  const now = new Date().toISOString();
  await FileOps.writeFile('.projext', {
    ...task.frontmatter,
    status: 'done',
    updatedAt: now,       // Note: updatedAt is IMMUTABLE — this won't work!
  }, task.body || '');
}
```

**How it works:** There's a catch: `updatedAt` is in `FileOps.IMMUTABLE_FIELDS` — `writeFile` won't overwrite it. Use mdquery's `UPDATE` instead, which bypasses the immutable field check for explicit SET assignments. Or update the timestamp yourself by writing the full file content with the new timestamp in frontmatter.

---

## Query across subdirectories

**Problem:** Your project has tasks in `.projext/` and sprints in `.projext/sprints/`. You want to JOIN them.

**Solution:**

```typescript
const executor = new Executor(['.projext', '.projext/sprints'], undefined, undefined, {
  fast: true,
  hidden: true,
});

const result = await executor.execute(`
  select title, status, source_dir
  where status != 'done'
  order by priority desc
  limit 10
`);
```

**How it works:** Pass an array of directories to `Executor`. Each result row gets a `source_dir` field indicating which directory it came from. Use `source_dir` in WHERE or SELECT to distinguish tasks from sprints.

---

## Build a board view

**Problem:** You want to render tasks as a Kanban board (columns: todo, doing, done).

**Solution:**

```typescript
const store = new ProjextStore('.projext');
await store.initialize();

const result = await store.query("select title, status, priority, assignee");

const board: Record<string, any[]> = { todo: [], doing: [], done: [] };

for (const row of result.data || []) {
  const col = row.status || 'todo';
  board[col] = board[col] || [];
  board[col].push({
    id: row.filename,
    title: row.title,
    priority: '•'.repeat(row.priority || 0),
    assignee: row.assignee || '—',
  });
}

// Render
for (const [status, cards] of Object.entries(board)) {
  console.log(`\n=== ${status.toUpperCase()} (${cards.length}) ===`);
  for (const card of cards) {
    console.log(`  ${card.id.padEnd(20)} ${card.title.padEnd(25)} ${card.priority}  ${card.assignee}`);
  }
}
```

**How it works:** Query all tasks, then group by `status` field in JavaScript. The `'•'.repeat(priority)` pattern renders priority as dots (matching the projext card view spec). This is pure presentation logic — mdquery handles the data, projext handles the rendering.

---

## Use context variables for dynamic queries

**Problem:** You want to reuse the same query with different parameters (e.g., current sprint, current user).

**Solution:**

```typescript
const store = new ProjextStore('.projext');
await store.initialize();

// Pass context variables
const executor = new Executor(
  '.projext',
  { currentUser: 'Alice', currentSprint: 42 },
  undefined,
  { files: store.files },
  { onBuiltinCall: (name, args, ctx) => store.handleBuiltin(name, args, ctx) }
);

const result = await executor.execute(
  "select title, status where assignee = currentUser and status != 'done'"
);
```

**How it works:** The second argument to `Executor` is a context object. Its keys become query variables. This lets you write parameterized queries without string interpolation — safe, reusable, and testable.
