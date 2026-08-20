# mdquery syntax reference

`mdquery` treats markdown files in a directory as rows of a table. Each file's YAML **frontmatter** fields become columns. Every row also exposes the identity fields `filename` (file name without `.md`), `path` (relative to the search directory), and `abspath` (absolute path). `id` is a plain frontmatter field — it is only present when the file declares it.

Two extra fields are available on every row:

- `body` — the markdown body with the frontmatter block stripped (useful for content queries and extraction)
- `frontmatter` — the raw parsed frontmatter object as a single field

`body` is selectable directly: `select title, body`.

## What's implemented

mdquery is feature-complete for CLI use with arbitrary markdown files:

- Full CRUD: SELECT, UPDATE, CREATE, DELETE
- WHERE with comparison, string, membership, and quantifier operators
- GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET
- JOIN across directories
- Subqueries: `count(select ...)`, `exists(select ...)`
- Correlated subqueries: `outer.field`
- Triggers: before/after with deny, set, run
- Pipes: `clipboard()`
- Builtins: now, today, len, upper, lower, trim, etc.
- Aggregates: count, sum, avg, min, max
- Table view: compact mode

## Not yet implemented (projext layer)

These features are planned for projext library mode via hooks:

- Date/duration types: `2026-03-25`, `2day`
- Date arithmetic: `date - date`, `date + duration`
- Schema validation
- `has()` with qualified fields: `has(new.status)`
- Pipe `| run()` action
- Time triggers: `every 1hour ...`
- Custom builtins via `onBuiltinCall` hook

> Note: the internal `TypeSystem` module (date/number/boolean coercion, array set arithmetic, typed comparisons) landed with the parser rewrite. It is wired into `update`/`create` `set` clauses via explicit type hints and into expression evaluation, but the full date/duration *literal* syntax above remains a projext-layer feature.

## Statements

### SELECT

```sql
select [distinct] <fields> [where <cond>] [group by <field>, ...] [having <cond>] [order by <field> [asc|desc], ...] [limit <n>] [offset <n>] [join <table> on <cond>]
```

- `<fields>` is a comma-separated list of field names, `*` for all, or aggregate functions (`count`, `sum`, `avg`, `min`, `max`).
- `select` with no fields is shorthand for `select *`.

```sql
select title, status where status = 'done'
select * order by priority desc limit 10
select status, count(*) group by status
```

### UPDATE

```sql
update [where <cond>] set <field> = <value>, ...
```

Modifies matching files' frontmatter in place.

```sql
update where status = 'todo' set status = 'done'
```

### CREATE

```sql
create set <field> = <value>, ...
```

Creates a new file. `createdAt` and `updatedAt` are generated automatically.

The target file is chosen from the `abspath`, `path` (relative to the search directory), or `file`/`filename` fields in the `set` clause. Without one of these, `create` fails with `create requires path to file`.

```sql
create set path = 'tasks/task-002.md', title = 'New task', status = 'todo'
```

### DELETE

```sql
delete [where <cond>]
```

Deletes matching files. **With no `where` this deletes every file in the directory.**

```sql
delete where status = 'archived'
```

### Pipes

Any statement can be piped into a function:

```sql
<statement> | <function>(<args...>)
```

```sql
select title | clipboard()
select | len()
```

### Triggers

```sql
before|after create|update|delete [where <cond>] deny <message>
before|after create|update|delete [where <cond>] set <field> = <value>, ...
before|after create|update|delete [where <cond>] run <command>
```

## WHERE clause

Comparisons compose with `and`, `or`, `not`, and parentheses.

### Operators

| Operator | Meaning |
| --- | --- |
| `=` `!=` | equality / inequality |
| `<` `<=` `>` `>=` | ordering (numeric and string) |
| `contains <val>` | substring match |
| `starts_with <val>` | prefix match |
| `ends_with <val>` | suffix match |
| `matches <regex>` | regex match (e.g. `title matches "Set.*"`) |
| `is empty` / `is not empty` | null or empty check |
| `in (`val, ...)` | membership in a list |
| `any <op>` / `all <op>` | match inside an array field |
| `exists (<subquery>)` | subquery existence |
| `"value" in toc()` | check if heading exists in markdown body |
| `has section("name")` | check if section exists in markdown body (deprecated — prefer `h1("name").count() > 0`) |
| `has_section("name")` | function form of `has section("name")` (deprecated) |

Examples:

```sql
select where status = 'done' and priority >= 3
select where name contains 'login'
select where tags any = 'backend'
select where tags all contains 'ui'
select where "TODO" in toc()
select where has section("Fix bugs")
```

Field access with dot notation works for nested/qualified fields:

```sql
where old.status = 'todo'
where project.title = 'frost'
```

## Functions (builtins)

Callable in `set` clauses and as values:

| Function | Description |
| --- | --- |
| `now()` | current ISO timestamp |
| `today()` | current date (`YYYY-MM-DD`) |
| `len(x)` | length of a string/array |
| `upper(x)` / `lower(x)` / `trim(x)` | string manipulation |
| `contains(a, b)` | string contains |
| `starts_with(a, b)` / `ends_with(a, b)` | string prefix/suffix |
| `split(s, delim)` / `join(arr, delim)` | string <-> array |
| `arr.join(delim)` | join an array of scalars into a string (default `,`) |
| `id()` / `user()` | current row id / current user |
| `date(s)` | parse date to ISO |
| `next_date('daily'\|'weekly'\|'monthly'\|'yearly'\|<n>)` | next recurrence / in n days |
| `nextEnum(val, [a, b, c])` / `prevEnum(val, [..])` | cycle through enum values |
| `fields()` | return frontmatter field map `{field: value}` (use `fields().keys()` / `.values()` for lists) |
| `fields("query")` | wildcard-filtered field names (`fields("task_*")`); `fields("query", true)` returns the matching `{field: value}` map |
| `toc()` | return array of `{level, title}` entries (structured objects) |
| `outline()` | return a box-drawing heading tree as a scalar string (works in all output formats); `outline(2)` limits depth |
| `sections()` | return array of section maps `{title, level, position, hierarchy, content}` |
| `section("name")` | **deprecated** — return first exact-match section map, or `null`; prefer `h1("name")` / `h2("name")` shorthands |
| `trimAll(x)` | replace presentation-breaking chars (`\n \r \t \v \f \u2028 \u2029 \u0085 | \0 \x00-\x1f`) with spaces |

## Body elements

Every markdown body is parsed into typed element arrays. Each element function returns an array of element objects for the current file. The parser uses [remark-parse] + [remark-gfm], so tables, task lists, strikethrough, and footnotes are supported.

### Top-level element functions

| Function | Returns |
| --- | --- |
| `h1` … `h6` | headings of that level |
| `link` | inline links |
| `linkRef` | reference-style links (`[text][id]`) |
| `image` | inline images |
| `imageRef` | reference-style images (`![alt][id]`) |
| `code` | fenced code blocks |
| `inlineCode` | inline code spans |
| `table` | tables (`{headers, rows}`) |
| `tableRow` | all table data rows (flat) |
| `tableCell` | all table cells (flat) |
| `list` | lists (`{ordered, items}`) |
| `listItem` | all list items (flat, with `checked` for task items) |
| `blockquote` | blockquotes |
| `p` | paragraphs |
| `html` | raw HTML blocks |
| `em` | emphasis (`*text*`) |
| `strong` | strong (`**text**`) |
| `del` | strikethrough (`~~text~~`) |
| `break` | hard line breaks |
| `footnote` | footnote references (`[^1]`) |
| `def` | link/image definitions (`[id]: url`) |

### Element shapes

| Element | Fields |
| --- | --- |
| `h1`…`h6` | `title: string`, `level: number`, `content: string`, `position` |
| `link` | `text: string`, `url: string`, `position` |
| `linkRef` | `text: string`, `identifier: string`, `position` |
| `image` | `alt: string`, `url: string`, `position` |
| `imageRef` | `alt: string`, `identifier: string`, `position` |
| `code` | `lang: string?`, `content: string`, `position` |
| `inlineCode` | `content: string`, `position` |
| `table` | `headers: [{content, position}]`, `rows: [{cells: [{content, position}], position}]`, `position` |
| `tableRow` | `cells: [{content, position}]`, `position` |
| `tableCell` | `content: string`, `position` |
| `list` | `ordered: boolean`, `items: [listItem]`, `position` |
| `listItem` | `content: string`, `checked: boolean\|null`, `children: [listItem]`, `position` |
| `blockquote` | `content: string`, `position` |
| `p` | `content: string`, `position` |
| `html` | `content: string`, `position` |
| `em` / `strong` / `del` | `content: string`, `position` |
| `break` | `position` |
| `footnote` | `label: string`, `position` |
| `def` | `identifier: string`, `url: string`, `title: string?`, `position` |

`position` is the mdast source position: `{start: {line, column, offset}, end: {line, column, offset}}`.

### Paren-free convention

Zero-argument element functions can be called **without parentheses**:

```sql
select h1            -- same as h1()
select code          -- same as code()
select toc           -- same as toc()
```

Chaining works the same as with parentheses:

```sql
select h1[0].title
select h1.filter(title contains "Setup")
select link.map('url')
select table[0].headers.map('content')
select h1.count()
```

### Shorthand filters

Passing a string argument filters the element array by a per-type default field using wildcard matching:

| Function | Filter field | Example |
| --- | --- | --- |
| `h1`…`h6` | `title` | `h1("Setup")` |
| `link` | `url` | `link("https*")` |
| `linkRef` / `def` | `identifier` | `def("ref-*")` |
| `image` | `alt` | `image("logo*")` |
| `imageRef` | `identifier` | `imageRef("img-*")` |
| `code` | `lang` | `code("js")` |
| `inlineCode` / `p` / `em` / `strong` / `del` / `blockquote` / `listItem` / `tableCell` | `content` | `blockquote("*Important*")` |
| `footnote` | `label` | `footnote("1")` |
| `table` / `tableRow` / `list` / `break` | — (no filter) | — |

Wildcard rules: no wildcard = exact match; trailing `*` = prefix; leading `*` = suffix; both = contains; `*` alone = all.

```sql
select h1("Setup")            -- exact title match
select h1("Set*")             -- titles starting with "Set"
select code("js")             -- js code blocks
select link("https*")         -- https links
select blockquote("*Important*")  -- blockquotes containing "Important"
```

### body namespace

The `body` field (raw markdown body) can be indexed by element name to reach the same arrays:

```sql
select body.h1[0].title
select body.code[0].lang
select body.table[0].headers[0].content
```

`select body` alone still returns the raw markdown body string (unchanged).

### matches operator

Regex filtering works in `.filter()` and in `WHERE`:

```sql
select h1.filter(title matches "Set.*")
select title where h1.filter(title matches "Setup|Config").count() > 0
select fields().filter(key matches "^task_\\d+$")
```

### Scalar enforcement

Table/CSV output requires **scalar columns**. Element arrays are arrays of maps, so they are JSON-only — table/CSV throw an early error naming the expression and suggesting a rewrite:

```sql
select h1                          -- JSON ok; table/csv error
select h1.map('title')             -- scalar: ok everywhere
select h1.count()                  -- scalar: ok everywhere
select h1[0].title                 -- scalar: ok everywhere
```

### Backward compatibility

The older extraction functions are unchanged and still available: `links()`, `images()`, `codeblocks()`, `sections()`, `section("name")` (deprecated — prefer `h1("name")` / `h2("name")`), `toc()` (now returns structured `[{level, title}]` objects), `outline()` (new scalar tree string), and `fields()` (now supports wildcard filtering).

[remark-parse]: https://www.npmjs.com/package/remark-parse
[remark-gfm]: https://www.npmjs.com/package/remark-gfm

## Aggregate functions

Available in `select`, `group by`, and `having`:

- `count(*)`, `count(field)`, `sum(field)`, `avg(field)`, `min(field)`, `max(field)`

```sql
select status, count(*) group by status
select priority, avg(estimate) group by priority having count(*) > 1
```

## JOIN

```sql
select ... join <dir> on <cond>
```

Merges a second directory of markdown files (a second "table"). Joined fields are prefixed `<table>.<field>`; `id`, `filepath`, and `content` are excluded.

```sql
select title join ../sprints on sprint = id
```

## Output formats

| Format | Role | Notes |
| --- | --- | --- |
| `json` (default) | Data format | Full result object `{type, data, count, meta}`; valid JSON; ISO date strings |
| `csv` | Data format | RFC 4180 via csv-stringify; proper quoting, newlines, formula escaping |
| `table` | Presentation only | Grid view; content capped at 20 chars, `abspath` at 24 |

`--json`, `--csv`, and `--table` are shortcuts for `--format=json|csv|table`. If both `--format` and a shortcut are given, the last flag on the command line wins.

Table/CSV require **scalar columns** (string/number/boolean/null). Arrays of scalars (e.g. `tags`) flatten to `"a,b"`. Expressions returning maps or arrays of maps (e.g. `sections()`, `links()`, `codeblocks()`, `fields()`) are JSON-only — table/CSV throw an early error naming the expression and suggesting a rewrite (e.g. `sections().map('title')`, `section("name").content`, `fields().keys()`).

## Error handling

Problematic files are skipped and logged rather than crashing the whole query:

- **Read phase**: a file with malformed frontmatter is skipped; the error is recorded with its path and reason.
- **Evaluate phase**: a file whose row fails to evaluate is skipped; the error is recorded with its path and the failing expression.
- **meta**: every result includes `meta: {filesSearched, filesMatched, timings, errors}` where `errors` is `[{path, error, phase}]` (`phase`: `read` | `prefilter` | `evaluate`). The CLI prints a concise summary line (e.g. `warning: skipped 2 files (see meta.errors)`).

## Data files

- Each row = one `.md` file
- Query target = a directory (default `.`) reading all `.md` files
- Search depth: `0` = current directory only (default), `1` = one level down, `-1` = recursive
- Hidden files are skipped unless `--hidden` is passed
- `.gitignore` rules are respected by default (including nested `.gitignore` files); `--no-ignore` disables this. `.git` directories are always skipped
- Fields come from YAML frontmatter parsed with [gray-matter]
- Writing is always idempotent; `FileOps.writeFile` emits frontmatter + body
- `update` writes back to the file's original location, preserving its path

[gray-matter]: https://www.npmjs.com/package/gray-matter