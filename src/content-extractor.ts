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
    
    // Extract sections first for context
    const sections = this.extractSections();
    
    // Search within each section
    for (const section of sections) {
      if (!section.content) continue;
      
      const lines = section.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = section.position?.start.line + i;
        
        let match;
        while ((match = pattern.exec(line)) !== null) {
          matches.push({
            line: lineNumber,
            column: match.index,
            text: match[0],
            captures: Array.from(match).slice(1),
            section: section.hierarchy
          });
        }
      }
    }
    
    return matches;
  }

  // Helper methods
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
    let content = '';
    let foundHeading = false;
    
    visit(this.ast, (node) => {
      if (node === heading) {
        foundHeading = true;
        return SKIP;
      }
      
      if (foundHeading && node.type === 'heading' && (node as Heading).depth <= heading.depth) {
        return false; // Stop at next heading of same or higher level
      }
      
      if (foundHeading && node.type !== 'heading') {
        if ('value' in node) {
          content += node.value + '\n';
        } else if ('children' in node) {
          content += this.extractText(node) + '\n';
        }
      }
    });
    
    return content.trim() || undefined;
  }
}