// tests/body-syntax-integration.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Executor } from '../src/executor';

let dir: string;

const DOC = `---
title: Body Doc
status: done
---
# Setup

Install bun.

## Config

Set the path.

\`\`\`js
const x = 1;
\`\`\`

\`\`\`ts
const y: number = 2;
\`\`\`

[link text](https://example.com)

![alt text](img.png)

> Important: read this.

- [ ] write tests
- [x] fix bugs

| Col A | Col B |
|-------|-------|
| 1     | 2     |
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mdquery-body-'));
  writeFileSync(join(dir, 'doc.md'), DOC);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('body-syntax element functions', () => {
  it('select h1 returns heading objects with title, level, content, position', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select h1');
    const headings = result.data![0]['h1()'];
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ title: 'Setup', level: 1, content: 'Install bun.' });
    expect(headings[0].position).toBeDefined();
  });

  it('select h1[0].title returns the first h1 title string', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select h1[0].title');
    expect(result.data![0]['h1()[0].title']).toBe('Setup');
  });

  it('select code returns all code blocks', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select code');
    expect(result.data![0]['code()']).toHaveLength(2);
  });

  it('select code[0].lang returns the language of the first code block', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select code[0].lang');
    expect(result.data![0]['code()[0].lang']).toBe('js');
  });

  it("select link.map('url') returns array of URL strings", async () => {
    const executor = new Executor(dir);
    const result = await executor.execute("select link.map('url')");
    expect(result.data![0]['link().map("url")']).toEqual(['https://example.com']);
  });

  it("select table[0].headers.map('content') returns header text array", async () => {
    const executor = new Executor(dir);
    const result = await executor.execute("select table[0].headers.map('content')");
    expect(result.data![0]['table()[0].headers.map("content")']).toEqual(['Col A', 'Col B']);
  });

  it('select listItem.filter(checked = false) returns unchecked task items', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select listItem.filter(checked = false)');
    const items = result.data![0]['listItem().filter(checked_=_false)'];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ content: 'write tests', checked: false });
  });

  it('select body.h1[0].title works via the body namespace property chain', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select body.h1[0].title');
    expect(result.data![0]['body.h1[0].title']).toBe('Setup');
  });
});

describe('body-syntax shorthand filters', () => {
  it("h1('Setup') filters by exact title", async () => {
    const executor = new Executor(dir);
    const result = await executor.execute("select h1('Setup')");
    expect(result.data![0]['h1("Setup")']).toHaveLength(1);
  });

  it("h1('Nope') filters to empty", async () => {
    const executor = new Executor(dir);
    const result = await executor.execute("select h1('Nope')");
    expect(result.data![0]['h1("Nope")']).toHaveLength(0);
  });

  it("code('js') filters by language", async () => {
    const executor = new Executor(dir);
    const result = await executor.execute("select code('js')");
    const blocks = result.data![0]['code("js")'];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('js');
  });

  it("link('https*') filters by url prefix", async () => {
    const executor = new Executor(dir);
    const result = await executor.execute("select link('https*')");
    expect(result.data![0]['link("https*")']).toHaveLength(1);
  });

  it("blockquote('*Important*') filters by content contains", async () => {
    const executor = new Executor(dir);
    const result = await executor.execute("select blockquote('*Important*')");
    expect(result.data![0]['blockquote("*Important*")']).toHaveLength(1);
  });
});

describe('body-syntax matches operator', () => {
  it('matches works in .filter()', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select h1.filter(title matches "Set.*")');
    expect(result.data![0]['h1().filter(title_MATCHES_"Set.*")']).toHaveLength(1);
  });

  it('matches works in WHERE with alternation', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute(
      'select title where h1.filter(title matches "Setup|Config").count() > 0',
    );
    expect(result.data![0].title).toBe('Body Doc');
  });
});

describe('body-syntax paren-free convention', () => {
  it('select h1 works without parentheses', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select h1');
    expect(result.data![0]['h1()']).toHaveLength(1);
  });

  it('paren-free with chaining: select h1.filter(title contains "Setup")', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select h1.filter(title contains "Setup")');
    expect(result.data![0]['h1().filter(title_CONTAINS_"Setup")']).toHaveLength(1);
  });

  it('paren-free works in WHERE: where h1.count() > 0', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select title where h1.count() > 0');
    expect(result.data![0].title).toBe('Body Doc');
  });
});

describe('body-syntax scalar enforcement', () => {
  it('select h1 with table format throws with a shape-aware suggestion', async () => {
    const executor = new Executor(dir, undefined, undefined, { format: 'table' });
    await expect(executor.execute('select h1')).rejects.toThrow(/h1\(\)/);
    await expect(executor.execute('select h1')).rejects.toThrow(/array of maps/);
    await expect(executor.execute('select h1')).rejects.toThrow(/h1\.map\('title'\)/);
  });

  it('select h1[0].title is scalar and allowed in table format', async () => {
    const executor = new Executor(dir, undefined, undefined, { format: 'table' });
    const result = await executor.execute('select h1[0].title');
    expect(result.data![0]['h1()[0].title']).toBe('Setup');
  });
});

describe('body-syntax backward compatibility', () => {
  it('links(), images(), codeblocks(), sections() still work', async () => {
    const executor = new Executor(dir);
    const links = await executor.execute('select links()');
    expect(links.data![0]['links()']).toHaveLength(1);
    const images = await executor.execute('select images()');
    expect(images.data![0]['images()']).toHaveLength(1);
    const codeblocks = await executor.execute('select codeblocks()');
    expect(codeblocks.data![0]['codeblocks()']).toHaveLength(2);
    const sections = await executor.execute('select sections()');
    expect(sections.data![0]['sections()']).toHaveLength(2);
  });

  it('toc() returns structured [{level, title}] objects', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select toc()');
    expect(result.data![0]['toc()']).toEqual([
      { level: 1, title: 'Setup' },
      { level: 2, title: 'Config' },
    ]);
  });

  it('outline() returns a box-drawing formatted string', async () => {
    const executor = new Executor(dir);
    const result = await executor.execute('select outline()');
    expect(result.data![0]['outline()']).toContain('Setup');
    expect(result.data![0]['outline()']).toContain('Config');
  });
});