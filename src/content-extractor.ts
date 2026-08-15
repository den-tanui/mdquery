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
  sentence?: string;
  section?: string[];
}

interface ImageData {
  alt: string;
  url: string;
  position?: any;
  paragraph?: string;
  sentence?: string;
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
    
    this.walkWithSections((node, ancestors, section) => {
      if (node.type !== 'link') return;
      const link = node as Link;
      const paragraph = [...ancestors].reverse().find(a => a.type === 'paragraph') as Parent | undefined;
      
      links.push({
        text: this.extractText(link),
        url: link.url,
        position: link.position,
        paragraph: paragraph ? this.extractText(paragraph) : undefined,
        sentence: paragraph ? this.sentenceInParagraph(paragraph, link) : undefined,
        section: section
      });
    });
    
    return links;
  }

  // Extract all images with context
  extractImages(): ImageData[] {
    const images: ImageData[] = [];
    
    this.walkWithSections((node, ancestors, section) => {
      if (node.type !== 'image') return;
      const image = node as Image;
      const paragraph = [...ancestors].reverse().find(a => a.type === 'paragraph') as Parent | undefined;
      
      images.push({
        alt: image.alt || '',
        url: image.url,
        position: image.position,
        paragraph: paragraph ? this.extractText(paragraph) : undefined,
        sentence: paragraph ? this.sentenceInParagraph(paragraph, image) : undefined,
        section: section
      });
    });
    
    return images;
  }

  // Extract all codeblocks with context
  extractCodeblocks(): CodeBlockData[] {
    const codeblocks: CodeBlockData[] = [];
    
    this.walkWithSections((node, ancestors, section) => {
      if (node.type !== 'code') return;
      const code = node as Code;
      const paragraph = [...ancestors].reverse().find(a => a.type === 'paragraph') as Parent | undefined;
      
      codeblocks.push({
        lang: code.lang || undefined,
        content: code.value,
        position: code.position,
        paragraph: paragraph ? this.extractText(paragraph) : undefined,
        section: section
      });
    });
    
    return codeblocks;
  }

  // Extract section hierarchy
  extractSections(): SectionData[] {
    const sections: SectionData[] = [];
    
    this.walkWithSections((node, _ancestors, section) => {
      if (node.type !== 'heading') return;
      const heading = node as Heading;
      
      sections.push({
        title: this.extractText(heading),
        level: heading.depth,
        position: heading.position,
        hierarchy: section,
        content: this.extractSectionContent(heading)
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

    this.walkWithSections((node, ancestors, section) => {
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
          section: section,
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

  // Pre-order traversal maintaining a positional heading stack. mdast headings
  // are siblings of their content (not ancestors), so section context cannot
  // come from parent-walking. The stack tracks the enclosing headings: pop when
  // a heading of equal-or-lesser depth appears, push after visiting (so a
  // heading's own hierarchy excludes its own title, matching extractSections).
  private walkWithSections(
    visitor: (node: Node, ancestors: Node[], section: string[]) => void
  ): void {
    const headingStack: Heading[] = [];

    visitParents(this.ast, (node, ancestors) => {
      if (node.type === 'heading') {
        const heading = node as Heading;
        visitor(heading, ancestors, headingStack.map(h => this.extractText(h)));
        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1].depth >= heading.depth
        ) {
          headingStack.pop();
        }
        headingStack.push(heading);
        return;
      }
      visitor(node, ancestors, headingStack.map(h => this.extractText(h)));
    });
  }

  // Best-effort sentence context for inline nodes (links/images): map the
  // target's document offset into the paragraph's extracted text and split on
  // sentence boundaries. Markdown syntax chars may drift offsets slightly.
  private sentenceInParagraph(paragraph: Parent, target: Node): string | undefined {
    const text = this.extractText(paragraph);
    const paraStart = paragraph.position?.start?.offset ?? 0;
    const targetStart = target.position?.start?.offset;
    if (targetStart === undefined) return undefined;
    const index = Math.max(0, Math.min(targetStart - paraStart, text.length - 1));
    return this.sentenceAt(text, index);
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