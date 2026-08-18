# Body Syntax Design — Structured Markdown Element Access

**Date:** 2026-08-17
**Status:** Draft
**Scope:** Read-only `body.*` syntax for querying all markdown element types + `fields()` extension
**Out of scope:** Body writes (UPDATE/CREATE via AST) — separate plan

---

## 1. Goal

Extend mdquery's query language to support structured access to all markdown element types. Currently mdquery exposes 5 content functions (`links()`, `images()`, `codeblocks()`, `sections()`, `toc()`). This design expands coverage to all 27 mdast node types with a unified, composable syntax.

Additionally:
- Extend `fields()` to accept a string argument for wildcard filtering
- Add `outline()` builtin for box-drawing formatted heading tree (returns scalar string)
- Remove `section()` (redundant with h1-h6 shorthands)
- Change `toc()` return type from `string[]` of `"level:title"` to structured `[{level, title}]`

The preferred syntax uses **top-level element functions** (`h1()`, `code()`, `link()`, etc.) with built-in shorthand filtering. The `body` namespace is also available for property-access chains.

---

## 1b. Fields Extension

**Current `fields()` behavior:**
- `fields()` → `string[]` — array of field names (excluding internal fields: `filename`, `path`, `abspath`, `filepath`, `content`, `sections`)
- `fields(_, true)` → `Record<string, any>` — map of `{field: value}`

**New `fields()` behavior:**
- `fields()` → `string[]` — unchanged
- `fields(_, true)` → `Record<string, any>` — unchanged
- `fields("query")` → `string[]` — field names matching wildcard pattern
- `fields("query", true)` → `Record<string, any>` — entries where key matches pattern

```sql
-- Current (still works)
select fields()                    -- all field names
select fields(_, true)             -- full map {field: value}

-- New: wildcard filtering (same rules as element functions)
select fields("status")            -- field name exactly "status"
select fields("tag*")              -- field name starts with "tag"
select fields("*tag")              -- field name ends with "tag"
select fields("*tag*")             -- field name contains "tag"

-- Regex via .filter(matches) when needed
select fields().filter(key matches "^task_\\d+$")
```

---

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Lazy caching (Approach 3) | Single AST walk, builds all indexes on first access, cached for reuse |
| Preferred syntax | Top-level functions: `h1()`, `code("js")`, `link()` | Cleaner than `body.h1()`, consistent with existing `links()` / `sections()` |
| `body` namespace | Available for property-access chains | `body.h1[0].title`, `body.code[0].lang` |
| `fields()` extension | Accept string argument for wildcard filtering | Same rules as element functions, regex via `.filter(matches)` |
| `toc()` return type | `[{level, title}, ...]` structured objects | Was `"level:title"` strings; structured enables `.filter()`, `.map()`, composition |
| `outline()` builtin | Box-drawing formatted string (scalar) | Works in all output formats (JSON, table, CSV); visual heading tree |
| `section()` | Removed | Redundant with `h1("Setup")`, `h2("Setup")` shorthands |
| Heading content | Until next heading of same level | h1 content includes nested h2/h3/etc until next h1 |
| Table access | Option C (nested + flat) | `table[0].rows[0].cells[0]` + `tableCell` flat access |
| List nesting | Nested with optional children | `children: []` always present, empty when no sub-list |
| Task list checked | Always present | `true`/`false` for task items, `null` for regular items |
| Position data | Included on all elements | Cheap (already parsed), valuable for LSP/navigation |
| Old function syntax | Keep as wrappers | Zero breakage, `links()` → delegates to `link()` internally |
| Indexing | 0-indexed | Consistent with existing `sections()[0]` syntax |
| Shorthand filters | Built into top-level functions | `code("js")`, `h1("*Setup*")` — wildcard matching |
| `.filter()` regex | New `matches` operator | `.filter(title matches "Setup\|Config")` — full regex power |
| User-defined functions | `def`/`fn` with JS syntax + `new Function()` | Roadmap; function directory at `~/.config/mdquery/functions/*.js` for persistence |

---

## 3. Syntax Overview

### 3.1 Top-Level Element Functions (preferred)

All element types are available as top-level functions. No `body.` prefix needed. **Paren-free convention:** functions with 0 required args are called without parentheses.

```sql
-- Headings
select h1                            -- all h1 headings
select h1[0]                         -- first h1 (0-indexed)
select h1[0].title                   -- first h1 title text
select h1[0].content                 -- first h1 content until next h1
select h1("Setup")                   -- h1s with title exactly "Setup"
select h1("Setup*")                  -- h1s with title starting with "Setup"
select h1("*Setup*")                 -- h1s with title containing "Setup"
select h2, h3                        -- all h2 and h3 headings

-- Code blocks
select code                          -- all code blocks
select code("js")                    -- JS code blocks only
select code[0].lang                  -- first code block language
select code.map('content')           -- all code contents

-- Links
select link                          -- all links
select link[0].url                   -- first link URL
select link.map('text')              -- all link texts

-- Tables
select table                         -- all tables
select table[0].headers              -- first table headers
select table[0].rows[0].cells[0]    -- first table, first row, first cell
select tableCell.map('content')      -- all cells across all tables

-- Lists
select list                          -- all lists
select listItem                      -- all list items (flat)
select listItem.filter(checked = false)  -- unchecked tasks
select listItem.filter(checked != null)  -- all task items

-- Other elements
select blockquote                    -- all blockquotes
select p                             -- all paragraphs
select image                         -- all images
select inlineCode                    -- all inline code
select html                          -- all raw HTML
select em                            -- all italic text
select strong                        -- all bold text
select del                           -- all strikethrough text
select linkRef                       -- all link references
select imageRef                      -- all image references
select footnote                      -- all footnote references
select def                           -- all definitions
select break                         -- all line breaks

-- Table of contents (structured data)
select toc                           -- [{level, title}, ...] structured objects
select toc.map('title')              -- all heading titles
select toc.map('\t'.repeat(level-1) + title).join('\n')  -- tab-indented text
select toc.filter(level <= 2)        -- first two levels only

-- Outline (formatted string — box-drawing, scalar)
select outline                       -- box-drawing tree, all levels
select outline(2)                    -- box-drawing tree, depth limited
```

### 3.2 `body` Namespace (for property access chains)

`body` is also available for property-access chains, especially useful for nested access:

```sql
select body.h1[0].title              -- same as h1[0].title
select body.table[0].headers[0].content  -- nested table access
select body.listItem[0].children     -- nested list access
```

`body` returns the full `BodyIndex` object. Top-level functions (`h1`, `code`, etc.) read from the same index.

### 3.3 Shorthand Filter Syntax

Element arrays support a call syntax as a shorthand for `.filter()` using wildcard matching:

| Shorthand | Expands To |
|-----------|------------|
| `code("js")` | `code.filter(lang = "js")` — exact match (no wildcards) |
| `h1("A Title")` | `h1.filter(title = "A Title")` — exact match |
| `h1("Some title*")` | `h1.filter(title starts_with "Some title")` — prefix match |
| `h1("*in title*")` | `h1.filter(title contains "in title")` — contains match |
| `link("^https://")` | `link.filter(url starts_with "https://")` — prefix match |
| `blockquote("*Important*")` | `blockquote.filter(content contains "Important")` — contains match |

**Wildcard rules:**
- No wildcards → exact match (`=`)
- Leading `*` → contains match (`contains`)
- Trailing `*` → prefix match (`starts_with`)
- Both `*` → contains match (`contains`)
- Internally, shorthand calls are rewritten to `.filter()` expressions

**Regex via `.filter()` — new `matches` operator:**

```sql
-- Regex matching in .filter()
.filter(title matches "Setup|Config")    -- regex OR
.filter(lang matches "^(js|ts)$")        -- regex exact
.filter(url matches "^https://")         -- regex prefix
.filter(content matches "TODO\\d+")      -- regex with quantifier

-- Shorthand wrappers use wildcards (not regex)
h1("*Setup*")      -- contains "Setup" (wildcard)
h1("*Setup|Config*")  -- contains "Setup|Config" (wildcard, literal |)
```

This keeps shorthand simple for common cases while providing full regex power via `.filter()` when needed.

### 3.4 Paren-Free Convention

Functions with 0 required args are called without parentheses:

```sql
select h1                            -- same as h1()
select code                          -- same as code()
select toc                           -- same as toc()
select outline                       -- same as outline()
select fields                        -- same as fields()
select listItem.filter(...)          -- filter on the array
select h1.filter(...)                -- filter on the array
```

Functions with required args must use parentheses:

```sql
select h1("Setup")                   -- filter arg required
select code("js")                    -- filter arg required
select outline(2)                    -- depth arg required
select fields("tag*")                -- filter arg required
select grep(content, "TODO")         -- both args required
```

---

## 4. BodyIndex Architecture

### 4.1 Lazy Initialization — AST Only When Needed

The AST is **never parsed unless the query accesses a body element function**. Queries that only touch frontmatter (`select title, status`) never trigger an AST parse or walk.

```
File read → file.bodyIndex = null (not parsed, not walked)
Query uses only frontmatter → no AST work, fast path preserved
Query accesses h1() → parse AST → walk once → build ALL indexes → cache on file
Query accesses code() → reads from cache (already built from h1() call)
```

`BodyIndex` is stored on the `FileData` object (like `sections` is today). One per file. Starts as `null`. Only constructed on first body element access.

**This preserves the fast path** for frontmatter-only queries. The remark-parse + unified pipeline is expensive; we only pay that cost when the query actually needs body content.

### 4.2 Single AST Walk

A single `visit()` call collects every element type into typed arrays. The walk uses `unist-util-visit` on the parsed remark AST. Heading content is computed by slicing raw body between heading positions (same technique as current `extractSectionContent`).

### 4.3 Access Pattern

Top-level functions (`h1()`, `code()`, etc.) read from the BodyIndex. The executor resolves these as special identifiers that return the corresponding array from the index. Shorthand filters (`code("js")`) are rewritten to `.filter()` calls by the parser/executor.

**Critical:** If the query has zero body element functions, no `ContentExtractor` is created, no AST is parsed, no walk happens. The existing fast path (frontmatter-only) is fully preserved.

---

## 5. Element Types and Shapes

### 5.1 Headings (h1–h6)

All headings of a given level. Content = everything until next heading of same level (h1 content includes nested h2/h3/etc until next h1).

```typescript
interface HeadingData {
  title: string;       // heading text
  content: string;     // raw body until next same-level heading
  position: Position;  // mdast position {start: {line, column}, end: {line, column}}
}
```

| Syntax | Returns |
|--------|---------|
| `h1()` | `[{title, content, position}, ...]` — all h1 headings |
| `h1[0]` | `{title, content, position}` — first h1 |
| `h1[0].title` | `"string"` — first h1 title text |
| `h1[0].content` | `"string"` — first h1 content until next h1 |
| `h2()` | all h2 headings |
| `h3()`–`h6()` | h3 through h6 |

### 5.2 Links

```typescript
interface LinkData {
  text: string;       // link text content
  url: string;        // href URL
  position: Position;
}
```

| Syntax | Returns |
|--------|---------|
| `link()` | `[{text, url, position}, ...]` |
| `link[0].url` | `"string"` |

### 5.3 Link References

```typescript
interface LinkRefData {
  text: string;        // reference text
  identifier: string;  // reference label
  position: Position;
}
```

### 5.4 Images

```typescript
interface ImageData {
  alt: string;         // alt text
  url: string;         // image URL
  position: Position;
}
```

### 5.5 Image References

```typescript
interface ImageRefData {
  alt: string;         // alt text
  identifier: string;  // reference label
  position: Position;
}
```

### 5.6 Code Blocks (fenced)

```typescript
interface CodeBlockData {
  lang?: string;       // language identifier (undefined if not specified)
  content: string;     // code content
  position: Position;
}
```

### 5.7 Inline Code

```typescript
interface InlineCodeData {
  content: string;     // inline code text
  position: Position;
}
```

### 5.8 Tables (Option C — nested + flat)

```typescript
interface TableCellData {
  content: string;     // cell text content
  position: Position;
}

interface TableRowData {
  cells: TableCellData[];
  position: Position;
}

interface TableData {
  headers: TableCellData[];   // first row cells
  rows: TableRowData[];       // data rows (excludes header)
  position: Position;
}
```

| Syntax | Returns |
|--------|---------|
| `table()` | `[{headers, rows, position}, ...]` |
| `table[0]` | `{headers, rows, position}` |
| `table[0].headers` | `[{content, position}, ...]` |
| `table[0].headers[0].content` | `"string"` |
| `table[0].rows[0]` | `{cells: [...], position}` |
| `table[0].rows[0].cells[0].content` | `"string"` |
| `tableRow()` | flat array of all rows across all tables |
| `tableCell()` | flat array of all cells across all tables |

### 5.9 Lists

```typescript
interface ListItemData {
  content: string;           // item text content
  checked: boolean | null;   // true/false for task items, null for regular
  children: ListItemData[];  // nested sub-list items (empty array if none)
  position: Position;
}

interface ListData {
  ordered: boolean;          // true for <ol>, false for <ul>
  items: ListItemData[];     // top-level items
  position: Position;
}
```

| Syntax | Returns |
|--------|---------|
| `list()` | `[{ordered, items, position}, ...]` |
| `listItem()` | flat array of all items at all levels |
| `listItem[0].content` | `"string"` |
| `listItem[0].checked` | `null` (regular) or `true`/`false` (task) |
| `listItem[0].children` | `[]` or nested `[ListItemData, ...]` |

### 5.10 Blockquotes

```typescript
interface BlockquoteData {
  content: string;     // blockquote text content
  position: Position;
}
```

### 5.11 Paragraphs

```typescript
interface ParagraphData {
  content: string;     // paragraph text
  position: Position;
}
```

### 5.12 HTML

```typescript
interface HtmlData {
  content: string;     // raw HTML
  position: Position;
}
```

### 5.13 Emphasis (italic)

```typescript
interface EmphasisData {
  content: string;     // italic text
  position: Position;
}
```

### 5.14 Strong (bold)

```typescript
interface StrongData {
  content: string;     // bold text
  position: Position;
}
```

### 5.15 Delete (strikethrough)

```typescript
interface DeleteData {
  content: string;     // strikethrough text
  position: Position;
}
```

### 5.16 Line Breaks

```typescript
interface BreakData {
  position: Position;
}
```

### 5.17 Footnote References

```typescript
interface FootnoteRefData {
  label: string;       // footnote label (e.g. "1")
  position: Position;
}
```

### 5.18 Definitions

```typescript
interface DefinitionData {
  identifier: string;  // reference label
  url: string;         // link URL
  title?: string;      // optional title
  position: Position;
}
```

### 5.19 Table of Contents (toc)

Returns structured heading data as an array of objects. Replaces the current `"level:title"` string format.

```typescript
interface TocEntry {
  level: number;       // heading level (1-6)
  title: string;       // heading text
}
```

**Paren-free convention:** functions with 0 required args are called without parentheses.

| Syntax | Returns |
|--------|---------|
| `toc` | `[{level, title}, ...]` — all headings |
| `toc(1, 2)` | first two levels only |
| `toc.map('title')` | `string[]` — just titles |
| `toc.filter(level <= 2)` | first two levels only (alternative) |
| `toc.map('\t'.repeat(level-1) + title).join('\n')` | tab-indented text |

### 5.20 Outline (outline)

Returns a formatted string with box-drawing characters. **Scalar value** — works in all output formats (JSON, table, CSV).

```
├── Installation
│   ├── Prerequisites
│   │   └── Node.js 18+
│   └── Quick Start
├── Usage
│   ├── Basic Queries
│   └── Advanced Features
└── API Reference
```

**Paren-free convention:** functions with 0 required args are called without parentheses.

| Syntax | Returns |
|--------|---------|
| `outline` | `string` — box-drawing tree, all levels |
| `outline(2)` | `string` — box-drawing tree, depth limited to h1+h2 |

---

## 6. Backward Compatibility

Old functions are rewritten as wrappers over the new element functions:

| Old Function | Internal Implementation |
|---|---|
| `fields()` | Unchanged — returns field names (excluding internals) |
| `fields(_, true)` | Unchanged — returns `{field: value}` map |
| `fields("query")` | **NEW** — returns field names matching wildcard pattern |
| `fields("query", true)` | **NEW** — returns entries where key matches wildcard pattern |
| `links()` | Returns `link()` wrapped in old shape `{text, url, position, paragraph?, sentence?, section?}` |
| `images()` | Returns `image()` wrapped in old shape `{alt, url, position, paragraph?, sentence?, section?}` |
| `codeblocks()` | Returns `code()` wrapped in old shape `{lang?, content, position, paragraph?, section?}` |
| `sections()` | Returns heading data from body index wrapped in old shape `{title, level, position, hierarchy, content}` |
| `section("name")` | **REMOVED** — use `h1("Setup")`, `h2("Setup")` etc. instead |
| `toc()` | Returns `[{level, title}, ...]` structured objects (was `"level:title"` strings) |
| `outline()` | **NEW** — returns box-drawing formatted string (scalar) |
| `content` | Unchanged — raw string |

**Migration for `section("name")`:**
- `section("Setup")` → `h1("Setup")` or `h2("Setup")` depending on heading level
- `has section("Setup")` → `h1("Setup").count() > 0` or `h2("Setup").count() > 0`

**Migration for `toc()` return format:**
- Old: `"1:Installation"` string
- New: `{level: 1, title: "Installation"}` object
- Old syntax `toc()[0]` returns `"1:Installation"` → new syntax `toc()[0].title` returns `"Installation"`

**No breakage.** Existing queries continue to work. Old functions add `paragraph`, `sentence`, `section` context fields by walking ancestors (reusing existing `walkWithSections` logic).

---

## 7. QueryAnalyzer Changes

Add new content functions to the scalar enforcement list:

```typescript
const contentBuiltins = [
  'links', 'images', 'codeblocks', 'sections', 'grep', 'toc', 'outline', 'content',
  // New element functions
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'link', 'linkRef', 'image', 'imageRef',
  'code', 'inlineCode',
  'table', 'tableRow', 'tableCell',
  'list', 'listItem',
  'blockquote', 'p', 'html',
  'em', 'strong', 'del', 'break',
  'footnote', 'def',
  // body namespace
  'body'
];
```

All element functions return arrays of maps (JSON-only). Table/CSV throw early errors with shape-aware suggestions:

```
h1() returns an array of maps in the shape {title, content, position}.
Table/CSV require scalar columns. Consider rewriting the query, e.g.
h1().map('title'), h1[0].title, or h1().count().
```

---

## 8. Files Changed

| File | Change |
|------|--------|
| `src/body-index.ts` | **NEW** — `BodyIndex` class with lazy init, single AST walk, all element extraction |
| `src/content-extractor.ts` | Refactor — old extraction methods delegate to `BodyIndex`; `walkWithSections` preserved for backward compat context |
| `src/executor.ts` | Add element functions as special identifiers; evaluate property access chains on `BodyIndex`; rewrite old content function evaluators to use body index |
| `src/builtins.ts` | Extend `fields()` to accept string argument for wildcard filtering; add `outline()` builtin; update `toc()` return type to structured objects |
| `src/query-analyzer.ts` | Add element functions to contentBuiltins list; add shape metadata for all element types |
| `src/types.ts` | Add `BodyIndex` type exports; add element data interfaces |
| `docs/syntax.md` | Document element functions, shorthand filters, element shapes, fields extension |
| `tests/body-index.test.ts` | **NEW** — tests for all element types, lazy init, shorthand filters |
| `tests/body-syntax-integration.test.ts` | **NEW** — integration tests for element functions in SELECT/WHERE/ORDER BY |
| `tests/fields-extension.test.ts` | **NEW** — tests for fields() regex filtering |

---

## 9. Example Queries

```sql
-- All h1 titles across files
select filename, h1.map('title')

-- First h1 content
select filename, h1[0].content

-- Files with JS code blocks
select filename where code("js").count() > 0

-- All unchecked tasks
select filename, listItem.filter(checked = false).map('content')

-- Table headers
select filename, table[0].headers.map('content')

-- Find files with broken-style links (example)
select filename where link("^TODO").count() > 0

-- Bold text
select filename, strong.map('content')

-- Definitions (reference-style links)
select filename, def.map(identifier + " → " + url)

-- H2s containing "Setup"
select filename, h2("*Setup*").map('title')

-- Inline code usage
select filename, inlineCode.map('content')

-- Fields extension (wildcard, same as element functions)
select filename, fields                -- all field names
select filename, fields("tag")         -- field name exactly "tag"
select filename, fields("tag*")        -- field name starts with "tag"
select filename, fields("*tag*")       -- field name contains "tag"

-- Regex via .filter(matches) when needed
select filename, fields.filter(key matches "^task_\\d+$")
select filename, h1.filter(title matches "Setup|Config").map('title')
select filename, code.filter(lang matches "^(js|ts)$").map('content')

-- Table of contents (structured data)
select filename, toc                    -- [{level, title}, ...]
select filename, toc.map('title')       -- just titles
select filename, toc.filter(level <= 2) -- first two levels only
select filename, toc.map('\t'.repeat(level-1) + title).join('\n')  -- indented text

-- Outline (box-drawing, scalar)
select filename, outline                -- box-drawing tree
select filename, outline(2)             -- depth-limited tree
select filename where outline.contains("Setup")  -- works in WHERE
```

---

## 10. Out of Scope

- **Body writes** (UPDATE/CREATE via AST modification) — separate plan
- **MDX/JSX elements** — future extension
- **Custom remark plugins** — future extension

### User-Defined Functions (roadmap)

Medium-scope implementation: anonymous `fn` + named `def` using JS syntax + `new Function()` execution.

**Syntax:**
```sql
-- Named functions (defined once, reusable)
def repeat(s, n): s.repeat(n);
def indent(s, level): '\t'.repeat(level) + s;

-- Anonymous functions (inline lambdas)
select toc.map(fn(x) => '\t'.repeat(x.level - 1) + x.title).join('\n')

-- Compose with existing functions
select code.filter(fn(x) => x.lang === 'js' && x.content.includes('TODO'))
```

**Function directory:**
```
~/.config/mdquery/functions/
├── repeat.js          -- export function repeat(s, n) { return s.repeat(n); }
├── toc-helpers.js     -- export function indent(s, level) { ... }
└── project.js         -- export function sprint(status) { ... }
```

Each file exports named functions. Loaded at startup from `~/.config/mdquery/functions/`. Query uses them directly:
```sql
select toc.map(repeat('\t', level-1) + title).join('\n')
```

**Features:**
- Anonymous functions: `fn(x) => expression` for inline use
- Named functions: `def name(args): body;` for reuse
- Function directory: `~/.config/mdquery/functions/*.js` for persistence
- JS standard library available: `String.repeat`, `Array.filter`, etc.
- Builtin override: user functions shadow builtins (same name wins)
- Security: local CLI only, no sandboxing needed

**Config option:**
```yaml
# ~/.config/mdquery/config.yaml
functions:
  enable: true   # default: false; controls directory loading only
```

| `functions.enable` | `fn()`/`def` in query | `~/.config/mdquery/functions/*.js` |
|---------------------|----------------------|-------------------------------------|
| `false` (default) | ✅ Always available | ❌ Not loaded |
| `true` | ✅ Always available | ✅ Auto-imported at startup |

Inline functions (`fn`/`def`) in queries **always work** regardless of config. The config option only controls whether the function directory is loaded. This way users can write ad-hoc lambdas without any config, but shared/reusable function libraries require explicit opt-in.
