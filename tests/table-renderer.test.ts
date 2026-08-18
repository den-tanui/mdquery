// tests/table-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { renderTable, truncateToWidth, wrapText, capLines, displayWidth, TableBorderChars } from '../src/table-renderer';

const chars: TableBorderChars = {
  top: '─', topMid: '┬', topLeft: '┌', topRight: '┐',
  bottom: '─', bottomMid: '┴', bottomLeft: '└', bottomRight: '┘',
  left: '│', right: '│', middle: '│',
  mid: '─', leftMid: '├', midMid: '┼', rightMid: '┤',
};

describe('renderTable', () => {
  it('renders a basic table with exact output', () => {
    const output = renderTable({
      headers: ['ID', 'TITLE'],
      rows: [['1', 'Test Task'], ['2', 'Another Task']],
      colWidths: [2, 12],
      paddingLeft: 1,
      paddingRight: 1,
      chars,
    });
    expect(output).toBe([
      '┌────┬──────────────┐',
      '│ ID │ TITLE        │',
      '├────┼──────────────┤',
      '│ 1  │ Test Task    │',
      '├────┼──────────────┤',
      '│ 2  │ Another Task │',
      '└────┴──────────────┘',
    ].join('\n'));
  });

  it('compact mode drops separators and tightens padding', () => {
    const output = renderTable({
      headers: ['ID', 'TITLE'],
      rows: [['1', 'Test Task'], ['2', 'Another Task']],
      colWidths: [2, 12],
      paddingLeft: 0,
      paddingRight: 1,
      chars: { ...chars, mid: '', leftMid: '', midMid: '', rightMid: '' },
    });
    expect(output).toBe([
      '┌───┬─────────────┐',
      '│ID │TITLE        │',
      '│1  │Test Task    │',
      '│2  │Another Task │',
      '└───┴─────────────┘',
    ].join('\n'));
  });

  it('renders a single column without mid borders', () => {
    const output = renderTable({
      headers: ['TITLE'],
      rows: [['Only']],
      colWidths: [5],
      paddingLeft: 1,
      paddingRight: 1,
      chars,
    });
    expect(output).toBe([
      '┌───────┐',
      '│ TITLE │',
      '├───────┤',
      '│ Only  │',
      '└───────┘',
    ].join('\n'));
  });

  it('multi-line cells expand row height', () => {
    const output = renderTable({
      headers: ['ID', 'DESCRIPTION'],
      rows: [['1', 'a very long description that\nkeeps going and going']],
      colWidths: [3, 30],
      paddingLeft: 1,
      paddingRight: 1,
      chars,
    });
    expect(output).toBe([
      '┌─────┬────────────────────────────────┐',
      '│ ID  │ DESCRIPTION                    │',
      '├─────┼────────────────────────────────┤',
      '│ 1   │ a very long description that   │',
      '│     │ keeps going and going          │',
      '└─────┴────────────────────────────────┘',
    ].join('\n'));
  });

  it('pads styled headers with ANSI-aware width', () => {
    const output = renderTable({
      headers: ['\x1b[01;34mID\x1b[0m', '\x1b[01;34mTITLE\x1b[0m'],
      rows: [['1', 'Test Task']],
      colWidths: [2, 12],
      paddingLeft: 1,
      paddingRight: 1,
      chars: { ...chars, top: '\x1b[90m─\x1b[0m', topMid: '\x1b[90m┬\x1b[0m', topLeft: '\x1b[90m┌\x1b[0m', topRight: '\x1b[90m┐\x1b[0m' },
    });
    expect(output).toContain('\x1b[90m');
    expect(output).toContain('│ \x1b[01;34mID\x1b[0m │ \x1b[01;34mTITLE\x1b[0m        │');
  });

  it('pads rows containing wide characters', () => {
    const output = renderTable({
      headers: ['NAME'],
      rows: [['漢字']],
      colWidths: [4],
      paddingLeft: 1,
      paddingRight: 1,
      chars,
    });
    expect(output).toBe([
      '┌──────┐',
      '│ NAME │',
      '├──────┤',
      '│ 漢字 │',
      '└──────┘',
    ].join('\n'));
  });

  it('renders header-only table when rows are empty', () => {
    const output = renderTable({
      headers: ['ID'],
      rows: [],
      colWidths: [2],
      paddingLeft: 1,
      paddingRight: 1,
      chars,
    });
    expect(output).toBe([
      '┌────┐',
      '│ ID │',
      '├────┤',
      '└────┘',
    ].join('\n'));
  });
});

describe('displayWidth', () => {
  it('counts ASCII by length', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('a b c')).toBe(5);
  });

  it('counts wide CJK characters as 2 columns', () => {
    expect(displayWidth('漢')).toBe(2);
    expect(displayWidth('漢字')).toBe(4);
  });

  it('strips ANSI SGR sequences', () => {
    expect(displayWidth('\x1b[01;34mID\x1b[0m')).toBe(2);
  });
});

describe('truncateToWidth', () => {
  it('returns text unchanged when it fits', () => {
    expect(truncateToWidth('ID', 5)).toBe('ID');
  });
  it('truncates with ellipsis when overflowing', () => {
    expect(truncateToWidth('DESCRIPTION', 5)).toBe('DESC…');
  });
  it('handles narrow widths', () => {
    expect(truncateToWidth('DESCRIPTION', 1)).toBe('…');
  });
  it('truncates by display width, keeping wide characters intact', () => {
    expect(truncateToWidth('漢字ABC', 5)).toBe('漢字…');
  });
  it('handles a wide character that overflows the first slot', () => {
    expect(truncateToWidth('漢字ABC', 3)).toBe('漢…');
    expect(truncateToWidth('漢字ABC', 2)).toBe('…');
  });
});

describe('wrapText', () => {
  it('returns text unchanged when it fits', () => {
    expect(wrapText('hello world', 20)).toBe('hello world');
  });

  it('wraps on word boundaries', () => {
    expect(wrapText('hello world foo', 10)).toBe('hello\nworld foo');
  });

  it('wraps wide characters by display width', () => {
    expect(wrapText('漢字漢字漢字', 6)).toBe('漢字漢\n字漢字');
  });

  it('hard-breaks long words by display width', () => {
    expect(wrapText('漢字漢字漢字', 4)).toBe('漢字\n漢字\n漢字');
  });

  it('wraps mixed ASCII/wide content', () => {
    expect(wrapText('ab漢cde', 4)).toBe('ab漢\ncde');
  });
});

describe('capLines', () => {
  it('returns text unchanged when it fits within maxLines', () => {
    expect(capLines('short', 10, 3)).toBe('short');
  });

  it('caps wrapped text at maxLines with ellipsis on the last line', () => {
    const out = capLines('a very long description that keeps going and going', 10, 2);
    expect(out.split('\n')).toHaveLength(2);
    expect(out).toMatch(/…$/);
  });

  it('maxLines 1 returns a single truncated line', () => {
    const out = capLines('a very long description', 10, 1);
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toMatch(/…$/);
  });

  it('caps wide content with a width-aware ellipsis', () => {
    const out = capLines('漢字漢字漢字 x', 4, 1);
    expect(out).toBe('漢…');
  });
});