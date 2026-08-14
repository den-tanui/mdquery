# Parser Rewrite Design

## Overview

Complete rewrite of mdquery's parser, lexer, executor, and file I/O system to support:
- Complex nested expressions (e.g., `len(trim(title)) + 5`)
- Type-specific behavior (e.g., `IN` with arrays vs maps)
- Efficient file I/O (lazy loading based on query analysis)
- Fast file search (using fdir + grepts)

See also: [Additional Syntax Design](./2026-08-09-additional-syntax-design.md) for `content()`, `links()`, `images()`, and type-specific behaviors.

## Architecture

```
CLI → Lexer → Parser → AST → Query Analyzer → Executor → Files → Output
                              ↓
                        Determines what
                        files to parse
```

### Components

| Component | Responsibility |
|-----------|----------------|
| **Lexer** | Tokenize query string into tokens |
| **Parser** | Build AST with expression trees using Pratt parsing |
| **Query Analyzer** | Determine what data to fetch (frontmatter vs body) |
| **Executor** | Evaluate expressions, apply filters, return results |
| **File Reader** | Lazy loading based on query analysis |

## Lexer Design

### Token Categories

```typescript
type TokenCategory = 
  | 'keyword'      // SELECT, FROM, WHERE, AND, OR, NOT
  | 'operator'     // =, !=, <, >, +, -, *, /
  | 'builtin'      // len, upper, lower, trim, toc, section, fields, content, links, images, codeblocks
  | 'literal'      // numbers, strings, booleans
  | 'identifier'   // field names, aliases
  | 'delimiter'    // (, ), ,, ;, AS
  | 'eof';         // end of file

// Builtins support property accessor syntax:
// links()         → Link[]
// links('text')   → string[]
// section()       → Section[]
// section('title')→ string[]
// toc()           → "level:title"[]
// toc('title')    → string[]
```

### Token Interface

```typescript
interface Token {
  type: TokenType;
  category: TokenCategory;
  value: string;
  position: number;
  line: number;
  column: number;
}
```

## Parser Design (Pratt Parser)

### Binding Power Table

| Level | Operators | Associativity |
|-------|-----------|---------------|
| 10 | OR | Left |
| 20 | AND | Left |
| 30 | =, !=, <, >, <=, >= | Left |
| 40 | +, - | Left |
| 50 | *, /, % | Left |
| 60 | ^ | Right |
| 70 | NOT, - (unary) | Right |
| 80 | ( function calls ) | Left |

### Core Algorithm

```typescript
class PrattParser {
  parse(): Statement {
    // Level 1: Statement type
    switch (this.current().type) {
      case 'SELECT': return this.parseSelect();
      case 'UPDATE': return this.parseUpdate();
      case 'CREATE': return this.parseCreate();
      case 'DELETE': return this.parseDelete();
    }
  }
  
  // Pratt expression parser
  private expression(rbp: number = 0): Expression {
    let left = this.parsePrefix();
    while (rbp < this.getBindingPower(this.current())) {
      left = this.parseInfix(left);
    }
    return left;
  }
}
```

### AST Nodes

```typescript
type Statement = 
  | SelectStatement
  | UpdateStatement
  | CreateStatement
  | DeleteStatement;

type Expression =
  | BinaryExpression
  | UnaryExpression
  | FunctionCall      // content(), links(), images(), etc.
  | FieldReference
  | Literal
  | ParenthesizedExpression
  | InExpression
  | HasExpression
  | InTocExpression
  | HasSectionExpression;
```

### Data Types

```typescript
type DataType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'array'
  | 'map'
  | 'null'
  | 'unknown';
```

## Query Analyzer

### Analysis Result

```typescript
interface QueryAnalysis {
  needsFrontmatter: boolean;    // Always true
  needsBody: boolean;           // If content, links, images, etc. used
  neededFields: Set<string>;    // Fields referenced in SELECT/WHERE
  bodyMethods: Set<string>;     // Which content builtins: 'links', 'images', etc.
  hasBodyPredicates: boolean;   // WHERE uses body-based functions
  hasAggregates: boolean;       // Uses count(), sum(), etc.
  hasJoins: boolean;            // Uses JOIN clause
}
```

### Body-Dependent Builtins

These trigger `needsBody = true`:

| Builtin | Sets `needsBody` | Notes |
|---------|-------------------|-------|
| `content()` | ✅ | Full body as string |
| `content(N)` | ✅ | First N lines |
| `content(start, end)` | ✅ | Line range |
| `content(-N)` | ✅ | Last N lines |
| `links()` | ✅ | Parse links from body |
| `links('text')` | ✅ | String array of link texts |
| `images()` | ✅ | Parse images from body |
| `images('src')` | ✅ | String array of image sources |
| `codeblocks()` | ✅ | Parse code blocks from body |
| `codeblocks('lang')` | ✅ | String array of languages |
| `section()` | ✅ | Section/heading list |
| `section('title')` | ✅ | String array of titles |
| `section('level')` | ✅ | Number array of levels |
| `toc()` | ✅ | Convenience wrapper for section() |
| `toc('title')` | ✅ | String array of titles |
| `fields()` | ❌ | Frontmatter only |
| `fields('values')` | ❌ | Frontmatter only |

### Analysis Logic

```typescript
function analyzeQuery(ast: Statement): QueryAnalysis {
  const analysis = {
    needsFrontmatter: true,
    needsBody: false,
    neededFields: new Set(['filename', 'path', 'abspath']),
    bodyMethods: new Set<string>(),
    hasBodyPredicates: false,
    hasAggregates: false,
    hasJoins: false
  };
  
  // Analyze SELECT fields
  for (const field of ast.fields) {
    if (isBuiltinNode(field)) {
      if (isBodyBuiltin(field.name)) {
        analysis.needsBody = true;
        analysis.bodyMethods.add(field.name);
      }
    }
  }
  
  // Analyze WHERE clause
  if (ast.where) {
    analyzeWhere(ast.where, analysis);
  }
  
  return analysis;
}

// Body-dependent builtins (with or without property accessor)
const BODY_BUILTINS = new Set([
  'content', 'links', 'images', 'codeblocks', 'section', 'toc'
]);

function isBodyBuiltin(name: string): boolean {
  return BODY_BUILTINS.has(name);
}
```

## File I/O Optimization

### Execution Pipeline

```
Query: SELECT title, status WHERE contains(content, 'bug')

Step 1: fdir         List all .md files                    [O(M)]
Step 2: Query Analyzer  Determine needsBody, predicates   [O(1)]
Step 3: grepts       Pre-filter by content pattern         [O(K), K << M]
Step 4: parse        Read only matching files              [O(K · C)]
Step 5: evaluate     Run WHERE/SELECT on parsed data       [O(K · W)]
```

### Step 1: Fast File Listing (fdir)

```typescript
import { fdir } from 'fdir';

function listFiles(dir: string): string[] {
  return new fdir()
    .withFullPaths()
    .glob('**/*.md')
    .crawl(dir)
    .sync();
}
```

**Why fdir:** Native C++ bindings, 1M files/sec, zero dependencies. Replaces recursive `readdir` with per-directory gitignore overhead.

### Step 2: Query Analyzer

```typescript
function analyzeQuery(ast: Statement): QueryAnalysis {
  // ... determines needsBody, neededFields, bodyPredicates
  // Body predicates enable grepts pre-filter
}
```

### Step 3: Content Pre-Filter (grepts)

Only runs when `analysis.bodyPredicates` is non-empty (WHERE uses content-based predicates).

```typescript
import { search } from 'grepts';

function preFilterByContent(
  files: string[],
  predicates: BodyPredicate[],
  dir: string
): string[] {
  // Extract search pattern from first content predicate
  const pattern = predicates[0].value;
  
  // grepts searches file content natively
  const matches = search({
    path: dir,
    pattern,
    glob: '*.md',
    ignore: ['node_modules', '.git']
  });
  
  // Intersect with file list (respects depth, hidden, etc.)
  const matchSet = new Set(matches.map(m => m.path));
  return files.filter(f => matchSet.has(f));
}
```

**When grepts helps:**
- `WHERE contains(content, 'bug')` → find files containing "bug"
- `WHERE content matches 'regex'` → find files matching regex
- `WHERE content() LIKE '%TODO%'` → find files with "TODO"

**When grepts doesn't help (skip pre-filter):**
- Filtering only on frontmatter fields (`WHERE status = 'todo'`)
- `content()` used in SELECT but not in WHERE
- No string predicates in WHERE

### Step 4: Parse (Lazy)

```typescript
async function readFiles(
  filePaths: string[],
  analysis: QueryAnalysis
): Promise<FileData[]> {
  const files: FileData[] = [];
  
  for (const fp of filePaths) {
    const raw = await readFile(fp, 'utf-8');
    const { data, content } = splitFrontmatter(raw);
    
    const file: FileData = {
      ...parseDates(data),
      filename: basename(fp, '.md'),
      path: relative(dir, fp),
      abspath: fp,
      filepath: fp,
      content: analysis.needsBody ? new ContentImpl(content) : null
    };
    
    files.push(file);
  }
  
  return files;
}
```

### Step 5: Evaluate

```typescript
// WHERE, SELECT, GROUP BY, ORDER BY, LIMIT — all on FileData[]
// Frontmatter fields accessed flat: file.title, file.status
// Content accessed via: file.content?.lines(), links(), images(), etc.
```

### Performance Comparison

**Example:** 100 files, 10 contain "bug", frontmatter-only query

| Step | Current | Planned |
|---|---|---|
| List files | 50ms (readdir) | 0.5ms (fdir) |
| Read files | 100ms (100 files) | 5ms (frontmatter only) |
| Evaluate | 1ms | 0.5ms |
| **Total** | **151ms** | **6ms** |

**Example:** 100 files, 10 contain "bug", content query

| Step | Current | Planned |
|---|---|---|
| List files | 50ms (readdir) | 0.5ms (fdir) |
| Pre-filter | — | 1ms (grepts) |
| Read files | 100ms (100 files) | 10ms (10 files) |
| Evaluate | 1ms | 0.1ms |
| **Total** | **151ms** | **11.6ms** |

## Error Handling

### Error Types

```typescript
interface QueryError {
  type: 'syntax' | 'semantic' | 'runtime';
  severity: 'error' | 'warning' | 'info';
  message: string;
  location?: {
    line: number;
    column: number;
    length: number;
  };
  suggestion?: string;
}
```

### Error Recovery

```typescript
class Parser {
  parse(): Statement {
    try {
      return this.parseStatement();
    } catch (e) {
      if (e instanceof SyntaxError) {
        this.errors.push({
          type: 'syntax',
          message: e.message,
          location: this.getLocation()
        });
        
        // Recovery: skip to next statement
        this.skipToNextStatement();
        return this.parse();
      }
      throw e;
    }
  }
}
```

## Performance Targets

| Operation | Current | Target |
|-----------|---------|--------|
| List 1000 files | 50ms | 1ms |
| Read frontmatter | 100ms | 20ms |
| Search "TODO" | 200ms | 5ms |
| Parse body | 150ms | 30ms |
| Total query | 500ms | 50ms |

## Libraries

| Library | Purpose | Why |
|---------|---------|-----|
| **fdir** | Fast file listing | 1M files/sec, zero dependencies |
| **grepts** | Fast text search | 323x faster than ripgrep (in-process) |
| **gray-matter** | Frontmatter parsing | Fast, lightweight, mature |

## Implementation Plan

### Phase 1: Lexer & Parser
- Implement Pratt parser with binding power table
- Support all expression types
- Add error recovery

### Phase 2: Query Analyzer
- Implement AST analysis
- Determine what data to fetch
- Optimize file reading

### Phase 3: Executor
- Implement type-specific behavior
- Add all builtins
- Support all operators

### Phase 4: File I/O
- Integrate fdir for fast listing
- Add lazy loading
- Integrate grepts for search

### Phase 5: Testing
- Add comprehensive tests
- Performance benchmarks
- Edge case testing

## Backward Compatibility

- All existing queries must work unchanged
- New syntax is additive, not breaking
- Performance should improve, not regress
