// tests/content-extractor.test.ts
import { describe, expect, it } from 'vitest';
import { ContentExtractor } from '../src/content-extractor';

describe('ContentExtractor.extractGrep', () => {
  it('returns no matches when the pattern is absent', () => {
    const extractor = new ContentExtractor('# Title\n\nNo keywords here.\n');
    expect(extractor.extractGrep(/TODO/g)).toEqual([]);
  });

  it('reports 1-indexed line and 0-indexed column from mdast positions', () => {
    const extractor = new ContentExtractor('# Title\n\nHello TODO world.\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(3);
    expect(matches[0].column).toBe(6);
  });

  it('computes line/column across soft-wrapped text nodes', () => {
    const extractor = new ContentExtractor('# Title\n\nFirst line\nTODO second line.\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(4);
    expect(matches[0].column).toBe(0);
  });

  it('splits sentence context on sentence boundaries', () => {
    const extractor = new ContentExtractor(
      'First sentence here. Second sentence with TODO item.\n',
    );
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0].sentence).toBe('Second sentence with TODO item.');
  });

  it('derives paragraph text from the nearest paragraph ancestor', () => {
    const extractor = new ContentExtractor('A paragraph with a TODO item inside.\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0].paragraph).toBe('A paragraph with a TODO item inside.');
  });

  it('derives paragraph through nested ancestors (link text)', () => {
    const extractor = new ContentExtractor('See [TODO link](https://example.com) here.\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0].paragraph).toBe('See TODO link here.');
    expect(matches[0].ancestors).toEqual([
      { type: 'root' },
      { type: 'paragraph' },
      { type: 'link' },
    ]);
  });

  it('preserves section hierarchy per match', () => {
    const extractor = new ContentExtractor('# Installation\n\n## Setup\n\nRun TODO now.\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0].section).toEqual(['Installation', 'Setup']);
  });

  it('reports an empty section for matches outside any heading', () => {
    const extractor = new ContentExtractor('TODO before any heading.\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0].section).toEqual([]);
  });

  it('includes the ancestors chain with heading text', () => {
    const extractor = new ContentExtractor('# TODO: fix\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0].ancestors).toEqual([
      { type: 'root' },
      { type: 'heading', text: 'TODO: fix' },
    ]);
  });

  it('keeps captures from regex groups', () => {
    const extractor = new ContentExtractor('Call foo(123) and foo(456).\n');
    const matches = extractor.extractGrep(/foo\((\d+)\)/g);
    expect(matches).toHaveLength(2);
    expect(matches[0].captures).toEqual(['123']);
    expect(matches[1].captures).toEqual(['456']);
  });

  it('finds multiple matches with correct positions', () => {
    const extractor = new ContentExtractor('TODO one.\nTODO two.\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(2);
    expect(matches[0].line).toBe(1);
    expect(matches[1].line).toBe(2);
  });

  it('works with non-global patterns', () => {
    const extractor = new ContentExtractor('TODO TODO\n');
    const matches = extractor.extractGrep(/TODO/);
    expect(matches).toHaveLength(2);
  });

  it('returns all context fields per match', () => {
    const extractor = new ContentExtractor('# Section\n\nFirst sentence. Second with TODO here.\n');
    const matches = extractor.extractGrep(/TODO/g);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      line: 3,
      column: 28,
      text: 'TODO',
      captures: [],
      section: ['Section'],
      sentence: 'Second with TODO here.',
      paragraph: 'First sentence. Second with TODO here.',
      ancestors: [{ type: 'root' }, { type: 'paragraph' }],
    });
  });
});

describe('ContentExtractor.extractSections content', () => {
  it('does not duplicate section content', () => {
    const extractor = new ContentExtractor(
      '# TODO\n\nLine one.\nLine two.\n\n## Other\n\nOther stuff.\n',
    );
    const sections = extractor.extractSections();
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('TODO');
    expect(sections[0].content).toBe('Line one.\nLine two.');
    expect(sections[1].title).toBe('Other');
    expect(sections[1].content).toBe('Other stuff.');
  });

  it('slices content between heading positions (no duplication)', () => {
    const extractor = new ContentExtractor('## Setup\n\nDo it now.\n\n## Teardown\n\nEnd.\n');
    const sections = extractor.extractSections();
    expect(sections[0].content).toBe('Do it now.');
    expect(sections[1].content).toBe('End.');
  });

  it('returns undefined content for a heading with no body', () => {
    const extractor = new ContentExtractor('# Only\n');
    const sections = extractor.extractSections();
    expect(sections[0].content).toBeUndefined();
  });
});

describe('ContentExtractor mdast section context (headings are siblings, not ancestors)', () => {
  it('assigns the enclosing heading stack to links under headings', () => {
    const extractor = new ContentExtractor(
      '# Docs\n\nSee [guide](https://example.com) for details.\n',
    );
    const links = extractor.extractLinks();
    expect(links).toHaveLength(1);
    expect(links[0].section).toEqual(['Docs']);
    expect(links[0].text).toBe('guide');
    expect(links[0].url).toBe('https://example.com');
  });

  it('assigns nested heading stacks to links in subsections', () => {
    const extractor = new ContentExtractor(
      '# Docs\n\n## API\n\nSee [guide](https://example.com).\n',
    );
    const links = extractor.extractLinks();
    expect(links[0].section).toEqual(['Docs', 'API']);
  });

  it('returns an empty section for links outside any heading', () => {
    const extractor = new ContentExtractor('A [link](https://example.com) before headings.\n');
    const links = extractor.extractLinks();
    expect(links[0].section).toEqual([]);
  });

  it('assigns the enclosing heading stack to images under headings', () => {
    const extractor = new ContentExtractor('# Logo\n\n![logo](logo.png)\n');
    const images = extractor.extractImages();
    expect(images).toHaveLength(1);
    expect(images[0].section).toEqual(['Logo']);
  });

  it('assigns the enclosing heading stack to codeblocks (CHANGES.md 2e)', () => {
    const extractor = new ContentExtractor('# Setup\n\n```python\nprint(1)\n```\n');
    const codeblocks = extractor.extractCodeblocks();
    expect(codeblocks).toHaveLength(1);
    expect(codeblocks[0].section).toEqual(['Setup']);
    expect(codeblocks[0].lang).toBe('python');
    expect(codeblocks[0].content).toBe('print(1)');
  });

  it('sections() hierarchy excludes the heading itself and covers nested headings', () => {
    const extractor = new ContentExtractor('# Top\n\n## Mid\n\n### Deep\n\nbody\n');
    const sections = extractor.extractSections();
    expect(sections).toHaveLength(3);
    expect(sections[0].hierarchy).toEqual([]);
    expect(sections[1].hierarchy).toEqual(['Top']);
    expect(sections[2].hierarchy).toEqual(['Top', 'Mid']);
  });

  it('provides best-effort sentence context for links', () => {
    const extractor = new ContentExtractor(
      'First sentence. See [guide](https://example.com) in the second sentence.\n',
    );
    const links = extractor.extractLinks();
    expect(links[0].sentence).toBe('See guide in the second sentence.');
  });

  it('derives paragraph text through the paragraph ancestor for links', () => {
    const extractor = new ContentExtractor(
      'A paragraph with [a link](https://example.com) inside.\n',
    );
    const links = extractor.extractLinks();
    expect(links[0].paragraph).toBe('A paragraph with a link inside.');
  });
});
