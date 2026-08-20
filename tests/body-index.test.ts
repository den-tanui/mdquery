// tests/body-index.test.ts
import { describe, expect, it } from 'vitest';
import { BodyIndexImpl } from '../src/body-index';

const MIXED_DOC = `# Title One

Intro paragraph with *emphasis* and **strong** and \`inline code\`.

## Sub One

Text before a [link](https://example.com) and ![image](img.png).

### Sub Sub

\`\`\`js
const x = 1;
\`\`\`

> A blockquote.

- item one
- [ ] task unchecked
- [x] task checked

| H1 | H2 |
|----|----|
| A  | B  |

~~strikethrough~~

Line one  
Line two

Footnote reference[^1].

[^1]: The footnote definition.

[ref link][ref-id]

![ref image][img-ref]

[ref-id]: https://ref.example.com
[img-ref]: https://img.example.com

<div>raw html</div>
`;

describe('BodyIndexImpl', () => {
  it('extracts all element types from a mixed-content document', () => {
    const idx = new BodyIndexImpl(MIXED_DOC).get();

    expect(idx.headings[1]).toHaveLength(1);
    expect(idx.headings[1][0]).toMatchObject({ title: 'Title One', level: 1 });
    expect(idx.headings[2]).toHaveLength(1);
    expect(idx.headings[2][0].title).toBe('Sub One');
    expect(idx.headings[3]).toHaveLength(1);
    expect(idx.headings[3][0].title).toBe('Sub Sub');

    expect(idx.links).toHaveLength(1);
    expect(idx.links[0]).toMatchObject({ text: 'link', url: 'https://example.com' });

    expect(idx.linkRefs).toHaveLength(1);
    expect(idx.linkRefs[0]).toMatchObject({ text: 'ref link', identifier: 'ref-id' });

    expect(idx.images).toHaveLength(1);
    expect(idx.images[0]).toMatchObject({ alt: 'image', url: 'img.png' });

    expect(idx.imageRefs).toHaveLength(1);
    expect(idx.imageRefs[0]).toMatchObject({ alt: 'ref image', identifier: 'img-ref' });

    expect(idx.code).toHaveLength(1);
    expect(idx.code[0]).toMatchObject({ lang: 'js', content: 'const x = 1;' });

    expect(idx.inlineCode).toHaveLength(1);
    expect(idx.inlineCode[0].content).toBe('inline code');

    expect(idx.tables).toHaveLength(1);
    expect(idx.tables[0].headers.map((c) => c.content)).toEqual(['H1', 'H2']);
    expect(idx.tables[0].rows).toHaveLength(1);
    expect(idx.tables[0].rows[0].cells.map((c) => c.content)).toEqual(['A', 'B']);

    expect(idx.tableRows).toHaveLength(1);
    expect(idx.tableCells).toHaveLength(4);

    expect(idx.lists).toHaveLength(1);
    expect(idx.lists[0].items).toHaveLength(3);

    expect(idx.listItems).toHaveLength(3);
    expect(idx.listItems[0]).toMatchObject({ content: 'item one', checked: null });
    expect(idx.listItems[1]).toMatchObject({ content: 'task unchecked', checked: false });
    expect(idx.listItems[2]).toMatchObject({ content: 'task checked', checked: true });

    expect(idx.blockquotes).toHaveLength(1);
    expect(idx.blockquotes[0].content).toBe('A blockquote.');

    expect(idx.paragraphs.length).toBeGreaterThan(0);

    expect(idx.html).toHaveLength(1);
    expect(idx.html[0].content).toBe('<div>raw html</div>');

    expect(idx.emphasis).toHaveLength(1);
    expect(idx.emphasis[0].content).toBe('emphasis');

    expect(idx.strong).toHaveLength(1);
    expect(idx.strong[0].content).toBe('strong');

    expect(idx.del).toHaveLength(1);
    expect(idx.del[0].content).toBe('strikethrough');

    expect(idx.breaks).toHaveLength(1);

    expect(idx.footnotes).toHaveLength(1);
    expect(idx.footnotes[0].label).toBe('1');

    expect(idx.definitions).toHaveLength(2);
    expect(idx.definitions.map((d) => d.identifier)).toEqual(['ref-id', 'img-ref']);
  });

  it('is lazy: constructor does not parse, first get() parses and caches', () => {
    // Constructing with garbage must not throw — parsing happens on get().
    const garbage = new BodyIndexImpl('{{{ not markdown');
    expect(() => garbage.get()).not.toThrow();

    const idx = new BodyIndexImpl('# Hello');
    // get() caches: same object reference on subsequent calls.
    expect(idx.get()).toBe(idx.get());
  });

  it('computes heading content until the next heading', () => {
    const idx = new BodyIndexImpl('# Alpha\nalpha content\n\n# Beta\nbeta content\n').get();
    expect(idx.headings[1]).toHaveLength(2);
    expect(idx.headings[1][0].content).toBe('alpha content');
    expect(idx.headings[1][1].content).toBe('beta content');
  });

  it('returns structured toc entries in document order', () => {
    const idx = new BodyIndexImpl('# A\n## B\n### C\n# D\n').get();
    expect(idx.toc).toEqual([
      { level: 1, title: 'A' },
      { level: 2, title: 'B' },
      { level: 3, title: 'C' },
      { level: 1, title: 'D' },
    ]);
  });

  it('returns empty arrays for an empty document', () => {
    const idx = new BodyIndexImpl('').get();
    expect(idx.headings[1]).toEqual([]);
    expect(idx.links).toEqual([]);
    expect(idx.linkRefs).toEqual([]);
    expect(idx.images).toEqual([]);
    expect(idx.imageRefs).toEqual([]);
    expect(idx.code).toEqual([]);
    expect(idx.inlineCode).toEqual([]);
    expect(idx.tables).toEqual([]);
    expect(idx.tableRows).toEqual([]);
    expect(idx.tableCells).toEqual([]);
    expect(idx.lists).toEqual([]);
    expect(idx.listItems).toEqual([]);
    expect(idx.blockquotes).toEqual([]);
    expect(idx.paragraphs).toEqual([]);
    expect(idx.html).toEqual([]);
    expect(idx.emphasis).toEqual([]);
    expect(idx.strong).toEqual([]);
    expect(idx.del).toEqual([]);
    expect(idx.breaks).toEqual([]);
    expect(idx.footnotes).toEqual([]);
    expect(idx.definitions).toEqual([]);
    expect(idx.toc).toEqual([]);
  });
});