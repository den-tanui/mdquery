// src/content-extractor.ts

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit, SKIP } from 'unist-util-visit';
import { visitParents } from 'unist-util-visit-parents';
import { Node, Parent, Link, Image, Code, Heading, Text } from 'mdast';
import { Root } from 'mdast';

interface LinkData {
  text: string;
  url: string;
  position?: any;
  paragraph?: string;
  section?: string[];
}

interface ImageData {
  alt: string;
  url: string;
  position?: any;
  paragraph?: string;
  section?: string[];
}

interface CodeBlockData {
  lang?: string;
  content: string;
  position?: any;
  paragraph?: string;
  section?: string[];
}

interface SectionData {
  title: string;
  level: number;
  position?: any;
  hierarchy: string[];
  content?: string;
}

interface TocEntry {
  level: number;
  title: string;
  position?: any;
}

interface GrepMatch {
  line: number;
  column: number;
  text: string;
  captures: string[];
  section: string[];
  sentence?: string;
  paragraph?: string;
  ancestors?: { type: string; text?: string }[];
}

export class ContentExtractor {
  private ast: Root;

  constructor(private content: string) {
    this.ast = this.parse();
  }

  // Parse markdown into AST
  parse(): Root {
    return unified()
      .use(remarkParse)
      .parse(this.content) as Root;
  }

  // Extract all links with context
  extractLinks(): LinkData[] {
    const links: LinkData[] = [];
    
    visit(this.ast, 'link', (node: Link) => {
      const paragraph = this.findParent(node, 'paragraph');
      const section = this.extractSectionHierarchy(node);
      
      links.push({
        text: this.extractText(node),
        url: node.url,
        position: node.position,
        paragraph: paragraph ? this.extractText(paragraph) : undefined,
        section: section
      });
    });
    
    return links;
  }

  // Extract all images with context
  extractImages(): ImageData[] {
    const images: ImageData[] = [];
    
    visit(this.ast, 'image', (node: Image) => {
      const paragraph = this.findParent(node, 'paragraph');
      const section = this.extractSectionHierarchy(node);
      
      images.push({
        alt: node.alt || '',
        url: node.url,
        position: node.position,
        paragraph: paragraph ? this.extractText(paragraph) : undefined,
        section: section
      });
    });
    
    return images;
  }

  // Extract all codeblocks with context
  extractCodeblocks(): CodeBlockData[] {
    const codeblocks: CodeBlockData[] = [];
    
    visit(this.ast, 'code', (node: Code) => {
      const paragraph = this.findParent(node, 'paragraph');
      const section = this.extractSectionHierarchy(node);
      
      codeblocks.push({
        lang: node.lang || undefined,
        content: node.value,
        position: node.position,
        paragraph: paragraph ? this.extractText(paragraph) : undefined,
        section: section
      });
    });
    
    return codeblocks;
  }

  // Extract section hierarchy
  extractSections(): SectionData[] {
    const sections: SectionData[] = [];
    
    visit(this.ast, 'heading', (node: Heading) => {
      const hierarchy = this.extractSectionHierarchy(node);
      const content = this.extractSectionContent(node);
      
      sections.push({
        title: this.extractText(node),
        level: node.depth,
        position: node.position,
        hierarchy: hierarchy,
        content: content
      });
    });
    
    return sections;
  }

  // Extract table of contents
  extractToc(): TocEntry[] {
    const toc: TocEntry[] = [];
    
    visit(this.ast, 'heading', (node: Heading) => {
      toc.push({
        level: node.depth,
        title: this.extractText(node),
        position: node.position
      });
    });
    
    return toc;
  }

  // Extract grep matches
  extractGrep(pattern: RegExp): GrepMatch[] {
    const matches: GrepMatch[] = [];
    const regex = this.ensureGlobal(pattern);

    // mdast headings are siblings of their content, not ancestors, so section
    // context cannot come from parent-walking. Maintain a positional heading
    // stack during the pre-order traversal instead: push headings, pop when a
    // heading of equal-or-lesser depth appears, and the stack at a text node is
    // that text's section hierarchy.
    const headingStack: Heading[] = [];

    // Walk text nodes (not lines) so matches keep document structure: sentence,
    // paragraph, section hierarchy, and the full ancestor chain come from mdast.
    visitParents(this.ast, (node, ancestors) => {
      if (node.type === 'heading') {
        const heading = node as Heading;
        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1].depth >= heading.depth
        ) {
          headingStack.pop();
        }
        headingStack.push(heading);
        return;
      }

      if (node.type !== 'text') return;

      const textNode = node as Text;
      const value = textNode.value;
      if (!value) return;

      for (const match of value.matchAll(regex)) {
        const matchIndex = match.index;
        const { line, column } = this.positionAt(textNode, matchIndex);
        const paragraphNode = [...ancestors].reverse().find(a => a.type === 'paragraph');

        matches.push({
          line,
          column,
          text: match[0],
          captures: Array.from(match).slice(1),
          section: headingStack.map(h => this.extractText(h)),
          sentence: this.sentenceAt(value, matchIndex),
          paragraph: paragraphNode ? this.extractText(paragraphNode) : undefined,
          ancestors: ancestors.map(a => {
            const entry: { type: string; text?: string } = { type: a.type };
            if (a.type === 'heading') entry.text = this.extractText(a);
            return entry;
          })
        });
      }
    });

    return matches;
  }

  // Helper methods

  // Return a copy of the pattern with the global flag so matchAll advances across the value.
  private ensureGlobal(pattern: RegExp): RegExp {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
    return new RegExp(pattern.source, flags);
  }

  // Compute 1-indexed line / 0-indexed column for a character offset within a text node.
  private positionAt(node: Text, matchIndex: number): { line: number; column: number } {
    const start = node.position?.start;
    if (!start) return { line: 1, column: 0 };

    const prefix = node.value.slice(0, matchIndex);
    const newlines = (prefix.match(/\n/g) || []).length;
    const lastNewline = prefix.lastIndexOf('\n');
    const columnOffset = lastNewline === -1 ? prefix.length : prefix.length - lastNewline - 1;

    return {
      line: start.line + newlines,
      column: start.column - 1 + columnOffset
    };
  }

  // Split a text value into sentences (with their start offsets) on sentence-ending
  // punctuation followed by whitespace. Simple by design — "e.g." splits like any period.
  private splitSentences(value: string): { text: string; start: number }[] {
    const sentences: { text: string; start: number }[] = [];
    const boundary = /[.!?]\s+/g;
    let start = 0;
    let match: RegExpExecArray | null;

    while ((match = boundary.exec(value)) !== null) {
      sentences.push({ text: value.slice(start, match.index + match[0].length), start });
      start = match.index + match[0].length;
    }
    sentences.push({ text: value.slice(start), start });

    return sentences;
  }

  // Return the sentence containing the given character index, trimmed.
  private sentenceAt(value: string, index: number): string | undefined {
    const containing = this.splitSentences(value).find(
      s => index >= s.start && index < s.start + s.text.length
    );
    return containing ? containing.text.trim() : undefined;
  }

  private extractText(node: Node): string {
    if ('value' in node) {
      return node.value as string;
    }
    if ('children' in node) {
      return node.children.map(child => this.extractText(child)).join('');
    }
    return '';
  }

  private findParent(node: Node, type: string): Node | undefined {
    let parent: Node | undefined;
    
    visitParents(this.ast, (n, ancestors) => {
      if (n === node && ancestors.length > 0) {
        parent = ancestors[ancestors.length - 1];
        return SKIP;
      }
    });
    
    if (parent && 'type' in parent && parent.type === type) {
      return parent;
    }
    return undefined;
  }

  private extractSectionHierarchy(node: Node): string[] {
    const hierarchy: string[] = [];
    let current = node;
    
    while (current) {
      const parent = this.findParent(current, 'heading');
      if (parent) {
        hierarchy.unshift(this.extractText(parent));
        current = parent;
      } else {
        break;
      }
    }
    
    return hierarchy;
  }

  private extractSectionContent(heading: Heading): string | undefined {
    const start = heading.position?.end?.offset;
    if (start === undefined) return undefined;

    // Find the next heading in document order; its start is the end of this
    // section's content. Slicing the raw body between positions avoids the
    // visitor double-count (parent extractText + child text nodes) and keeps
    // ContentExtractor consistent with the regex-based parseSections fast path.
    let end: number | undefined;
    let foundHeading = false;
    visit(this.ast, (node) => {
      if (node === heading) {
        foundHeading = true;
        return SKIP;
      }
      if (foundHeading && node.type === 'heading') {
        end = (node as Heading).position?.start?.offset;
        return false; // stop traversal
      }
    });

    const slice = this.content.slice(start, end);
    return slice.trim() || undefined;
  }
}