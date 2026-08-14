// tests/content-extractor.test.ts
import { describe, it, expect } from 'vitest';
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
    const extractor = new ContentExtractor('First sentence here. Second sentence with TODO item.\n');
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
      { type: 'link' }
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
      { type: 'heading', text: 'TODO: fix' }
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
      ancestors: [
        { type: 'root' },
        { type: 'paragraph' }
      ]
    });
  });
});