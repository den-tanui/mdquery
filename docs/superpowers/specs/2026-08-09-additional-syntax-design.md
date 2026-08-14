# Additional Syntax Design

## Overview

New syntax additions for the parser rewrite:
- `content()` builtin with line-range access
- `grep()` builtin for regex pattern matching on markdown content (within sections)
- Content extraction builtins: `links()`, `images()`, `codeblocks()` — AST-based extraction with paragraph context
- Property accessor pattern: `builtin('property')` for predictable return types
- Array/map operations: indexing, filter, map, sort, slice, flatten
- Chained methods for complex queries: `links().filter(section = 'Setup').map('url')`
- File representation split: frontmatter (flat) + content (lazy)
- Type-specific operator behavior
- Raw AST `position` object for precise location data
- Selected ancestors: `paragraph` for context, `section` for hierarchy

## Property Accessor Pattern

Builtins that return structured objects support a property accessor argument to return flat arrays:

```typescript
// No args: full objects
links()        → [{text, url, position, paragraph, section}, ...]

// With property arg: flat array of that property
links('text')        → ["Read more", "Docs"]
links('url')         → ["/docs", "/api"]
links('line')        → [1, 5]  (from position.start.line)
links('paragraph')   → ["Check out our docs...", "See the API..."]
links('section')     → [["Installation"], ["Setup", "Intro"]]
```

This pattern applies to all builtins that return structured data:

| Builtin | No args | With property arg |
|---------|---------|-------------------|
| `grep(pattern)` | `GrepMatch[]` | `grep(pattern)('text')` → `string[]` |
| `links()` | `Link[]` | `links('text')` → `string[]` |
| `images()` | `Image[]` | `images('alt')` → `string[]` |
| `codeblocks()` | `CodeBlock[]` | `codeblocks('lang')` → `string[]` |
| `toc()` | `"level:title"[]` | `toc('title')` → `string[]` |
| `section()` | `Section[]` | `section('title')` → `string[]` |
| `section('hierarchy')` | - | `string[][]` (full path from root) |
| `fields()` | `string[]` | `fields('values')` → `any[]` |

## Grep Builtin — Generic Pattern Matching

`grep()` is the parent function for content pattern matching. It takes a regex pattern and returns generic matches. The content extraction builtins (`links()`, `images()`, `codeblocks()`) are convenience wrappers that use specific patterns internally.

**Architecture:** Parse markdown into AST once, extract sections, grep within each section for automatic section context.

```typescript
interface GrepMatch {
  line: number;         // line number (1-indexed)
  column: number;       // start column (0-indexed)
  text: string;         // full matched text
  captures: string[];   // regex capture groups
  section: string[];    // section hierarchy: ["Installation", "Getting Started"]
}
```

### Syntax

```
-- Generic regex matching
SELECT grep(/TODO/g)                    → GrepMatch[]
SELECT grep(/TODO/gi)                   → case-insensitive

-- With property accessor
SELECT grep(/TODO/g)('text')            → string[]  ["TODO: fix this", "TODO: implement"]
SELECT grep(/TODO/g)('line')            → number[]  [5, 12]
SELECT grep(/TODO/g)('captures')        → string[][]  [["TODO: fix this"], ["TODO: implement"]]

-- In WHERE
WHERE grep(/TODO/g)('text') CONTAINS 'fix'
WHERE grep(/TODO/gi)('line') < 10

-- With section context
WHERE grep(/TODO/g)('section')[0] = 'Installation'
```

### Implementation (Hybrid AST + Regex)

```typescript
function grep(file: FileData, pattern: string | RegExp, property?: string): GrepMatch[] | any[] {
  if (!file.content) return property ? [] : [];
  
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : pattern;
  const sections = extractSectionsFromAST(file.content.raw);  // AST-based
  const matches: GrepMatch[] = [];
  
  // Grep each section's content
  for (const section of sections) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    
    while ((m = regex.exec(section.content))) {
      // Compute position relative to section start
      const localOffset = m.index;
      const localLine = section.content.slice(0, localOffset).split('\n').length;
      const globalLine = section.line + localLine - 1;
      const globalOffset = file.content.raw.indexOf(section.content) + localOffset;
      
      // Find line start offset for column calculation
      const lineStart = file.content.raw.lastIndexOf('\n', globalOffset) + 1;
      const column = globalOffset - lineStart;
      
      matches.push({
        text: m[0],
        captures: m.slice(1),
        position: {
          start: { line: globalLine, column, offset: globalOffset },
          end: { line: globalLine, column: column + m[0].length, offset: globalOffset + m[0].length }
        },
        section: section.hierarchy
      });
    }
  }
  
  if (!property) return matches;
  if (property === 'text') return matches.map(m => m.text);
  if (property === 'captures') return matches.map(m => m.captures);
  if (property === 'section') return matches.map(m => m.section);
  if (property === 'line') return matches.map(m => m.position.start.line);
  if (property === 'column') return matches.map(m => m.position.start.column);
  if (property === 'offset') return matches.map(m => m.position.start.offset);
  return [];
}
```

**Key benefits:**
- Parse AST once, reuse for all builtins
- Section hierarchy from AST (robust, handles nesting)
- Regex within sections (fast pattern matching)
- Automatic section context for all matches

### Convenience Builtins

`links()`, `images()`, `codeblocks()` use AST directly for extraction (see Implementation section below). They provide structured data with position, paragraph context, and section hierarchy.

`grep()` uses regex within sections for arbitrary pattern matching.

## File Representation

The file is split into two layers: **frontmatter** (flat, always loaded) and **content** (loaded on demand).

```typescript
// Frontmatter fields — accessed flat, same as today
interface FileData {
  filename: string;
  path: string;
  abspath: string;
  filepath: string;
  [key: string]: any;          // title, status, etc. — direct access
  content: Content | null;     // null when frontmatter-only mode
}

// Content — lazy evaluation, accessed via builtins
interface Content {
  raw: string;                         // full markdown body
  sections: Map<string, Section>;      // parsed on first access

  // Line access (internal, used by content() builtin)
  lines(start?: number, end?: number): string;
}
```

**Backward compatibility:** `SELECT title, status` works exactly as before. Content is only loaded when `content` or content builtins appear in SELECT/WHERE.

## Unified Section Builtin

A section in markdown IS a heading + its content. One builtin handles everything.

**Architecture:** Parse markdown into AST once, extract sections from AST, reuse for all builtins.

```typescript
interface Section {
  level: number;          // 1-6
  title: string;          // heading text
  line: number;           // heading line number
  endLine: number;        // last line of section (before next heading or EOF)
  column: number;         // start column (after #)
  content: string;        // text under this heading until next heading
  hierarchy: string[];    // ["Installation", "Getting Started", "Introduction"]
}
```

### Syntax

```
-- Full objects
SELECT section                     → Section[]

-- Property accessors
SELECT section('title')            → ["Introduction", "Setup", "Usage"]
SELECT section('level')            → [1, 2, 2]
SELECT section('content')          → ["...", "...", "..."]
SELECT section('line')             → [1, 5, 12]
SELECT section('endLine')          → [4, 11, 20]
SELECT section('hierarchy')        → [["Introduction"], ["Introduction", "Setup"], ...]

-- Convenience (backward compat)
SELECT toc()                       → ["1:Introduction", "2:Setup", "2:Usage"]
SELECT toc('title')                → ["Introduction", "Setup", "Usage"]
```

### Implementation (AST-based)

```typescript
import { remark } from 'remark';
import { visit } from 'unist-util-visit';

function parseSectionsFromAST(content: string): Section[] {
  const tree = remark().parse(content);
  const sections: Section[] = [];
  const headings: { node: any; level: number; title: string; line: number }[] = [];
  
  // Extract all headings from AST
  visit(tree, 'heading', (node) => {
    headings.push({
      node,
      level: node.depth,
      title: node.children[0]?.value || '',
      line: node.position.start.line
    });
  });
  
  // Build sections with hierarchy and content
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const nextH = headings[i + 1];
    
    // Build hierarchy: path from root to current heading
    const hierarchy: string[] = [];
    for (const prev of headings) {
      if (prev.line > h.line) break;
      if (prev.level < h.level) {
        hierarchy.push(prev.title);
      } else if (prev.level === h.level) {
        // Same level: rebuild hierarchy
        hierarchy.length = 0;
        for (const p of headings) {
          if (p.line > h.line) break;
          if (p.level < h.level) hierarchy.push(p.title);
        }
        break;
      }
    }
    hierarchy.push(h.title);
    
    // Content: text until next heading or EOF
    const startLine = h.line;
    const endLine = nextH ? nextH.line - 1 : tree.position.end.line;
    const content = extractLines(content, startLine, endLine);
    
    sections.push({
      level: h.level,
      title: h.title,
      line: h.line,
      endLine: endLine,
      column: h.node.position.start.column,
      content: content,
      hierarchy: hierarchy
    });
  }
  
  return sections;
}

function extractLines(content: string, start: number, end: number): string {
  const lines = content.split('\n');
  return lines.slice(start - 1, end).join('\n').trim();
}
```

### Performance

- **Parse once:** AST parsing ~1-5ms per file (one-time cost)
- **Reuse for all builtins:** sections, grep, links, images, codeblocks
- **Section hierarchy:** Computed from AST structure (robust)

### Body-Dependent Builtins (Updated)

| Builtin | Sets `needsBody` | Notes |
|---------|-------------------|-------|
| `content()` | ✅ | Full body as string |
| `content(N)` | ✅ | First N lines |
| `content(start, end)` | ✅ | Line range |
| `content(-N)` | ✅ | Last N lines |
| `links()` | ✅ | Parse links from body |
| `images()` | ✅ | Parse images from body |
| `codeblocks()` | ✅ | Parse code blocks from body |
| `section()` | ✅ | Section/heading list |
| `toc()` | ✅ | Convenience wrapper for section() |
| `fields()` | ❌ | Frontmatter only |

## `content()` Builtin

Returns the markdown body content (everything after frontmatter).

| Syntax | Returns | Requires body |
|--------|---------|---------------|
| `content()` | Full body text | Yes |
| `content(10)` | First 10 lines | Yes |
| `content(1, 45)` | Lines 1–45 (1-indexed, inclusive) | Yes |
| `content(-10)` | Last 10 lines | Yes |
| `content(-20, -1)` | Last 20 lines, excluding final line | Yes |

```typescript
// Content type — lazy, cached
class ContentImpl implements Content {
  raw: string;
  sections: Map<string, Section> | null = null;
  private _lines: string[] | null = null;

  constructor(raw: string) {
    this.raw = raw;
  }

  lines(start?: number, end?: number): string {
    if (!this._lines) this._lines = this.raw.split('\n');
    const allLines = this._lines;
    const total = allLines.length;

    if (start !== undefined && end === undefined && start > 0) {
      return allLines.slice(0, start).join('\n');
    }

    const s = start === undefined ? 0 : (start < 0 ? total + start : start - 1);
    const e = end === undefined ? total : (end < 0 ? total + end : end);

    if (start === undefined && end === undefined) return this.raw;
    return allLines.slice(Math.max(0, s), Math.min(total, e)).join('\n');
  }
}
```

**Index resolution examples:**

| Call | Lines | Resolved slice | Behavior |
|------|-------|----------------|----------|
| `content()` | 100 total | `[0, 100]` | Full body |
| `content(10)` | 100 total | `[0, 10]` | First 10 lines |
| `content(1, 5)` | 100 total | `[0, 5]` | Lines 1–5 |
| `content(-10)` | 100 total | `[90, 100]` | Last 10 lines |
| `content(-20, -1)` | 100 total | `[80, 99]` | Last 20, skip final newline |

## Content Extraction Builtins

Convenience builtins that wrap `grep()` with specific patterns. They parse regex captures into structured objects (Link, Image, CodeBlock).

**Architecture:** All use the hybrid AST + regex approach:
1. Parse markdown into AST once (remark)
2. Extract sections from AST (with hierarchy)
3. Grep each section's content with regex
4. Return matches with section context automatically

### Relationship to grep()

```typescript
// These use the same hybrid AST + regex approach as grep():
links()      = parseSectionsFromAST() + grep(/\[([^\]]*)\]\(([^)]+)\)/g)  → Link[]
images()     = parseSectionsFromAST() + grep(/!\[([^\]]*)\]\(([^)]+)\)/g) → Image[]
codeblocks() = parseSectionsFromAST() + grep(/^```(\w*)/gm)                → CodeBlock[]
```

**Key difference:** `grep()` returns raw captures as string arrays. Builtins parse captures into structured objects with typed fields.

**Performance:** AST is parsed once and reused for all builtins. Regex runs within each section for fast pattern matching.

### Return Types

```typescript
import { Position } from 'mdast';

// Links and images are inline elements — capture context
interface Link {
  text: string;           // link text: "our docs"
  url: string;            // link URL: "/docs"
  raw: string;            // full syntax: "[our docs](/docs)"
  position: Position;     // { start: { line, column, offset }, end: { line, column, offset } }
  lineText: string;       // full line: "Check out [our docs](/docs) for more info"
  paragraph?: string;     // full containing paragraph text (selected ancestor)
  section: string[];      // section hierarchy: ["Installation", "Getting Started", "Introduction"]
}

interface Image {
  alt: string;            // alt text: "logo"
  src: string;            // image source: "/img/logo.png"
  raw: string;            // full syntax: "![logo](/img/logo.png)"
  position: Position;     // { start: { line, column, offset }, end: { line, column, offset } }
  lineText: string;       // full line text
  paragraph?: string;     // full containing paragraph text (selected ancestor)
  section: string[];      // section hierarchy: ["Header", "Introduction"]
}

// Code blocks are block elements — clear boundaries
interface CodeBlock {
  lang: string | null;           // "python"
  type: 'python' | 'rust' | 'golang' | 'bash' | 'javascript' | 'typescript' | 'text';
  content: string;               // the code
  raw: string;                   // full block with fences
  position: Position;            // { start: { line, column, offset }, end: { line, column, offset } }
  section: string[];             // section hierarchy: ["Installation", "Getting Started", "Introduction"]
  // No paragraph for code blocks (they're block elements)
}

// Section is unified — heading + content (see Unified Section Builtin above)
interface Section {
  level: number;          // 1-6
  title: string;          // heading text
  line: number;           // heading line number
  endLine: number;        // last line of section
  column: number;         // start column (after #)
  content: string;        // text under this heading until next heading
  hierarchy: string[];    // section hierarchy: ["Introduction", "Setup"]
}

// GrepMatch — generic pattern match
interface GrepMatch {
  text: string;           // matched text
  captures: string[];     // regex capture groups
  position: Position;     // { start: { line, column, offset }, end: { line, column, offset } }
  section: string[];      // section hierarchy
}
```

### Property Accessors

```
-- Links
links()              → Link[]
links('text')        → string[]      ["our docs", "API reference"]
links('url')         → string[]      ["/docs", "/api"]
links('section')     → string[][]    [["Installation", "Getting Started"], ["Setup"]]
links('paragraph')   → string[]      ["Check out our docs..."]
links('line')        → number[]      [5, 12]  (from position.start.line)

-- Images
images()             → Image[]
images('alt')        → string[]      ["logo", "diagram"]
images('src')        → string[]      ["/img/logo.png", "/img/diagram.png"]
images('section')    → string[][]    [["Header"], ["Architecture"]]
images('paragraph')  → string[]      ["Our logo is..."]

-- Code blocks
codeblocks()         → CodeBlock[]
codeblocks('lang')   → string[]      ["python", "rust"]
codeblocks('type')   → string[]      ["python", "rust"]
codeblocks('section')→ string[][]    [["Installation", "Getting Started"], ["Usage"]]

-- Sections (unified)
section()            → Section[]
section('title')     → string[]      ["Introduction", "Setup"]
section('level')     → number[]      [1, 2]
section('content')   → string[]      ["...", "..."]
section('line')      → number[]      [1, 5]
section('endLine')   → number[]      [4, 11]
section('hierarchy') → string[][]    [["Introduction"], ["Introduction", "Setup"], ...]
```

### Syntax

```
-- Full objects (JSON array)
SELECT links
SELECT images
SELECT codeblocks
SELECT section

-- Specific property (typed array)
SELECT links('text') AS link_texts
SELECT links('url') AS link_urls
SELECT links('section') AS link_sections   -- string[][] for hierarchy
SELECT links('paragraph') AS link_paragraphs -- full paragraph text
SELECT images('src') AS image_sources
SELECT images('section') AS image_sections -- string[][] for hierarchy
SELECT images('paragraph') AS image_paragraphs -- full paragraph text
SELECT codeblocks('lang') AS languages
SELECT codeblocks('content') AS code_snippets
SELECT codeblocks('section') AS code_sections -- string[][] for hierarchy
SELECT section('title') AS section_titles
SELECT section('level') AS section_levels
SELECT section('hierarchy') AS section_hierarchies -- string[][] for full path

-- In WHERE
WHERE links('url') CONTAINS '/api'
WHERE codeblocks('lang') = 'python'
WHERE section('level') <= 2

-- Filter by specific section level
WHERE links('section')[0] = 'Installation'  -- first element is most specific
WHERE codeblocks('section').INCLUDES('Usage')  -- check if any level matches

-- Filter by hierarchy
WHERE section('hierarchy').INCLUDES('Setup')  -- any section in Setup path

-- Filter by paragraph content
WHERE links('paragraph') CONTAINS 'TODO'
WHERE images('paragraph') CONTAINS 'diagram'
```

### Implementation (AST-based)

```typescript
import { remark } from 'remark';
import { visit, visitParents } from 'unist-util-visit';
import { Position, LinkNode, ImageNode, CodeNode, ParagraphNode } from 'mdast';

// Content extraction builtins — use AST directly for structured extraction
function links(file: FileData, property?: string): Link[] | any[] {
  if (!file.content) return [];
  
  const tree = remark().parse(file.content.raw);
  const sections = extractSectionsFromAST(file.content.raw);
  const links: Link[] = [];
  
  visitParents(tree, 'link', (node: LinkNode, ancestors) => {
    // Find containing paragraph (selected ancestor)
    const paragraph = ancestors.find((a): a is ParagraphNode => a.type === 'paragraph');
    const paragraphText = paragraph ? extractTextFromNode(paragraph) : undefined;
    
    // Find section hierarchy
    const section = findSectionForLine(sections, node.position.start.line);
    
    links.push({
      text: node.children[0]?.value || '',
      url: node.url,
      raw: file.content.raw.slice(node.position.start.offset, node.position.end.offset),
      position: node.position,
      lineText: file.content.raw.split('\n')[node.position.start.line - 1],
      paragraph: paragraphText,
      section: section?.hierarchy || []
    });
  });
  
  if (!property) return links;
  if (property === 'text') return links.map(l => l.text);
  if (property === 'url') return links.map(l => l.url);
  if (property === 'raw') return links.map(l => l.raw);
  if (property === 'line') return links.map(l => l.position.start.line);
  if (property === 'column') return links.map(l => l.position.start.column);
  if (property === 'offset') return links.map(l => l.position.start.offset);
  if (property === 'lineText') return links.map(l => l.lineText);
  if (property === 'paragraph') return links.map(l => l.paragraph);
  if (property === 'section') return links.map(l => l.section);
  return [];
}

function images(file: FileData, property?: string): Image[] | any[] {
  if (!file.content) return [];
  
  const tree = remark().parse(file.content.raw);
  const sections = extractSectionsFromAST(file.content.raw);
  const images: Image[] = [];
  
  visitParents(tree, 'image', (node: ImageNode, ancestors) => {
    const paragraph = ancestors.find((a): a is ParagraphNode => a.type === 'paragraph');
    const paragraphText = paragraph ? extractTextFromNode(paragraph) : undefined;
    const section = findSectionForLine(sections, node.position.start.line);
    
    images.push({
      alt: node.alt,
      src: node.url,
      raw: file.content.raw.slice(node.position.start.offset, node.position.end.offset),
      position: node.position,
      lineText: file.content.raw.split('\n')[node.position.start.line - 1],
      paragraph: paragraphText,
      section: section?.hierarchy || []
    });
  });
  
  if (!property) return images;
  if (property === 'alt') return images.map(i => i.alt);
  if (property === 'src') return images.map(i => i.src);
  if (property === 'raw') return images.map(i => i.raw);
  if (property === 'line') return images.map(i => i.position.start.line);
  if (property === 'column') return images.map(i => i.position.start.column);
  if (property === 'offset') return images.map(i => i.position.start.offset);
  if (property === 'lineText') return images.map(i => i.lineText);
  if (property === 'paragraph') return images.map(i => i.paragraph);
  if (property === 'section') return images.map(i => i.section);
  return [];
}

function codeblocks(file: FileData, property?: string): CodeBlock[] | any[] {
  if (!file.content) return [];
  
  const tree = remark().parse(file.content.raw);
  const sections = extractSectionsFromAST(file.content.raw);
  const blocks: CodeBlock[] = [];
  
  visit(tree, 'code', (node: CodeNode) => {
    const section = findSectionForLine(sections, node.position.start.line);
    const lang = node.lang || null;
    
    blocks.push({
      lang,
      type: normalizeLang(lang),
      content: node.value,
      raw: file.content.raw.slice(node.position.start.offset, node.position.end.offset),
      position: node.position,
      section: section?.hierarchy || []
    });
  });
  
  if (!property) return blocks;
  if (property === 'lang') return blocks.map(b => b.lang);
  if (property === 'type') return blocks.map(b => b.type);
  if (property === 'content') return blocks.map(b => b.content);
  if (property === 'raw') return blocks.map(b => b.raw);
  if (property === 'line') return blocks.map(b => b.position.start.line);
  if (property === 'endLine') return blocks.map(b => b.position.end.line);
  if (property === 'offset') return blocks.map(b => b.position.start.offset);
  if (property === 'section') return blocks.map(b => b.section);
  return [];
}

// Helper: extract text content from AST node
function extractTextFromNode(node: any): string {
  if (node.value) return node.value;
  if (node.children) {
    return node.children.map((child: any) => extractTextFromNode(child)).join('');
  }
  return '';
}
```

## Existing Builtins — Property Accessor Updates

### `toc()` — Table of Contents (Convenience Wrapper)

```typescript
// No args: "level:title" strings
toc()           → ["1:Introduction", "2:Setup", "2:Usage"]

// With property arg: flat array
toc('title')    → ["Introduction", "Setup", "Usage"]
toc('level')    → [1, 2, 2]
toc('line')     → [1, 5, 12]
toc('content')  → ["...", "...", "..."]
toc('endLine')  → [4, 11, 20]
```

```typescript
function toc(file: FileData, property?: string): string[] | number[] {
  if (!file.content) return [];
  const sections = parseSectionsFromAST(file.content.raw);  // AST-based
  
  if (!property) {
    return sections.map(s => `${s.level}:${s.title}`);
  }
  
  if (property === 'title') return sections.map(s => s.title);
  if (property === 'level') return sections.map(s => s.level);
  if (property === 'content') return sections.map(s => s.content);
  if (property === 'line') return sections.map(s => s.line);
  if (property === 'endLine') return sections.map(s => s.endLine);
  return [];
}
```

### `section()` — Unified Section Builtin

```typescript
// No args: all sections as array
section()           → Section[]

// With property arg: flat array
section('title')    → ["Introduction", "Setup", "Usage"]
section('level')    → [1, 2, 2]
section('content')  → ["...", "...", "..."]
section('line')     → [1, 5, 12]
section('endLine')  → [4, 11, 20]
section('hierarchy') → [["Introduction"], ["Introduction", "Setup"], ["Introduction", "Setup", "Usage"]]
```

```typescript
function section(file: FileData, property?: string): Section[] | any[] {
  if (!file.content) return property ? [] : [];
  const sections = parseSectionsFromAST(file.content.raw);  // AST-based
  
  if (!property) return sections;
  
  if (property === 'title') return sections.map(s => s.title);
  if (property === 'level') return sections.map(s => s.level);
  if (property === 'content') return sections.map(s => s.content);
  if (property === 'line') return sections.map(s => s.line);
  if (property === 'endLine') return sections.map(s => s.endLine);
  if (property === 'column') return sections.map(s => s.column);
  if (property === 'hierarchy') return sections.map(s => s.hierarchy);
  return [];
}

function toc(file: FileData, property?: string): string[] | number[] {
  if (!file.content) return [];
  const sections = parseSectionsFromAST(file.content.raw);  // AST-based
  
  if (!property) {
    return sections.map(s => `${s.level}:${s.title}`);
  }
  
  if (property === 'title') return sections.map(s => s.title);
  if (property === 'level') return sections.map(s => s.level);
  if (property === 'content') return sections.map(s => s.content);
  if (property === 'line') return sections.map(s => s.line);
  if (property === 'endLine') return sections.map(s => s.endLine);
  return [];
}
```

### `fields()` — Frontmatter Fields

```typescript
// No args: field names
fields()            → ["title", "status", "priority"]

// With property arg
fields('names')     → ["title", "status", "priority"]
fields('values')    → ["My Task", "todo", 3]
```

```typescript
function fields(file: FileData, property?: string): string[] | any[] {
  const internalFields = ['filename', 'path', 'abspath', 'filepath', 'content', 'sections'];
  const fieldNames = Object.keys(file).filter(key => !internalFields.includes(key));
  
  if (!property || property === 'names') return fieldNames;
  if (property === 'values') return fieldNames.map(f => (file as any)[f]);
  return [];
}
```

## Type-Specific Behaviors

### Operators

| Operator | Number | String | Date | Array | Map |
|----------|--------|--------|------|-------|-----|
| `+` | add | concatenate | add days | concat | - |
| `-` | subtract | - | subtract days | - | - |
| `*` | multiply | repeat | - | repeat | - |
| `=` | equal | case-insensitive | same day | - | - |
| `contains` | - | substring | - | includes | has value |
| `IN` | - | - | - | membership | key exists |

### Functions

| Function | Number | String | Date | Array | Map |
|----------|--------|--------|------|-------|-----|
| `len()` | toString length | length | - | count | key count |
| `upper()` | toUpperCase | uppercase | - | - | - |
| `first()` | - | first char | - | first element | first value |
| `last()` | - | last char | - | last element | last value |
| `keys()` | - | characters | - | indices | keys array |
| `values()` | - | - | - | elements | values array |
| `content()` | - | full body text | - | - | - |
| `content(N)` | - | first N lines | - | - | - |
| `content(start, end)` | - | lines start–end | - | - | - |
| `content(-N)` | - | last N lines | - | - | - |
| `links()` | - | Link[] | - | - | - |
| `links('text')` | - | string[] | - | - | - |
| `links('url')` | - | string[] | - | - | - |
| `links('section')` | - | (string\|null)[] | - | - | - |
| `images()` | - | Image[] | - | - | - |
| `images('alt')` | - | string[] | - | - | - |
| `images('src')` | - | string[] | - | - | - |
| `images('section')` | - | (string\|null)[] | - | - | - |
| `codeblocks()` | - | CodeBlock[] | - | - | - |
| `codeblocks('lang')` | - | string[] | - | - | - |
| `codeblocks('type')` | - | string[] | - | - | - |
| `codeblocks('content')` | - | string[] | - | - | - |
| `codeblocks('section')` | - | (string\|null)[] | - | - | - |
| `section()` | - | Section[] | - | - | - |
| `section('title')` | - | string[] | - | - | - |
| `section('level')` | - | number[] | - | - | - |
| `section('content')` | - | string[] | - | - | - |
| `section('line')` | - | number[] | - | - | - |
| `section('endLine')` | - | number[] | - | - | - |
| `toc()` | - | "level:title"[] | - | - | - |
| `toc('title')` | - | string[] | - | - | - |
| `toc('level')` | - | number[] | - | - | - |
| `toc('content')` | - | string[] | - | - | - |
| `toc('endLine')` | - | number[] | - | - | - |
| `fields()` | - | string[] | - | - | - |
| `fields('names')` | - | string[] | - | - | - |
| `fields('values')` | - | any[] | - | - | - |

## Dependencies

New packages required for AST-based content extraction:

```bash
bun add remark unist-util-visit unist-util-visit-parents @types/mdast
```

| Package | Purpose | Size |
|---------|---------|------|
| `remark` | Markdown parser (AST) | ~50KB |
| `unist-util-visit` | AST traversal | ~5KB |
| `unist-util-visit-parents` | AST traversal with ancestor access | ~5KB |
| `@types/mdast` | TypeScript types for AST nodes | ~10KB |
| `gray-matter` | Frontmatter parsing (existing) | ~10KB |

**Total new bundle size:** ~80KB

**Performance tradeoff:**
- AST parse: ~1-5ms per file (one-time cost)
- Regex within sections: ~0.1ms per section
- Reuse AST for all builtins (sections, grep, links, images, codeblocks)

**Alternative:** Keep regex-only approach (no new dependencies, faster but less robust)

## AST Node Types (MDAST)

Types from `@types/mdast` for AST-based extraction:

```typescript
import { Node, Position } from 'mdast';

// Base node interface
interface MdastNode extends Node {
  type: string;
  position: Position;  // { start: { line, column, offset }, end: { line, column, offset } }
}

// Link node: [text](url)
interface LinkNode extends MdastNode {
  type: 'link';
  url: string;
  title?: string;
  children: MdastNode[];  // text content
}

// Image node: ![alt](src)
interface ImageNode extends MdastNode {
  type: 'image';
  url: string;
  alt: string;
  title?: string;
}

// Code node: fenced code blocks
interface CodeNode extends MdastNode {
  type: 'code';
  lang?: string;
  value: string;  // code content
}

// Heading node: # Title
interface HeadingNode extends MdastNode {
  type: 'heading';
  depth: number;  // 1-6
  children: MdastNode[];  // text content
}

// Text node
interface TextNode extends MdastNode {
  type: 'text';
  value: string;
}

// Paragraph node (selected ancestor)
interface ParagraphNode extends MdastNode {
  type: 'paragraph';
  children: MdastNode[];
}
```

### Our Types (using raw AST position)

```typescript
import { Position } from 'mdast';

interface Link {
  text: string;
  url: string;
  raw: string;
  position: Position;
  lineText: string;
  paragraph?: string;
  section: string[];
}

interface Image {
  alt: string;
  src: string;
  raw: string;
  position: Position;
  lineText: string;
  paragraph?: string;
  section: string[];
}

interface CodeBlock {
  lang: string | null;
  type: string;
  content: string;
  raw: string;
  position: Position;
  section: string[];
}

interface GrepMatch {
  text: string;
  captures: string[];
  position: Position;
  section: string[];
}
```

### Query AST Node Types

Expression nodes for the query parser:

```typescript
// Base expression node
interface ExpressionNode {
  type: string;
}

// Binary operation: a = b, a AND b, a + b
interface BinaryOpNode extends ExpressionNode {
  type: 'binary_op';
  left: ExpressionNode;
  operator: string;
  right: ExpressionNode;
}

// Unary operation: NOT a, -a
interface UnaryOpNode extends ExpressionNode {
  type: 'unary_op';
  operator: string;
  operand: ExpressionNode;
}

// Function call: len(), links(), content(10)
interface FunctionCallNode extends ExpressionNode {
  type: 'function_call';
  name: string;
  args: ExpressionNode[];
}

// Method call: links().filter(section = 'Setup')
interface MethodCallNode extends ExpressionNode {
  type: 'method_call';
  object: ExpressionNode;
  method: string;
  args: ExpressionNode[];
}

// Array index: toc()[0], links()[-1]
interface ArrayIndexNode extends ExpressionNode {
  type: 'array_index';
  object: ExpressionNode;
  index: ExpressionNode;
}

// Map index: section('content')['Setup']
interface MapIndexNode extends ExpressionNode {
  type: 'map_index';
  object: ExpressionNode;
  key: ExpressionNode;
}

// Field reference: title, status, section
interface FieldNode extends ExpressionNode {
  type: 'field';
  name: string;
}

// Value literal: 'todo', 42, true
interface ValueNode extends ExpressionNode {
  type: 'value';
  value: any;
  dataType: 'string' | 'number' | 'boolean' | 'null';
}

// Parenthesized expression: (a + b)
interface ParenNode extends ExpressionNode {
  type: 'paren';
  expression: ExpressionNode;
}
```

### AST → Our Types Transformation

```typescript
import { remark } from 'remark';
import { visit, visitParents } from 'unist-util-visit';
import { Position, LinkNode, ImageNode, CodeNode, HeadingNode, ParagraphNode } from 'mdast';

// Parse markdown into AST
function parseAST(content: string): MdastNode {
  return remark().parse(content);
}

// Extract links from AST with paragraph context
function extractLinksFromAST(content: string, sections: Section[]): Link[] {
  const tree = parseAST(content);
  const links: Link[] = [];
  
  visitParents(tree, 'link', (node: LinkNode, ancestors) => {
    const section = findSectionForLine(sections, node.position.start.line);
    const paragraph = ancestors.find((a): a is ParagraphNode => a.type === 'paragraph');
    
    links.push({
      text: node.children[0]?.value || '',
      url: node.url,
      raw: content.slice(node.position.start.offset, node.position.end.offset),
      position: node.position,
      lineText: content.split('\n')[node.position.start.line - 1],
      paragraph: paragraph ? extractTextFromNode(paragraph) : undefined,
      section: section?.hierarchy || []
    });
  });
  
  return links;
}

// Extract images from AST with paragraph context
function extractImagesFromAST(content: string, sections: Section[]): Image[] {
  const tree = parseAST(content);
  const images: Image[] = [];
  
  visitParents(tree, 'image', (node: ImageNode, ancestors) => {
    const section = findSectionForLine(sections, node.position.start.line);
    const paragraph = ancestors.find((a): a is ParagraphNode => a.type === 'paragraph');
    
    images.push({
      alt: node.alt,
      src: node.url,
      raw: content.slice(node.position.start.offset, node.position.end.offset),
      position: node.position,
      lineText: content.split('\n')[node.position.start.line - 1],
      paragraph: paragraph ? extractTextFromNode(paragraph) : undefined,
      section: section?.hierarchy || []
    });
  });
  
  return images;
}

// Extract code blocks from AST
function extractCodeblocksFromAST(content: string, sections: Section[]): CodeBlock[] {
  const tree = parseAST(content);
  const blocks: CodeBlock[] = [];
  
  visit(tree, 'code', (node: CodeNode) => {
    const section = findSectionForLine(sections, node.position.start.line);
    const lang = node.lang || null;
    
    blocks.push({
      lang,
      type: normalizeLang(lang),
      content: node.value,
      raw: content.slice(node.position.start.offset, node.position.end.offset),
      position: node.position,
      section: section?.hierarchy || []
    });
  });
  
  return blocks;
}

// Extract sections from AST
function extractSectionsFromAST(content: string): Section[] {
  const tree = parseAST(content);
  const sections: Section[] = [];
  const headings: HeadingNode[] = [];
  
  visit(tree, 'heading', (node: HeadingNode) => {
    headings.push(node);
  });
  
  // Build sections with hierarchy and content
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const nextH = headings[i + 1];
    
    // Build hierarchy
    const hierarchy: string[] = [];
    for (const prev of headings) {
      if (prev.position.start.line > h.position.start.line) break;
      if (prev.depth < h.depth) {
        hierarchy.push(prev.children[0]?.value || '');
      } else if (prev.depth === h.depth) {
        hierarchy.length = 0;
        for (const p of headings) {
          if (p.position.start.line > h.position.start.line) break;
          if (p.depth < h.depth) hierarchy.push(p.children[0]?.value || '');
        }
        break;
      }
    }
    hierarchy.push(h.children[0]?.value || '');
    
    // Content: lines until next heading or EOF
    const startLine = h.position.start.line;
    const endLine = nextH ? nextH.position.start.line - 1 : content.split('\n').length;
    const contentLines = content.split('\n').slice(startLine - 1, endLine).join('\n').trim();
    
    sections.push({
      level: h.depth,
      title: h.children[0]?.value || '',
      line: h.position.start.line,
      endLine: endLine,
      column: h.position.start.column,
      content: contentLines,
      hierarchy: hierarchy
    });
  }
  
  return sections;
}

// Helper: extract text content from AST node
function extractTextFromNode(node: any): string {
  if (node.value) return node.value;
  if (node.children) {
    return node.children.map((child: any) => extractTextFromNode(child)).join('');
  }
  return '';
}

// Helper: find section for a given line number
function findSectionForLine(sections: Section[], line: number): Section | undefined {
  return sections.find(s => s.line <= line && s.endLine >= line);
}

// Helper: normalize language to CodeBlock type
function normalizeLang(lang: string | null): CodeBlock['type'] {
  if (!lang) return 'text';
  const lower = lang.toLowerCase();
  if (lower === 'python' || lower === 'py') return 'python';
  if (lower === 'rust' || lower === 'rs') return 'rust';
  if (lower === 'golang' || lower === 'go') return 'golang';
  if (lower === 'bash' || lower === 'sh' || lower === 'shell') return 'bash';
  if (lower === 'javascript' || lower === 'js') return 'javascript';
  if (lower === 'typescript' || lower === 'ts') return 'typescript';
  return 'text';
}
```

## Array & Map Operations

### Array Indexing

Access elements by index from builtins that return arrays:

```typescript
-- Array indexing
toc()[0]                    → "1:Introduction"      (first element)
toc()[-1]                   → "2:Usage"              (last element, Python-style)
links()[0]                  → Link                   (first link)
links()[-1]                 → Link                   (last link)
codeblocks()[0]             → CodeBlock              (first codeblock)
section()[0]                → Section                (first section)

-- Nested indexing
links()[0].text             → "our docs"             (access property)
codeblocks()[0].content     → "print('hello')"       (access content)
section()[0].hierarchy      → ["Introduction"]        (access hierarchy)
```

**Implementation:**

```typescript
// Array accessor node
interface ArrayIndexNode {
  type: 'array_index';
  object: Expression;      // e.g., toc()
  index: Expression;       // e.g., 0 or -1
}

// Evaluate array index
function evaluateArrayIndex(obj: any[], index: number): any {
  if (index < 0) {
    return obj[obj.length + index];  // Python-style negative indexing
  }
  return obj[index];
}

// Parser: toc()[0]
// Becomes: ArrayIndexNode(object: FunctionCallNode('toc'), index: NumberNode(0))
```

### Map Access

Access map keys from builtins that return maps:

```typescript
-- Map access
section('content')['Setup']         → "..."            (section content)
fields()['title']                   → "My Task"        (field value)
section('hierarchy')['Introduction'] → ["Introduction"] (hierarchy)

-- Nested map access
section('content')['Setup'].length  → 42                (string length)
```

**Implementation:**

```typescript
// Map accessor node
interface MapIndexNode {
  type: 'map_index';
  object: Expression;      // e.g., section('content')
  key: Expression;         // e.g., 'Setup'
}

// Evaluate map access
function evaluateMapIndex(obj: Record<string, any>, key: string): any {
  return obj[key];
}

// Parser: section('content')['Setup']
// Becomes: MapIndexNode(object: FunctionCallNode('section', 'content'), key: StringNode('Setup'))
```

### Chained Methods

Chain methods on arrays for complex queries:

```typescript
-- filter: select elements matching predicate
links().filter(section = 'Setup')           → Link[]
links().filter(url CONTAINS '/api')         → Link[]
codeblocks().filter(lang = 'python')        → CodeBlock[]

-- map: transform elements
links().map('text')                          → string[]  (extract text from each)
links().map('url')                           → string[]  (extract url from each)
section().map('title')                       → string[]  (extract title from each)

-- where: alias for filter
links().where(section = 'Setup')            → Link[]

-- first / last: get single element
links().first()                              → Link      (first link)
links().last()                               → Link      (last link)
codeblocks().first()                         → CodeBlock (first codeblock)

-- sort: order elements
links().sort('line')                         → Link[]    (sort by line number)
section().sort('level')                      → Section[] (sort by heading level)

-- slice: get subset
links().slice(0, 5)                          → Link[]    (first 5 links)
links().slice(-3)                            → Link[]    (last 3 links)

-- flatten: flatten nested arrays
section().map('hierarchy').flatten()         → string[]  (all hierarchy paths flattened)

-- count / length
links().count()                              → number    (total links)
codeblocks().filter(lang = 'python').count() → number    (python codeblocks)
```

**Implementation:**

```typescript
// Method call node
interface MethodCallNode {
  type: 'method_call';
  object: Expression;      // e.g., links()
  method: string;          // e.g., 'filter', 'map', 'sort'
  args: Expression[];      // e.g., [BinaryOpNode('section', '=', 'Setup')]
}

// Built-in array methods
const arrayMethods: Record<string, Function> = {
  filter: (arr: any[], predicate: (item: any) => boolean) => arr.filter(predicate),
  map: (arr: any[], property: string) => arr.map(item => item[property]),
  where: (arr: any[], predicate: (item: any) => boolean) => arr.filter(predicate), // alias
  first: (arr: any[]) => arr[0],
  last: (arr: any[]) => arr[arr.length - 1],
  sort: (arr: any[], key: string) => arr.sort((a, b) => a[key] - b[key]),
  slice: (arr: any[], start: number, end?: number) => arr.slice(start, end),
  flatten: (arr: any[]) => arr.flat(),
  count: (arr: any[]) => arr.length,
};

// Parser: links().filter(section = 'Setup')
// Becomes: MethodCallNode(
//   object: FunctionCallNode('links'),
//   method: 'filter',
//   args: [BinaryOpNode(FieldNode('section'), '=', StringNode('Setup'))]
// )
```

### Complex Chained Queries

Combine multiple methods for powerful queries:

```typescript
-- Get first 5 python codeblocks in Setup section
codeblocks()
  .filter(lang = 'python')
  .filter(section[0] = 'Setup')
  .slice(0, 5)

-- Get all link URLs in Introduction section, sorted by line
links()
  .filter(section[0] = 'Introduction')
  .map('url')
  .sort('line')

-- Count codeblocks per language
codeblocks()
  .map('lang')
  .flatten()
  .count()

-- Get unique sections containing links
links()
  .map('section')
  .flatten()
  .unique()

-- Get links with TODO in paragraph
links()
  .filter(paragraph CONTAINS 'TODO')
  .map('url')
```

**Implementation Notes:**

1. **Lazy evaluation**: Methods are evaluated only when results are needed
2. **Short-circuit**: `first()` stops after first element
3. **Predicate pushdown**: `filter()` can be pushed to query analyzer for optimization
4. **Type safety**: Methods return typed arrays (Link[], string[], etc.)

### Parser Implementation

```typescript
// Parser: handle postfix operations (indexing, method calls)
function parsePostfix(expr: Expression): Expression {
  while (current token is '[' or '.') {
    if (current === '[') {
      advance(); // consume '['
      const index = parseExpression();
      expect(']');
      expr = { type: 'array_index', object: expr, index };
    } else if (current === '.') {
      advance(); // consume '.'
      const method = expect('IDENTIFIER').value;
      expect('(');
      const args = parseArgumentList();
      expect(')');
      expr = { type: 'method_call', object: expr, method, args };
    }
  }
  return expr;
}

// Parser: function calls become postfix base
function parseFunctionCall(): Expression {
  const name = expect('IDENTIFIER').value;
  expect('(');
  const args = parseArgumentList();
  expect(')');
  const node = { type: 'function_call', name, args };
  
  // Check for postfix operations
  return parsePostfix(node);
}

// Parser: array indexing in expressions
function parsePrimary(): Expression {
  if (current === '(') {
    advance();
    const expr = parseExpression();
    expect(')');
    return parsePostfix({ type: 'paren', expression: expr });
  }
  
  if (current === 'IDENTIFIER') {
    // Check if it's a function call
    if (peek() === '(') {
      return parseFunctionCall();
    }
    // Otherwise it's a field reference
    return parsePostfix({ type: 'field', name: advance().value });
  }
  
  if (current === 'NUMBER' || current === 'STRING' || current === 'BOOLEAN') {
    const token = advance();
    return { type: 'value', value: token.value, dataType: token.type };
  }
  
  throw new Error(`Unexpected token: ${current}`);
}
```

### Query Analyzer Integration

```typescript
// Analyze query for optimization opportunities
function analyzeQuery(query: SelectQuery): QueryAnalysis {
  const analysis: QueryAnalysis = {
    needsFrontmatter: true,
    needsBody: false,
    neededFields: new Set(),
    bodyMethods: new Set(),
    filters: [],
    aggregations: [],
    limit: undefined,
  };
  
  // Traverse expression tree
  function traverse(node: ExpressionNode) {
    switch (node.type) {
      case 'function_call':
        if (['links', 'images', 'codeblocks', 'section', 'grep'].includes(node.name)) {
          analysis.needsBody = true;
          analysis.bodyMethods.add(node.name);
        }
        node.args.forEach(traverse);
        break;
      
      case 'method_call':
        traverse(node.object);
        if (node.method === 'filter' || node.method === 'where') {
          analysis.filters.push(node.args[0]);
        }
        if (node.method === 'slice' && node.args.length === 1) {
          analysis.limit = evaluateExpression(node.args[0], {});
        }
        node.args.forEach(traverse);
        break;
      
      case 'binary_op':
        traverse(node.left);
        traverse(node.right);
        break;
      
      case 'field':
        analysis.neededFields.add(node.name);
        break;
    }
  }
  
  // Traverse SELECT fields
  query.fields.forEach(traverse);
  
  // Traverse WHERE clause
  if (query.where) traverse(query.where);
  
  return analysis;
}
```

// Parser additions
function parsePostfix(expr: Expression): Expression {
  // Check for [index] or .method()
  while (current token is '[' or '.') {
    if (current === '[') {
      const index = parseExpression();
      expect(']');
      expr = { type: 'array_index', object: expr, index };
    } else if (current === '.') {
      advance(); // consume '.'
      const method = expect('IDENTIFIER').value;
      expect('(');
      const args = parseArgumentList();
      expect(')');
      expr = { type: 'method_call', object: expr, method, args };
    }
  }
  return expr;
}
```

### Query Analyzer Integration

The query analyzer understands chained methods for optimization:

```typescript
interface QueryAnalyzer {
  needsFrontmatter: boolean;
  needsBody: boolean;
  neededFields: Set<string>;
  bodyMethods: Set<string>;     // links, images, codeblocks, section
  filters: FilterExpression[];  // for predicate pushdown
  aggregations: Aggregation[];
}

// Example: codeblocks().filter(lang = 'python').slice(0, 5)
// Analyzer:
//   needsBody: true (codeblocks)
//   bodyMethods: ['codeblocks']
//   filters: [lang = 'python']  // can pre-filter
//   limit: 5                     // can limit results
```

### Executor Implementation

```typescript
// Execute expression tree
function evaluateExpression(node: ExpressionNode, context: any): any {
  switch (node.type) {
    case 'binary_op':
      return evaluateBinaryOp(node, context);
    case 'unary_op':
      return evaluateUnaryOp(node, context);
    case 'function_call':
      return evaluateFunctionCall(node, context);
    case 'method_call':
      return evaluateMethodCall(node, context);
    case 'array_index':
      return evaluateArrayIndex(node, context);
    case 'map_index':
      return evaluateMapIndex(node, context);
    case 'field':
      return context[node.name];
    case 'value':
      return node.value;
    case 'paren':
      return evaluateExpression(node.expression, context);
    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}

// Execute method calls
function evaluateMethodCall(node: MethodCallNode, context: any): any {
  const obj = evaluateExpression(node.object, context);
  
  if (!Array.isArray(obj)) {
    throw new Error(`Cannot call method '${node.method}' on non-array`);
  }
  
  switch (node.method) {
    case 'filter':
    case 'where':
      return obj.filter(item => {
        const predicate = evaluateExpression(node.args[0], { ...context, item });
        return predicate;
      });
    
    case 'map':
      return obj.map(item => {
        const property = evaluateExpression(node.args[0], context);
        return item[property];
      });
    
    case 'first':
      return obj[0];
    
    case 'last':
      return obj[obj.length - 1];
    
    case 'sort':
      const key = evaluateExpression(node.args[0], context);
      return [...obj].sort((a, b) => a[key] - b[key]);
    
    case 'slice':
      const start = evaluateExpression(node.args[0], context);
      const end = node.args[1] ? evaluateExpression(node.args[1], context) : undefined;
      return obj.slice(start, end);
    
    case 'flatten':
      return obj.flat();
    
    case 'count':
    case 'length':
      return obj.length;
    
    case 'unique':
      return [...new Set(obj)];
    
    default:
      throw new Error(`Unknown method: ${node.method}`);
  }
}

// Execute array index
function evaluateArrayIndex(node: ArrayIndexNode, context: any): any {
  const obj = evaluateExpression(node.object, context);
  const index = evaluateExpression(node.index, context);
  
  if (!Array.isArray(obj)) {
    throw new Error(`Cannot index non-array`);
  }
  
  // Python-style negative indexing
  if (index < 0) {
    return obj[obj.length + index];
  }
  return obj[index];
}

// Execute map index
function evaluateMapIndex(node: MapIndexNode, context: any): any {
  const obj = evaluateExpression(node.object, context);
  const key = evaluateExpression(node.key, context);
  
  if (typeof obj !== 'object' || obj === null) {
    throw new Error(`Cannot index non-map`);
  }
  
  return obj[key];
}
```

## Subqueries & Joins

### Subqueries

Subqueries allow nested SELECT statements for complex filtering:

```typescript
-- IN with subquery
WHERE title IN (SELECT title FROM other_files)

-- NOT IN with subquery
WHERE title NOT IN (SELECT title FROM archived_files)

-- EXISTS with subquery
WHERE EXISTS (SELECT 1 FROM linked_files WHERE link = title)

-- Scalar subquery
WHERE priority = (SELECT MAX(priority) FROM all_files)

-- Subquery in SELECT
SELECT title, (SELECT COUNT(*) FROM linked_files WHERE source = title) as link_count
```

**Implementation:**

```typescript
// Subquery node
interface SubqueryNode extends ExpressionNode {
  type: 'subquery';
  query: SelectQuery;  // nested SELECT statement
}

// Parse subquery
function parseSubquery(): Expression {
  expect('(');
  const query = parseSelect();  // recursive parsing
  expect(')');
  return { type: 'subquery', query };
}

// Evaluate subquery
function evaluateSubquery(node: SubqueryNode, context: any): any {
  const executor = new Executor();
  return executor.execute(node.query, context.files);
}

// IN with subquery
function evaluateInSubquery(left: any, subquery: any[]): boolean {
  return subquery.includes(left);
}

// EXISTS with subquery
function evaluateExists(subquery: any[]): boolean {
  return subquery.length > 0;
}
```

### Joins

Joins combine data from multiple sources:

```typescript
-- Cross join (default)
SELECT a.title, b.content
FROM files a, sections b

-- Explicit cross join
SELECT a.title, b.content
FROM files a CROSS JOIN sections b

-- Left join (keep all from left)
SELECT a.title, b.content
FROM files a LEFT JOIN sections b ON a.id = b.file_id

-- Right join (keep all from right)
SELECT a.title, b.content
FROM files a RIGHT JOIN sections b ON a.id = b.file_id

-- Inner join (only matching)
SELECT a.title, b.content
FROM files a INNER JOIN sections b ON a.id = b.file_id
```

**Implementation:**

```typescript
// Join node
interface JoinNode {
  type: 'join';
  joinType: 'cross' | 'left' | 'right' | 'inner';
  left: FromClause;
  right: FromClause;
  on?: Expression;  // ON condition for non-cross joins
}

// Parse join
function parseJoin(): JoinNode {
  const joinType = parseJoinType();
  const right = parseFromClause();
  
  let on: Expression | undefined;
  if (joinType !== 'cross') {
    expect('ON');
    on = parseExpression();
  }
  
  return { type: 'join', joinType, left: currentFrom, right, on };
}

// Execute join
function executeJoin(join: JoinNode, context: any): any[] {
  const leftResults = executeFrom(join.left, context);
  const rightResults = executeFrom(join.right, context);
  
  switch (join.joinType) {
    case 'cross':
      // Cartesian product
      return leftResults.flatMap(left => 
        rightResults.map(right => ({ ...left, ...right }))
      );
    
    case 'inner':
      // Only matching rows
      return leftResults.flatMap(left =>
        rightResults
          .filter(right => evaluateExpression(join.on, { ...left, ...right }))
          .map(right => ({ ...left, ...right }))
      );
    
    case 'left':
      // All left rows, matching right rows
      return leftResults.flatMap(left => {
        const matches = rightResults.filter(right =>
          evaluateExpression(join.on, { ...left, ...right })
        );
        return matches.length > 0 
          ? matches.map(right => ({ ...left, ...right }))
          : [{ ...left, ...null }];
      });
    
    case 'right':
      // All right rows, matching left rows
      return rightResults.flatMap(right => {
        const matches = leftResults.filter(left =>
          evaluateExpression(join.on, { ...left, ...right })
        );
        return matches.length > 0
          ? matches.map(left => ({ ...left, ...right }))
          : [{ ...null, ...right }];
      });
  }
}
```

### Multi-Source Queries

```typescript
-- Query multiple file types
SELECT title, content
FROM files
WHERE type = 'task'

UNION

SELECT title, description
FROM notes
WHERE type = 'idea'

-- Query with aggregation across sources
SELECT source, COUNT(*) as count
FROM (
  SELECT 'task' as source, title FROM tasks
  UNION ALL
  SELECT 'note' as source, title FROM notes
)
GROUP BY source
```

**Implementation:**

```typescript
// Union node
interface UnionNode {
  type: 'union';
  queries: SelectQuery[];
  all: boolean;  // UNION ALL vs UNION
}

// Parse union
function parseUnion(): Expression {
  const queries = [parseSelect()];
  
  while (current === 'UNION') {
    advance();
    const all = current === 'ALL';
    if (all) advance();
    queries.push(parseSelect());
  }
  
  return { type: 'union', queries, all };
}

// Execute union
function executeUnion(node: UnionNode, context: any): any[] {
  const results = node.queries.map(query => 
    executeSelect(query, context)
  );
  
  if (node.all) {
    return results.flat();
  } else {
    // Remove duplicates
    return [...new Map(results.flat().map(r => [JSON.stringify(r), r])).values()];
  }
}
```

### Query Analyzer for Subqueries

```typescript
interface QueryAnalysis {
  needsFrontmatter: boolean;
  needsBody: boolean;
  neededFields: Set<string>;
  bodyMethods: Set<string>;
  filters: FilterExpression[];
  aggregations: Aggregation[];
  subqueries: SubqueryAnalysis[];  // NEW
  joins: JoinAnalysis[];           // NEW
}

// Analyze subqueries
function analyzeSubquery(node: SubqueryNode, context: any): SubqueryAnalysis {
  const innerAnalysis = analyzeQuery(node.query);
  return {
    type: 'subquery',
    analysis: innerAnalysis,
    correlated: isCorrelated(node.query, context),  // references outer query
  };
}

// Analyze joins
function analyzeJoin(node: JoinNode, context: any): JoinAnalysis {
  const leftAnalysis = analyzeFrom(node.left);
  const rightAnalysis = analyzeFrom(node.right);
  return {
    type: 'join',
    joinType: node.joinType,
    left: leftAnalysis,
    right: rightAnalysis,
    on: node.on,
  };
}

// Check if subquery is correlated (references outer query)
function isCorrelated(query: SelectQuery, outerContext: any): boolean {
  // Check if WHERE clause references outer fields
  const analyzer = new QueryAnalyzer();
  const innerFields = analyzer.extractFields(query.where);
  return innerFields.some(f => outerContext.fields.has(f));
}
```
