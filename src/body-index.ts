// src/body-index.ts
// Lazy markdown body index. Built on first body-element access, cached for reuse.
// One AST walk collects every element type into typed arrays (see BodyIndex).

import { Code, Heading, Image, Link, Node, Parent, Root, Text } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import {
  BlockquoteElement,
  BodyIndex,
  BreakElement,
  CodeElement,
  DefinitionElement,
  DeleteElement,
  ElementPosition,
  EmphasisElement,
  FootnoteRefElement,
  HeadingElement,
  HtmlElement,
  ImageElement,
  ImageRefElement,
  InlineCodeElement,
  LinkElement,
  LinkRefElement,
  ListElement,
  ListItemElement,
  ParagraphElement,
  StrongElement,
  TableCellElement,
  TableElement,
  TableRowElement,
  TocEntry,
} from './types';

// mdast types not in the core typedefs
interface Table extends Parent {
  align: any;
}
interface TableRow extends Parent {}
interface TableCell extends Parent {}
interface List extends Parent {
  ordered?: boolean;
  spread?: boolean;
}
interface ListItem extends Parent {
  checked?: boolean | null;
  spread?: boolean;
}
interface Blockquote extends Parent {}
interface Paragraph extends Parent {}
interface Html {
  type: 'html';
  value: string;
  position?: any;
}
interface InlineCode {
  type: 'inlineCode';
  value: string;
  position?: any;
}
interface LinkReference {
  type: 'linkReference';
  label?: string;
  identifier?: string;
  referenceType?: string;
}
interface ImageReference {
  type: 'imageReference';
  label?: string;
  identifier?: string;
  referenceType?: string;
}
interface Definition {
  type: 'definition';
  identifier?: string;
  url?: string;
  title?: string;
  position?: any;
}
interface Break {
  type: 'break';
  position?: any;
}
interface FootnoteReference {
  type: 'footnoteReference';
  label?: string;
  identifier?: string;
  position?: any;
}
interface Emphasis extends Parent {}
interface Strong extends Parent {}
interface Delete extends Parent {}

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export class BodyIndexImpl {
  private ast: Root | null = null;
  private index: BodyIndex | null = null;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  /** Parse markdown into an mdast root (cached). GFM plugin enables tables,
   *  task lists, strikethrough, and footnotes. */
  private getAst(): Root {
    if (!this.ast) {
      this.ast = unified().use(remarkParse).use(remarkGfm).parse(this.source) as Root;
    }
    return this.ast;
  }

  /** Build the full index with a single AST walk (cached). */
  get(): BodyIndex {
    if (this.index) return this.index;

    const ast = this.getAst();
    const index: BodyIndex = {
      headings: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
      links: [],
      linkRefs: [],
      images: [],
      imageRefs: [],
      code: [],
      inlineCode: [],
      tables: [],
      tableRows: [],
      tableCells: [],
      lists: [],
      listItems: [],
      blockquotes: [],
      paragraphs: [],
      html: [],
      emphasis: [],
      strong: [],
      del: [],
      breaks: [],
      footnotes: [],
      definitions: [],
      toc: [],
    };

    visit(ast, (node: Node) => {
      switch (node.type) {
        case 'heading': {
          const h = node as Heading;
          const el: HeadingElement = {
            title: this.extractText(h),
            level: h.depth,
            position: h.position,
          };
          index.headings[h.depth] = index.headings[h.depth] || [];
          index.headings[h.depth].push(el);
          index.toc.push({ level: h.depth, title: el.title } as TocEntry);
          return;
        }
        case 'link': {
          const l = node as Link;
          index.links.push({ text: this.extractText(l), url: l.url, position: l.position });
          return;
        }
        case 'linkReference': {
          const r = node as unknown as LinkReference;
          index.linkRefs.push({
            text: this.extractText(node),
            identifier: r.identifier || r.label || '',
            position: node.position,
          });
          return;
        }
        case 'image': {
          const img = node as Image;
          index.images.push({ alt: img.alt || '', url: img.url, position: img.position });
          return;
        }
        case 'imageReference': {
          const r = node as unknown as ImageReference;
          index.imageRefs.push({
            alt: (node as any).alt || '',
            identifier: r.identifier || r.label || '',
            position: node.position,
          });
          return;
        }
        case 'code': {
          const c = node as Code;
          index.code.push({ lang: c.lang || undefined, content: c.value, position: c.position });
          return;
        }
        case 'inlineCode': {
          const c = node as unknown as InlineCode;
          index.inlineCode.push({ content: c.value, position: c.position });
          return;
        }
        case 'table': {
          const t = node as unknown as Table;
          const rows: TableRowElement[] = [];
          const headers: TableCellElement[] = [];
          const children = (t.children || []) as TableRow[];
          children.forEach((row, rowIdx) => {
            const cells: TableCellElement[] = (row.children || []).map((cell: unknown) => ({
              content: this.extractText(cell as Node),
              position: (cell as Node).position,
            }));
            if (rowIdx === 0) {
              headers.push(...cells);
            } else {
              rows.push({ cells, position: row.position });
            }
          });
          index.tables.push({ headers, rows, position: t.position });
          index.tableRows.push(...rows);
          index.tableCells.push(...headers, ...rows.flatMap((r) => r.cells));
          return;
        }
        case 'list': {
          const l = node as unknown as List;
          const items: ListItemElement[] = (l.children || []).map((item) =>
            this.buildListItem(item as ListItem),
          );
          index.lists.push({ ordered: l.ordered === true, items, position: l.position });
          return;
        }
        case 'listItem': {
          index.listItems.push(this.buildListItem(node as unknown as ListItem));
          return;
        }
        case 'blockquote': {
          const b = node as unknown as Blockquote;
          index.blockquotes.push({ content: this.extractText(b), position: b.position });
          return;
        }
        case 'paragraph': {
          const p = node as unknown as Paragraph;
          index.paragraphs.push({ content: this.extractText(p), position: p.position });
          return;
        }
        case 'html': {
          const h = node as unknown as Html;
          index.html.push({ content: h.value, position: h.position });
          return;
        }
        case 'emphasis': {
          const e = node as unknown as Emphasis;
          index.emphasis.push({ content: this.extractText(e), position: e.position });
          return;
        }
        case 'strong': {
          const s = node as unknown as Strong;
          index.strong.push({ content: this.extractText(s), position: s.position });
          return;
        }
        case 'delete': {
          const d = node as unknown as Delete;
          index.del.push({ content: this.extractText(d), position: d.position });
          return;
        }
        case 'break': {
          const b = node as unknown as Break;
          index.breaks.push({ position: b.position });
          return;
        }
        case 'footnoteReference': {
          const f = node as unknown as FootnoteReference;
          index.footnotes.push({ label: f.label || f.identifier || '', position: f.position });
          return;
        }
        case 'definition': {
          const d = node as unknown as Definition;
          index.definitions.push({
            identifier: d.identifier || '',
            url: d.url || '',
            title: d.title,
            position: d.position,
          });
          return;
        }
      }
    });

    // Compute heading content (raw body slice until next same-level heading).
    for (const level of HEADING_LEVELS) {
      for (const el of index.headings[level]) {
        el.content = this.sectionContentFor(el.position);
      }
    }

    this.index = index;
    return index;
  }

  /** Convenience accessors matching the top-level element function names. */
  headingsOf(level: number): HeadingElement[] {
    return this.get().headings[level] || [];
  }
  get linksOf(): LinkElement[] {
    return this.get().links;
  }
  get linkRefsOf(): LinkRefElement[] {
    return this.get().linkRefs;
  }
  get imagesOf(): ImageElement[] {
    return this.get().images;
  }
  get imageRefsOf(): ImageRefElement[] {
    return this.get().imageRefs;
  }
  get codeOf(): CodeElement[] {
    return this.get().code;
  }
  get inlineCodeOf(): InlineCodeElement[] {
    return this.get().inlineCode;
  }
  get tablesOf(): TableElement[] {
    return this.get().tables;
  }
  get tableRowsOf(): TableRowElement[] {
    return this.get().tableRows;
  }
  get tableCellsOf(): TableCellElement[] {
    return this.get().tableCells;
  }
  get listsOf(): ListElement[] {
    return this.get().lists;
  }
  get listItemsOf(): ListItemElement[] {
    return this.get().listItems;
  }
  get blockquotesOf(): BlockquoteElement[] {
    return this.get().blockquotes;
  }
  get paragraphsOf(): ParagraphElement[] {
    return this.get().paragraphs;
  }
  get htmlOf(): HtmlElement[] {
    return this.get().html;
  }
  get emphasisOf(): EmphasisElement[] {
    return this.get().emphasis;
  }
  get strongOf(): StrongElement[] {
    return this.get().strong;
  }
  get delOf(): DeleteElement[] {
    return this.get().del;
  }
  get breaksOf(): BreakElement[] {
    return this.get().breaks;
  }
  get footnotesOf(): FootnoteRefElement[] {
    return this.get().footnotes;
  }
  get definitionsOf(): DefinitionElement[] {
    return this.get().definitions;
  }
  get tocOf(): TocEntry[] {
    return this.get().toc;
  }

  // ---- helpers ----

  private buildListItem(item: ListItem): ListItemElement {
    const el: ListItemElement = {
      content: this.extractText(item),
      checked: item.checked === undefined || item.checked === null ? null : Boolean(item.checked),
      children: [],
      position: item.position,
    };
    // Nested lists live inside item children; find and recurse.
    const nested = (item.children || []).find((c) => c.type === 'list') as List | undefined;
    if (nested && nested.children) {
      el.children = nested.children.map((child) => this.buildListItem(child as ListItem));
    }
    return el;
  }

  private extractText(node: Node): string {
    if ('value' in node) {
      return node.value as string;
    }
    if ('children' in node) {
      return (node as Parent).children.map((child) => this.extractText(child)).join('');
    }
    return '';
  }

  /** Slice raw source between a heading's end and the next same-or-higher-level heading. */
  private sectionContentFor(position?: ElementPosition): string | undefined {
    if (!position?.end?.offset) return undefined;
    const start = position.end.offset;
    const ast = this.getAst();
    let end: number | undefined;

    // Walk AST once to find the first heading whose start offset is past ours.
    visit(ast, (node: Node) => {
      if (node.type !== 'heading') return;
      const startOffset = node.position?.start?.offset;
      if (startOffset !== undefined && startOffset >= start) {
        end = startOffset;
        return false; // stop traversal at first heading after start
      }
    });

    const slice = this.source.slice(start, end);
    return slice.trim() || undefined;
  }
}

// Keep the raw SKIP import referenced (used by callers that want to skip subtrees).
void SKIP;

/** Cache a BodyIndexImpl per file path (used by executor). */
export function createBodyIndex(source: string): BodyIndexImpl {
  return new BodyIndexImpl(source);
}
