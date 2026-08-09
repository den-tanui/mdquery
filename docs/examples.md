# mdquery examples

Worked scenarios using a `tasks/` directory of markdown files:

```md
# tasks/task-001.md
---
id: 1
title: Fix login bug
status: done
priority: 3
tags: [backend, auth]
estimate: 2
---
Body of the task.
```

```md
# tasks/task-002.md
---
id: 2
title: Write docs
status: todo
priority: 1
tags: [docs]
estimate: 5
---
```

```md
# tasks/task-003.md
---
id: 3
title: Optimize queries
status: todo
priority: 2
tags: [backend, performance]
estimate: 3
---
```

## Filtering

```sh
mdquery --dir=tasks --format=table "select id, title, status where status = 'done'"
```

```
id | title            | status
---|------------------|-------
1  | Fix login bug   | done
```

## Grouping and aggregates

```sh
mdquery --dir=tasks "select status, count(*) group by status"
```

```json
[
  {
    "status": "done",
    "count(*)": 1
  },
  {
    "status": "todo",
    "count(*)": 2
  }
]
```

## Having

```sh
mdquery --dir=tasks "select priority, sum(estimate) group by priority having count(*) >= 1"
```

## Ordering and limiting

```sh
mdquery --dir=tasks "select title order by priority desc"
mdquery --dir=tasks "select title limit 2 offset 1"
```

## Array operators

```sh
# tasks tagged "backend"
mdquery --dir=tasks "select title where tags any = 'backend'"

# tasks whose every tag contains "a"
mdquery --dir=tasks "select title where tags all contains 'a'"
```

## String operators

```sh
mdquery --dir=tasks "select title where title contains 'query'"
mdquery --dir=tasks "select title where title starts_with 'Write'"
mdquery --dir=tasks "select title where status is not empty"
```

## Updating

```sh
mdquery --dir=tasks "update where id = 2 set status = 'done'"
```

This rewrites `tasks/task-002.md` with `status: done`.

## Creating and deleting

```sh
mdquery --dir=tasks "create set title = 'Refactor parser', status = 'todo'"
mdquery --dir=tasks "delete where status = 'archived'"
```

## Pipes

```sh
mdquery --dir=tasks "select title | clipboard()"
```

## Distinct

```sh
mdquery --dir=tasks "select distinct status"
```

## Joining two directories

With a `sprints/` directory holding sprint files (each with an `id` field), link tasks to sprints:

```sh
mdquery --dir=tasks "select title join ../sprints on sprint = id"
```

Joined rows expose the sprint fields prefixed with `sprints.`:

```sh
mdquery --dir=tasks "select title, sprint.title join ../sprints on sprint = id"
```

## Using stdin and formats

```sh
echo "select id, title order by priority" | mdquery --format=csv
```