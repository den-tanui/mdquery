# mdquery syntax reference

`mdquery` treats markdown files in a directory as rows of a table. Each file's YAML **frontmatter** fields become columns. The file `id` defaults to the filename (without `.md`) when no `id` field is present.

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

Creates a new file. `id`, `createdAt`, and `updatedAt` are generated automatically.

```sql
create set title = 'New task', status = 'todo'
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

Examples:

```sql
select where status = 'done' and priority >= 3
select where name contains 'login'
select where tags any = 'backend'
select where tags all contains 'ui'
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

## Data files

- Each row = one `.md` file
- Query target = a directory (default `.`) reading all `.md` files; nested directories are not recursed
- Fields come from YAML frontmatter parsed with [gray-matter]
- Writing is always idempotent; `FileOps.writeFile` emits frontmatter + body

[gray-matter]: https://www.npmjs.com/package/gray-matter