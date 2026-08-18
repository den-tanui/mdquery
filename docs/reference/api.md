# API Reference

Complete API documentation for `@den-tanui/mdquery` library exports.

```typescript
import {
  Lexer, Parser, QueryAnalyzer,
  Executor, FileOps, FastFileOps,
  Builtins, Formatter, OutputFormat
} from '@den-tanui/mdquery';
```

---

## Executor

The main entry point for running queries against markdown files.

```typescript
class Executor {
  constructor(
    dir: string | string[],
    context?: Record<string, any>,
    triggerContext?: TriggerContext,
    readOptions?: ReadOptions,
    hooks?: ExecutorHooks
  );

  async execute(query: string): Promise<QueryResult>;
  get lastAst(): ASTNode | null;
}
```

### Constructor

| Parameter | Type | Description |
|-----------|------|-------------|
| `dir` | `string \| string[]` | Directory path(s) to query. Missing directories are recorded in `meta.errors`. |
| `context` | `Record<string, any>` | Variable context passed to evaluation. Accessible as field names in queries. |
| `triggerContext` | `TriggerContext` | `{ old?: FileData, new?: FileData }` for before/after trigger evaluation. |
| `readOptions` | `ReadOptions` | File discovery options — depth, hidden, ignore, files, fast, onError, metadata. |
| `hooks` | `ExecutorHooks` | Extension hooks for before/after execution, custom builtins, etc. |

```typescript
// Basic usage
const executor = new Executor('./tasks');

// With context variables
const executor = new Executor('./tasks', { myVar: 'hello' });

// With read options
const executor = new Executor('./tasks', undefined, undefined, {
  depth: 1,        // top-level only
  hidden: true,    // include hidden files
  fast: true,      // use fdir + grepts fast path
  metadata: true,  // load stat data for file()
});

// Multi-directory
const executor = new Executor(['./tasks', './inbox']);
```

### execute(query)

Runs the query against all files in the directory. Returns a `QueryResult`.

```typescript
const result = await executor.execute("select title, status where status = 'todo'");
```

### lastAst

Read-only access to the last parsed AST (useful for debugging or tooling):

```typescript
await executor.execute("select title");
console.log(executor.lastAst);
```

---

## ReadOptions

Controls how Executor discovers and reads files.

```typescript
interface ReadOptions {
  depth?: number;       // recursion depth: 0 = recursive (default), 1 = top-level, 2+ = limited
  hidden?: boolean;     // include hidden files (default: false)
  ignore?: boolean;     // respect .gitignore (default: true)
  files?: string[];     // explicit file list (overrides directory walking)
  fast?: boolean;       // use FastFileOps (fdir + grepts) instead of legacy FileOps
  onError?: (error: FileError) => void;  // called when a file fails to read
  metadata?: boolean;   // load FileMetadata (mtime, size, etc.) for file() function
}
```

---

## QueryResult

Returned by `Executor.execute()`.

```typescript
interface QueryResult {
  type: 'select' | 'update' | 'create' | 'delete';
  data?: Record<string, any>[];   // result rows (SELECT)
  count?: number;                  // row count
  updated?: number;                // rows updated (UPDATE)
  created?: number;                // files created (CREATE)
  deleted?: number;                // files deleted (DELETE)
  meta?: QueryMeta;                // execution metadata
}
```

### QueryMeta

```typescript
interface QueryMeta {
  filesSearched: number;       // total files found on disk
  filesMatched: number;        // files that produced a result row
  timings: QueryTimings;       // per-phase timing breakdown
  errors: FileError[];         // files that failed to read or evaluate
}

interface QueryTimings {
  list: number;      // time to discover files (ms)
  read: number;      // time to read/parse files (ms)
  prefilter: number; // time for grepts prefilter (fast path only)
  evaluate: number;  // time to evaluate query against file data (ms)
  total: number;     // total wall-clock time (ms)
}

interface FileError {
  path: string;           // file path relative to search dir
  error: string;          // error message
  phase: 'read' | 'prefilter' | 'evaluate';  // which phase failed
}
```

---

## TriggerContext

```typescript
interface TriggerContext {
  old?: FileData;  // file state before mutation
  new?: FileData;  // file state after mutation
}
```

---

## ExecutorHooks

Extension points for the execution pipeline.

```typescript
interface ExecutorHooks {
  onBeforeExecute?: (ast: ASTNode) => ASTNode;
  onEvaluateValue?: (value: any, field: string) => any;
  onBeforeWrite?: (file: any, operation: 'create' | 'update' | 'delete') => void;
  onAfterRead?: (file: any) => any;
  onBuiltinCall?: (name: string, args: any[], context?: Record<string, any>) => any;
}
```

| Hook | When | Use case |
|------|------|----------|
| `onBeforeExecute` | Before query execution, after parsing | Transform or validate the AST |
| `onEvaluateValue` | After each value evaluation | Transform or filter individual values |
| `onBeforeWrite` | Before writing a file (update/create/delete) | Validate or intercept mutations |
| `onAfterRead` | After reading each file | Enrich or filter file data |
| `onBuiltinCall` | When a built-in function is called | Add custom functions or override existing ones |

### Extending builtins with onBuiltinCall

`onBuiltinCall` is the primary extension point for adding custom functions to the query language. When mdquery encounters an unknown function name, it calls your hook. If you return a value, that value is used as the function result. If you return `undefined`, mdquery throws an `Unknown builtin` error.

The hook receives:
- `name` — the function name as written in the query (e.g., `'project'`, `'sprint'`, `'priority_label'`)
- `args` — the evaluated arguments (already evaluated by the executor)
- `context` — the current file's frontmatter as a `Record<string, any>`

**Resolution order:**
1. Executor's built-in handlers (`has`, `has_section`)
2. Your `onBuiltinCall` hook (first chance)
3. Static methods on `Builtins` class (`now`, `upper`, `len`, etc.)
4. Your `onBuiltinCall` hook (fallback — checked again inside `Builtins.call()`)
5. Throws `Unknown builtin`

This means your hook can:
- **Add new functions** — return a computed value for any name you want
- **Override existing builtins** — return a value for a name like `'upper'` to replace the default behavior (the hook runs before `Builtins.call()`)

```typescript
const executor = new Executor('./tasks', undefined, undefined, undefined, {
  onBuiltinCall: (name, args, context) => {
    switch (name) {
      // Custom function: priority_label() → human-readable label
      case 'priority_label': {
        const p = args[0] ?? context?.priority;
        if (p === 'high') return '🔴 High';
        if (p === 'medium') return '🟡 Medium';
        if (p === 'low') return '🟢 Low';
        return '⚪ Unknown';
      }

      // Custom function: sprint() → current sprint name
      case 'sprint': {
        return `Sprint ${Math.ceil((Date.now() - new Date('2026-01-01').getTime()) / (14 * 86400000))}`;
      }

      // Override built-in: custom len() that counts words
      case 'len': {
        if (typeof args[0] === 'string') return args[0].split(/\s+/).length;
        return undefined; // fall through to default len()
      }

      default:
        return undefined; // unknown — let it throw
    }
  }
});

// Now you can use these in queries:
await executor.execute("select title, priority_label(priority) as label");
await executor.execute("select title where sprint() = current_sprint");
```

```sql
-- In a query string:
select title, priority_label() as label
select title, sprint() as current_sprint
```

---

## Formatter

Formats `QueryResult` into different output formats.

```typescript
class Formatter {
  static format(result: QueryResult, format: OutputFormat, options?: TableOptions): string;
  static toJSON(result: QueryResult): string;
  static toTable(result: QueryResult, terminalWidth?: number, options?: TableOptions): string;
  static toCSV(result: QueryResult): string;
}
```

### format(result, format, options?)

Main entry point. Delegates to `toJSON`, `toTable`, or `toCSV`.

```typescript
const output = Formatter.format(result, 'json');
const output = Formatter.format(result, 'table', { compact: true });
const output = Formatter.format(result, 'csv');
```

### OutputFormat

```typescript
type OutputFormat = 'json' | 'table' | 'csv';
```

### TableOptions

```typescript
interface TableOptions {
  colorize?: boolean;              // force color on/off (default: auto-detect TTY)
  colors?: Map<string, string>;    // SGR code map
  compact?: boolean;               // compact table view
  maxLinesPerRecord?: number;      // cap each record at N terminal lines (--rows)
  columnWidths?: ColumnWidthSpec[];// column width specifications
  trim?: boolean | boolean[];      // trimAll on cell values; array = per-column
  titleFormat?: TitleFormat;       // header case formatting
  normalize?: boolean;             // replace non-alphanumeric runs with spaces before formatting
}

type ColumnWidthSpec =
  | { kind: 'chars'; value: number }   // fixed width in characters
  | { kind: 'pct'; value: number }     // percentage of usable width
  | { kind: 'auto' };                  // auto-distribute remaining space

type TitleFormat = 'none' | 'upper' | 'capitalize' | 'camel-case' | 'pascal-case';
```

---

## FileOps

Legacy file operations — reads all files upfront. Works everywhere, but slower for large directories.

```typescript
class FileOps {
  static readonly IMMUTABLE_FIELDS: string[];  // ['createdAt', 'updatedAt']

  static async readFiles(dir: string, options?: ReadOptions): Promise<FileData[]>;
  static readFilesSync(dir: string, options?: ReadOptions): FileData[];
  static async readFile(dir: string, filepath: string): Promise<FileData | null>;
  static async writeFile(
    target: string,
    data: Record<string, any>,
    content: string
  ): Promise<string>;
}
```

### readFiles

Reads all `.md` files in a directory recursively:

```typescript
const files = await FileOps.readFiles('./tasks', {
  depth: 2,
  hidden: false,
  ignore: true,
});
console.log(files.length, 'files found');
```

### writeFile

Writes or updates a markdown file with frontmatter:

```typescript
const newPath = await FileOps.writeFile('./tasks', {
  id: 'task-1',
  title: 'New task',
  status: 'todo',
  tags: ['backend', 'api'],
}, '## Description\n\nBuild the API endpoint.');
```

Returns the relative path of the written file.

---

## FastFileOps

High-performance file operations using `fdir` (directory listing) and `grepts` (content search). Significantly faster for large directories.

```typescript
class FastFileOps {
  static async listFiles(dir: string, options?: ReadOptions): Promise<string[]>;
  static async readFiles(
    dir: string,
    paths: string[],
    analysis: FileIOAnalysis,
    onError?: FileErrorHandler
  ): Promise<FileData[]>;
  static async preFilterByContent(
    dir: string,
    paths: string[],
    pattern: string,
    invert?: boolean
  ): Promise<string[]>;
}
```

### listFiles

Fast directory listing — returns file paths only (no content):

```typescript
const paths = await FastFileOps.listFiles('./tasks', {
  depth: 0,
  hidden: true,
  ignore: true,
});
console.log(paths.length, 'files listed');
```

### readFiles

Reads a subset of files, skipping content if the analysis says it's not needed:

```typescript
const files = await FastFileOps.readFiles('./tasks', paths, {
  requiresContent: false,
  requiresMetadata: false,
  bodyPredicates: [],
});
```

### preFilterByContent

Filters file paths by content pattern (like grep):

```typescript
const matching = await FastFileOps.preFilterByContent(
  './tasks',
  paths,
  'TODO'  // pattern to match
);
```

### FileIOAnalysis

```typescript
interface FileIOAnalysis {
  requiresContent: boolean;   // does the query need the markdown body?
  requiresMetadata: boolean;  // does the query need stat data?
  bodyPredicates: { field: string; op: string; value: string }[];  // content-level filters
}
```

---

## Builtins

All methods are static. Call them in queries with their name: `now()`, `upper(title)`, etc.

### Date & Time

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `now` | `now(): string` | ISO timestamp | Current date and time |
| `today` | `today(): string` | `YYYY-MM-DD` | Current date only |
| `date` | `date(s: string): string` | ISO timestamp | Parse a date string |
| `nextDate` | `nextDate(recurrence: string): string` | ISO date | Next occurrence of a recurrence (`daily`, `weekly`, `monthly`, `yearly`, `N`) |
| `dateAdd` | `dateAdd(date: any, days: number): Date` | Date | Add days to a date |
| `dateSub` | `dateSub(date: any, days: number): Date` | Date | Subtract days from a date |
| `isBefore` | `isBefore(date1: any, date2: any): boolean` | boolean | True if date1 < date2 |
| `isAfter` | `isAfter(date1: any, date2: any): boolean` | boolean | True if date1 > date2 |
| `daysUntil` | `daysUntil(date1: any, date2: any): number` | number | Days between two dates |
| `daysSince` | `daysSince(date: any): number` | number | Days since a date |

```sql
-- In a query:
select title, nextDate(recurring_date) as next_due
select title where isAfter(due_date, today())
select title, daysSince(created_at) as age
```

### String

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `len` | `len(value: string \| any[]): number` | number | String or array length |
| `upper` | `upper(s: string): string` | string | Uppercase |
| `lower` | `lower(s: string): string` | string | Lowercase |
| `trim` | `trim(s: string): string` | string | Trim leading/trailing whitespace |
| `trimAll` | `trimAll(s: string): string` | string | Replace newlines, tabs, pipes with spaces |
| `contains` | `contains(a: string, b: string): boolean` | boolean | True if `a` contains `b` |
| `startsWith` | `startsWith(a: string, b: string): boolean` | boolean | True if `a` starts with `b` |
| `endsWith` | `endsWith(a: string, b: string): boolean` | boolean | True if `a` ends with `b` |
| `split` | `split(s: string, delim: string): string[]` | string[] | Split string by delimiter |
| `join` | `join(arr: string[], delim: string): string` | string | Join array with delimiter |
| `replace` | `replace(s: string, search: string, replacement: string): string` | string | Replace all occurrences |

```sql
-- In a query:
select upper(title), lower(status)
select title where contains(body, 'TODO')
select title, len(tags) as tag_count
select split(tags, ',') as tag_list
```

### Case Formatting

| Method | Signature | Returns | Example |
|--------|-----------|---------|---------|
| `capitalize` | `capitalize(s: string): string` | string | `capitalize('some-text')` → `"Some-text"` |
| `camelCase` | `camelCase(s: string): string` | string | `camelCase('setup guide')` → `"setupGuide"` |
| `pascalCase` | `pascalCase(s: string): string` | string | `pascalCase('setup guide')` → `"SetupGuide"` |
| `sentence` | `sentence(s: string): string` | string | `sentence('setup guide')` → `"Setup guide"` |
| `snakeCase` | `snakeCase(s: string): string` | string | `snakeCase('Setup Guide')` → `"setup_guide"` |
| `kebabCase` | `kebabCase(s: string): string` | string | `kebabCase('Setup Guide')` → `"setup-guide"` |

### Type Conversion

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `typeof` | `typeof(value: any): string` | string | `'string'`, `'number'`, `'boolean'`, `'object'` |
| `str` | `str(value: any): string` | string | Convert to string |
| `int` | `int(value: any): number` | number | Convert to integer |
| `float` | `float(value: any): number` | number | Convert to float |
| `bool` | `bool(value: any): boolean` | boolean | Convert to boolean |
| `array` | `array(value: any): any[]` | any[] | Wrap in array if not already |

### Enum Cycling

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `nextEnum` | `nextEnum(val: string, enumValues: string[]): string` | string | Next value in cycle (wraps around) |
| `prevEnum` | `prevEnum(val: string, enumValues: string[]): string` | string | Previous value in cycle (wraps around) |

```sql
-- Cycle task status forward:
update set status = nextEnum(status, ['todo', 'in-progress', 'review', 'done'])
```

### Context & Content

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `id` | `id(context?): string` | string | Current row's id field |
| `user` | `user(context?): string` | string | Current username (`process.env.USER`) |
| `fields` | `fields(context?, includeValues?): string[] \| Record<string, any>` | varies | Frontmatter field map |
| `toc` | `toc(context?, levels?): string[]` | string[] | Table of contents entries from markdown body |
| `section` | `section(context?, name?): string \| Record<string, string> \| null` | varies | Section content by name |
| `clipboard` | `clipboard(value: string): string` | string | Pass-through (handled by executor pipe) |

---

## Lexer

Tokenizer that converts a query string into tokens.

```typescript
class Lexer {
  constructor(input: string);
  tokenize(): Token[];
}
```

```typescript
import { Lexer } from '@den-tanui/mdquery';

const lexer = new Lexer("select title where status = 'todo'");
const tokens = lexer.tokenize();
```

---

## Parser

Pratt parser that converts tokens into an AST.

```typescript
class Parser {
  constructor(input: string);
  parse(): ASTNode;
}
```

```typescript
import { Parser } from '@den-tanui/mdquery';

const parser = new Parser("select title, status where status = 'todo' order by priority");
const ast = parser.parse();
```

---

## QueryAnalyzer

Static analysis of an AST — determines what fields/content are needed without reading any files.

```typescript
class QueryAnalyzer {
  constructor(ast: ASTNode);
  analyze(): { fields: string[]; requiresContent: boolean; requiresMetadata: boolean };
}
```

```typescript
import { QueryAnalyzer, Parser } from '@den-tanui/mdquery';

const ast = new Parser("select title where body contains 'TODO'").parse();
const analysis = new QueryAnalyzer(ast).analyze();

console.log(analysis);
// { fields: ['title', 'body'], requiresContent: true, requiresMetadata: false }
```

### buildContentPrefilterTree

Builds a tree structure for content-level prefiltering (used by the fast path):

```typescript
import { buildContentPrefilterTree, Parser } from '@den-tanui/mdquery';

const ast = new Parser("select * where body contains 'TODO'").parse();
const tree = buildContentPrefilterTree(ast);
```

### inferScalarType

Infers the scalar type of an expression (used for static type enforcement):

```typescript
import { inferScalarType, Parser } from '@den-tanui/mdquery';

const ast = new Parser("select created_at").parse();
// ... access expression nodes
```

---

## AST Node Types

### Top-level statements

| Node type | Description |
|-----------|-------------|
| `ASTNode` | Union of all statement types |
| `SelectStatement` | `select ... from ... where ... order by ... limit ...` |
| `UpdateStatement` | `update set ... where ...` |
| `CreateStatement` | `create set ...` |
| `DeleteStatement` | `delete where ...` |

### Expression types

| Node type | Description |
|-----------|-------------|
| `BinaryOpNode` | `a = b`, `a != b`, `a > b`, `a contains b`, etc. |
| `UnaryOpNode` | `not a`, `-a` |
| `FunctionCallNode` | `upper(title)`, `now()` |
| `MethodCallNode` | `tags.contains('x')`, `title.upper()` |
| `ArrayIndexNode` | `tags[0]` |
| `MapIndexNode` | `section("Intro").title` |
| `FieldNode` | `title`, `status` (field reference) |
| `ValueNode` | `'hello'`, `42`, `true`, `null`, `/regex/`, `date('2026-01-01')` |
| `ParenNode` | `(a or b)` |
| `WildcardNode` | `*` (all fields) |
| `SubqueryNode` | `(select ...)` |

### Pipe & Union

| Node type | Description |
|-----------|-------------|
| `PipeNode` | `... \| top 5`, `... \| clipboard` |
| `UnionNode` | `select ... union select ...` |

### Triggers

| Node type | Description |
|-----------|-------------|
| `TriggerStatement` | `before update run ...`, `after create run ...` |
| `DenyAction` | `deny` |
| `RunAction` | `run ...` |

### Structure

| Node type | Description |
|-----------|-------------|
| `JoinNode` | `join ... on ...` |
| `FromClause` | `from table_name` |
| `OrderByNode` | `order by field asc/desc` |

---

## Types (types.ts)

All exported TypeScript types and interfaces:

```typescript
// Tokens
type TokenType = string;  // 'SELECT', 'WHERE', 'FIELD', 'VALUE', 'OPERATOR', etc.
interface Token { type: TokenType; value: string; }

// Query result
interface QueryResult { type; data?; count?; updated?; created?; deleted?; meta?; }
interface QueryMeta { filesSearched; filesMatched; timings; errors; }
interface QueryTimings { list; read; prefilter; evaluate; total; }
interface FileError { path; error; phase; }

// File data
interface FileData { id?; filename; path; abspath; filepath; frontmatter; content?; body?; sections?; metadata?; source_dir?; }
interface FileMetadata { mtime; atime; ctime; size; mode; owner; group; }

// Options
interface ReadOptions { depth?; hidden?; ignore?; files?; fast?; onError?; metadata?; }
interface ExecutorHooks { onBeforeExecute?; onEvaluateValue?; onBeforeWrite?; onAfterRead?; onBuiltinCall?; }
interface TriggerContext { old?: FileData; new?: FileData; }

// Schema / document
interface Document { name; description?; fields?: Record<string, FieldSpec>; }
interface FieldSpec { type; description?; required?; unique?; default?; enum?; }
interface Schema { name; description?; fields?: Record<string, FieldSpec>; }
```

<!-- Config (config.ts) is CLI-only — not exported from the library -->
