// src/table-renderer.ts
// Dependency-free box-drawing table renderer. Replaces cli-table3, which spent
// ~60x the time in debug-logging truncation (Cell.draw → utils.truncate) on
// every line of every cell.

export interface TableBorderChars {
  top: string;
  topMid: string;
  topLeft: string;
  topRight: string;
  bottom: string;
  bottomMid: string;
  bottomLeft: string;
  bottomRight: string;
  left: string;
  right: string;
  middle: string;
  mid: string;
  leftMid: string;
  midMid: string;
  rightMid: string;
}

export interface RenderTableOptions {
  headers: string[];    // styled header text (may contain SGR codes)
  rows: string[][];     // pre-wrapped cell text (may contain \n)
  colWidths: number[];  // content width per column (excludes padding)
  paddingLeft: number;  // 1 normal, 0 compact
  paddingRight: number; // 1
  chars: TableBorderChars;
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

export function displayWidth(text: string): number {
  return text.replace(ANSI_RE, '').length;
}

// Truncate to a display width, appending '…' when the text overflows (matches
// cli-table3's header behavior). Plain length-based: headers are ASCII field
// names, so length == display width.
export function truncateToWidth(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return '…';
  return text.slice(0, width - 1) + '…';
}

// Wrap text to a column width, preserving existing newlines and breaking long
// unbroken words (paths, URLs) so nothing is truncated
export function wrapText(text: string, width: number): string {
  if (width <= 0) return text;
  return text.split('\n').map(line => wrapLine(line, width)).join('\n');
}

function wrapLine(line: string, width: number): string {
  if (line.length <= width) return line;
  const words = line.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      // Hard-break words longer than the column
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    const candidate = current === '' ? word : current + ' ' + word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

// Wrap text to a column width, then cap the result at maxLines lines. If the
// wrapped text overflows, the last visible line is truncated with '…'.
export function capLines(text: string, width: number, maxLines: number): string {
  if (maxLines <= 0) return text;
  const wrapped = wrapText(text, width);
  const lines = wrapped.split('\n');
  if (lines.length <= maxLines) return wrapped;
  const kept = lines.slice(0, maxLines - 1);
  const rest = lines.slice(maxLines - 1).join(' ');
  kept.push(truncateToWidth(rest, width));
  return kept.join('\n');
}

export function renderTable(opts: RenderTableOptions): string {
  const { headers, rows, colWidths, paddingLeft, paddingRight, chars } = opts;
  const n = colWidths.length;
  if (n === 0) return '';

  const lines: string[] = [];

  lines.push(borderLine(chars.topLeft, chars.top, chars.topMid, chars.topRight, colWidths, paddingLeft, paddingRight));
  pushRow(lines, headers, colWidths, paddingLeft, paddingRight, chars);
  pushSeparator(lines, chars, colWidths, paddingLeft, paddingRight);

  rows.forEach((row, ri) => {
    pushRow(lines, row, colWidths, paddingLeft, paddingRight, chars);
    if (ri < rows.length - 1) {
      pushSeparator(lines, chars, colWidths, paddingLeft, paddingRight);
    }
  });

  lines.push(borderLine(chars.bottomLeft, chars.bottom, chars.bottomMid, chars.bottomRight, colWidths, paddingLeft, paddingRight));

  return lines.join('\n');
}

function borderLine(left: string, horiz: string, mid: string, right: string, colWidths: number[], padL: number, padR: number): string {
  const parts: string[] = [left];
  colWidths.forEach((w, i) => {
    parts.push(horiz.repeat(w + padL + padR));
    parts.push(i < colWidths.length - 1 ? mid : right);
  });
  return parts.join('');
}

function pushSeparator(lines: string[], chars: TableBorderChars, colWidths: number[], padL: number, padR: number): void {
  const sep = borderLine(chars.leftMid, chars.mid, chars.midMid, chars.rightMid, colWidths, padL, padR);
  if (sep.length) lines.push(sep);
}

function pushRow(lines: string[], cells: string[], colWidths: number[], padL: number, padR: number, chars: TableBorderChars): void {
  const cellLines = cells.map(cell => cell.split('\n'));
  const height = Math.max(1, ...cellLines.map(cl => cl.length));
  for (let lineNum = 0; lineNum < height; lineNum++) {
    const parts: string[] = [];
    cells.forEach((_, i) => {
      const left = i === 0 ? chars.left : chars.middle;
      const text = cellLines[i][lineNum] ?? '';
      parts.push(left + ' '.repeat(padL) + padRight(text, colWidths[i]) + ' '.repeat(padR));
    });
    parts.push(chars.right);
    lines.push(parts.join(''));
  }
}

function padRight(text: string, width: number): string {
  const len = displayWidth(text);
  return len >= width ? text : text + ' '.repeat(width - len);
}