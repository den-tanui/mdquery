# Projext ↔ mdquery Library Integration

## Overview

projext uses mdquery as a library (import/call), not CLI (spawn process). This document defines the programmatic API for integration.

**Key architecture:**
1. **projext controls file discovery** — scans `.projext/` directory
2. **Memory-optimized store** — frontmatter always, content lazy loaded
3. **Card views** — compact (frontmatter only) + extended (with first section)
4. **Git-based change detection** — incremental updates on queries

## Architecture

```
projext (library) → mdquery (library) → results
```

**No process spawning, no string manipulation, no serialization overhead.**

## mdquery Exports

```typescript
// Core API
export function execute(query: string, options?: ExecuteOptions): Result[];
export function parse(query: string): AST;
export function tokenize(input: string): Token[];

// Types
export interface ExecuteOptions {
  files?: FileData[];      // projext passes its files
  hooks?: ExecutorHooks;   // projext customizes behavior
  format?: 'json' | 'table' | 'card';
}

export interface Result {
  [key: string]: any;
}

// Hooks for projext customization
export interface ExecutorHooks {
  onBeforeExecute?: (query: string) => { files?: FileData[] };
  onEvaluateValue?: (value: any, node: ExpressionNode) => any;
  onBeforeWrite?: (query: string) => boolean;
  onAfterRead?: (file: FileData) => FileData;
  onBuiltinCall?: (name: string, args: any[], result: any) => any;
}
```

## projext Types

```typescript
interface LoadConfig {
  maxFiles: number;      // e.g., 100
  maxMemory: number;     // e.g., 10MB
}

interface TaskStoreEntry {
  id: string;            // filename without .md (always loaded)
  path: string;          // full path for file operations (always loaded)
  frontmatter: Record<string, any>;  // Always loaded
  firstSection?: string; // Loaded up to limit, lazy after
  content?: string;      // Loaded up to limit, lazy after
}
```

**projext rules:**
1. `id` = filename without `.md` extension (e.g., `fix-bug.md` → `fix-bug`)
2. No `id` field in frontmatter (projext strips it if present)
3. `id` is unique across all tasks

## projext Usage

```typescript
import { execute, ExecuteOptions, ExecutorHooks } from 'mdquery';

class Projext {
  private hooks: ExecutorHooks = {
    onBeforeExecute: (query) => ({
      files: this.getTaskFiles()  // projext provides files
    }),
    onBuiltinCall: (name, args, result) => {
      if (name === 'status') return this.customStatus(result);
      return result;
    }
  };

  query(sql: string) {
    return execute(sql, { hooks: this.hooks });
  }

  getTaskFiles(): FileData[] {
    // projext knows its structure
    return this.scan('./tasks');
  }
}
```

## File Discovery

projext controls file discovery, not mdquery:

```typescript
// projext decides what files to query
class Projext {
  private taskStore: TaskStoreEntry[] = [];
  private docFiles: FileData[] = [];
  
  private loadConfig: LoadConfig = {
    maxFiles: 100,
    maxMemory: 10 * 1024 * 1024  // 10MB
  };

  async initialize() {
    const files = await this.scanDir('.projext/');
    
    let memoryUsed = 0;
    let filesLoaded = 0;
    
    this.taskStore = files.map(file => {
      // Generate id from filename
      const id = file.filename.replace(/\.md$/, '');
      
      // Always load id + path + frontmatter
      const entry: TaskStoreEntry = {
        id,
        path: file.path,
        frontmatter: this.sanitizeFrontmatter(file.frontmatter),
        firstSection: undefined,
        content: undefined
      };
      
      // Conditionally load content (up to limit)
      const canLoad = 
        filesLoaded < this.loadConfig.maxFiles &&
        memoryUsed < this.loadConfig.maxMemory;
      
      if (canLoad) {
        entry.firstSection = this.extractFirstSection(file.content);
        entry.content = file.content;
        memoryUsed += file.content.length;
        filesLoaded++;
      }
      
      return entry;
    });
  }

  private sanitizeFrontmatter(fm: Record<string, any>): Record<string, any> {
    // Remove id field if present (projext controls id)
    const { id, ...rest } = fm;
    return rest;
  }

  queryTasks(sql: string) {
    return execute(sql, { files: this.taskStore });
  }
}
```

**Loading strategy:**
| Data | When | Purpose |
|------|------|---------|
| id | Always | Unique identifier |
| path | Always | File operations |
| frontmatter | Always | Card display, basic queries |
| firstSection | Up to limit | Extended card view |
| full content | Up to limit | Advanced queries (links, grep) |

**Beyond limit:**
- id + path + frontmatter: always available
- firstSection: lazy load on demand
- full content: lazy load on demand

## Card Rendering

### Compact View (frontmatter only)

```
┌─────────────────────────────────────┐
│ fix-bug  Fix bug           •••      │
│         John                 [todo] │
└─────────────────────────────────────┘
```

```typescript
function renderCompactCard(entry: TaskStoreEntry) {
  return {
    id: entry.id,  // From filename, not frontmatter
    title: entry.frontmatter.title,
    assignee: entry.frontmatter.assignee,
    priority: '•'.repeat(entry.frontmatter.priority || 0),
    status: entry.frontmatter.status
  };
}
```

### Extended View (frontmatter + first section)

```
┌─────────────────────────────────────┐
│ fix-bug  Fix bug           •••      │
│         John                 [todo] │
├─────────────────────────────────────┤
│ This is the description of the task │
│ that summarizes what needs to be    │
│ done...                             │
└─────────────────────────────────────┘
```

```typescript
function renderExtendedCard(entry: TaskStoreEntry) {
  const card = renderCompactCard(entry);
  
  if (entry.firstSection) {
    card.description = entry.firstSection;
  } else if (!entry.firstSection && entry.content) {
    // Lazy load if needed
    card.description = extractFirstSection(entry.content);
  }
  
  return card;
}

function extractFirstSection(content: string): string {
  const lines = content.split('\n');
  let start = -1;
  let end = lines.length;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^#{1,6}\s/)) {
      if (start === -1) {
        start = i + 1;  // Content starts after heading
      } else {
        end = i;  // Next heading = end of first section
        break;
      }
    }
  }
  
  if (start === -1) return '';
  return lines.slice(start, end).join('\n').trim();
}
```

### Board View

```typescript
function renderBoard(entries: TaskStoreEntry[], extended: boolean) {
  const columns: Record<string, any[]> = {
    todo: [],
    doing: [],
    done: []
  };
  
  for (const entry of entries) {
    const status = entry.frontmatter.status || 'todo';
    const card = extended 
      ? renderExtendedCard(entry)
      : renderCompactCard(entry);
    
    columns[status].push(card);
  }
  
  return columns;
}
```

## Id-Based Link Resolution

Since all ids in projext have corresponding paths, md files can link to other md files by id:

**Link syntax in md files:**
```markdown
See [related task](fix-bug) for details.
Check [design doc](design-doc) for architecture.
Blocks [this task](implement-feature) from closing.
```

**projext resolution:**
```typescript
class Projext {
  private idToPath: Map<string, string> = new Map();
  private pathToId: Map<string, string> = new Map();

  async initialize() {
    const files = await this.scanDir('.projext/');
    
    this.taskStore = files.map(file => {
      const id = file.filename.replace(/\.md$/, '');
      
      // Build bidirectional mapping
      this.idToPath.set(id, file.path);
      this.pathToId.set(file.path, id);
      
      return { id, path: file.path, ... };
    });
  }

  // Resolve link URL to path
  resolveLink(url: string): string | null {
    // Check if url matches an id
    if (this.idToPath.has(url)) {
      return this.idToPath.get(url);
    }
    // Otherwise return as-is (external URL or path)
    return null;
  }

  // Resolve path to id
  resolveId(path: string): string | null {
    return this.pathToId.get(path) || null;
  }

  // Get all links from a file
  getLinks(entry: TaskStoreEntry): { text: string; url: string; resolved: string | null }[] {
    if (!entry.content) return [];
    
    const links: { text: string; url: string; resolved: string | null }[] = [];
    const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    
    while ((match = regex.exec(entry.content))) {
      links.push({
        text: match[1],
        url: match[2],
        resolved: this.resolveLink(match[2])
      });
    }
    
    return links;
  }
}
```

**Query examples:**
```sql
-- Find all links to tasks
WHERE links('url') IN (SELECT id FROM tasks)

-- Find tasks linked from a specific task
SELECT title FROM tasks WHERE links('url') = 'fix-bug'

-- Find broken links (links to non-existent ids)
WHERE links('url') NOT IN (SELECT id FROM tasks) AND links('url') NOT LIKE 'http%'

-- Find all tasks that reference this task
SELECT title FROM tasks WHERE links('url') = :current_task_id

-- Get link statistics
SELECT links('url') AS targets, count(*) AS count GROUP BY targets
```

**Benefits:**
1. **Human-readable links** — `[Task Title](fix-bug)` instead of full paths
2. **Portable** — links work regardless of directory structure
3. **Queryable** — can find broken links, follow references
4. **Git-friendly** — ids are stable across renames (if git tracks them)
5. **Bidirectional** — can find both outgoing and incoming links

## Hook Implementations

### onBeforeExecute

Provide file list to mdquery:

```typescript
const hooks: ExecutorHooks = {
  onBeforeExecute: (query) => {
    // projext provides files based on query analysis
    if (query.includes('tasks')) {
      return { files: this.taskFiles };
    }
    return { files: this.allFiles };
  }
};
```

### onBuiltinCall

Custom builtins for projext:

```typescript
const hooks: ExecutorHooks = {
  onBuiltinCall: (name, args, result) => {
    // Custom builtin: projext_status()
    if (name === 'projext_status') {
      return this.getStatus(args[0]);
    }
    return result;
  }
};
```

### onAfterRead

Transform files after reading:

```typescript
const hooks: ExecutorHooks = {
  onAfterRead: (file) => {
    // Add projext-specific metadata
    file.projext_type = this.getType(file);
    file.projext_priority = this.getPriority(file);
    return file;
  }
};
```

## Query Examples

```typescript
// Simple query
const results = execute('SELECT title WHERE status = "todo"');

// With projext files
const results = execute('SELECT title WHERE status = "todo"', {
  files: projext.getTaskFiles()
});

// With hooks
const results = execute('SELECT title WHERE status = "todo"', {
  files: projext.getTaskFiles(),
  hooks: projext.hooks
});

// Write query (UPDATE, CREATE, DELETE)
const results = execute('UPDATE SET status = "done" WHERE title = "Fix bug"', {
  files: projext.getTaskFiles(),
  hooks: projext.hooks
});
```

## Benefits

1. **No process spawning**: Direct function calls
2. **Type safety**: TypeScript types for all APIs
3. **Full control**: projext decides file discovery, builtins, transformations
4. **Performance**: No serialization/deserialization overhead
5. **Composability**: projext can chain multiple queries efficiently

## Migration from CLI

If projext currently uses CLI:

```typescript
// Before (CLI)
import { exec } from 'child_process';
const result = await exec('mdquery --dir ./tasks "SELECT title"');

// After (library)
import { execute } from 'mdquery';
const result = execute('SELECT title', { files: this.getTaskFiles() });
```

## Next Steps

1. Implement programmatic API in mdquery
2. Add ExecutorHooks interface
3. Export types for projext integration
4. Create projext wrapper class
5. Test with projext use cases
