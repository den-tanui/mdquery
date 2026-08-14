# mdquery syntax reference

`mdquery` treats markdown files in a directory as rows of a table. Each file's YAML **frontmatter** fields become columns. Every row also exposes the identity fields `filename` (file name without `.md`), `path` (relative to the search directory), and `abspath` (absolute path), plus the file metadata fields `mtime` (modification time), `updatedAt` (alias for `mtime`), and `createdAt` (creation time; may be `null` on some filesystems). `id` is a plain frontmatter field — it is only present when the file declares it.

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
| `is empty` / `is not empty` | null or empty check |
| `in (`val, ...)` | membership in a list |
| `any <op>` / `all <op>` | match inside an array field |
| `exists (<subquery>)` | subquery existence |
| `"value" in toc()` | check if heading exists in markdown body |
| `has section("name")` | check if section exists in markdown body |
| `has_section("name")` | function form of `has section("name")` |

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
| `id()` / `user()` | current row id / current user |
| `date(s)` | parse date to ISO |
| `next_date('daily'\|'weekly'\|'monthly'\|'yearly'\|<n>)` | next recurrence / in n days |
| `nextEnum(val, [a, b, c])` / `prevEnum(val, [..])` | cycle through enum values |
| `fields()` | return frontmatter field map `{field: value}` (use `fields().keys()` / `.values()` for lists) |
| `toc()` | return array of `{level, title}` entries |
| `sections()` | return array of section maps `{title, level, position, hierarchy, content}` |
| `section("name")` | return first exact-match section map, or `null` |
| `trimAll(x)` | replace presentation-breaking chars (`\n \r \t \v \f \u2028 \u2029 \u0085 | \0 \x00-\x1f`) with spaces |

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