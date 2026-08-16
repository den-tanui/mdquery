// tests/table-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { renderTable, truncateToWidth, TableBorderChars } from '../src/table-renderer';

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
});