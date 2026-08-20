// src/lexer.ts
import { Token, TokenType } from './types';

const KEYWORDS: Record<string, TokenType> = {
  select: 'SELECT',
  where: 'WHERE',
  update: 'UPDATE',
  create: 'CREATE',
  delete: 'DELETE',
  set: 'SET',
  order: 'ORDER',
  by: 'BY',
  group: 'GROUP',
  having: 'HAVING',
  limit: 'LIMIT',
  offset: 'OFFSET',
  distinct: 'DISTINCT',
  and: 'AND',
  or: 'OR',
  not: 'NOT',
  in: 'IN',
  contains: 'CONTAINS',
  matches: 'MATCHES',
  starts_with: 'STARTS_WITH',
  ends_with: 'ENDS_WITH',
  any: 'ANY',
  all: 'ALL',
  exists: 'EXISTS',
  is: 'IS',
  empty: 'EMPTY',
  has: 'HAS',
  from: 'FROM',
  before: 'BEFORE',
  after: 'AFTER',
  deny: 'DENY',
  run: 'RUN',
  as: 'AS',
  left: 'LEFT',
  right: 'RIGHT',
  inner: 'INNER',
  cross: 'CROSS',
  join: 'JOIN',
  on: 'ON',
  union: 'UNION',
  true: 'BOOLEAN',
  false: 'BOOLEAN',
};

export class Lexer {
  private input: string;
  private position: number = 0;
  private line: number = 1;
  private column: number = 1;
  private lastTokenType: TokenType | null = null;

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.position < this.input.length) {
      const char = this.input[this.position];

      // Skip whitespace
      if (/\s/.test(char)) {
        this.advance();
        continue;
      }

      // Strings (double or single quotes)
      if (char === '"' || char === "'") {
        const token = this.readString(char);
        tokens.push(token);
        this.lastTokenType = token.type;
        continue;
      }

      // Regex patterns: only when / follows LPAREN or COMMA (e.g., grep(/.../))
      if (char === '/' && (this.lastTokenType === 'LPAREN' || this.lastTokenType === 'COMMA')) {
        const token = this.readRegex();
        tokens.push(token);
        this.lastTokenType = token.type;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(char)) {
        const token = this.readNumber();
        tokens.push(token);
        this.lastTokenType = token.type;
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(char)) {
        const token = this.readIdentifier();
        tokens.push(token);
        this.lastTokenType = token.type;
        continue;
      }

      // Operators and symbols
      const symbolToken = this.readSymbol();
      if (symbolToken) {
        tokens.push(symbolToken);
        this.lastTokenType = symbolToken.type;
        continue;
      }

      throw new Error(
        `Unexpected character '${char}' at position ${this.position}, line ${this.line}, column ${this.column}`,
      );
    }

    tokens.push(this.createToken('EOF', ''));
    return tokens;
  }

  private advance(): void {
    if (this.position < this.input.length) {
      if (this.input[this.position] === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      this.position++;
    }
  }

  private createToken(type: TokenType, value: string): Token {
    return {
      type,
      value,
      position: this.position,
      line: this.line,
      column: this.column,
      offset: this.position,
    };
  }

  private readString(quote: string): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.position;

    this.advance(); // skip opening quote
    let value = '';

    while (this.position < this.input.length && this.input[this.position] !== quote) {
      if (this.input[this.position] === '\\' && this.position + 1 < this.input.length) {
        // Handle escape sequences
        this.advance();
        value += this.input[this.position];
      } else {
        value += this.input[this.position];
      }
      this.advance();
    }

    if (this.position >= this.input.length) {
      throw new Error(`Unterminated string starting at line ${startLine}, column ${startColumn}`);
    }

    this.advance(); // skip closing quote

    return {
      type: 'STRING',
      value,
      position: startOffset,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }

  private readRegex(): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.position;

    this.advance(); // skip opening /
    let value = '/';

    while (this.position < this.input.length && this.input[this.position] !== '/') {
      if (this.input[this.position] === '\\' && this.position + 1 < this.input.length) {
        value += this.input[this.position];
        this.advance();
        value += this.input[this.position];
      } else {
        value += this.input[this.position];
      }
      this.advance();
    }

    if (this.position >= this.input.length) {
      throw new Error(`Unterminated regex starting at line ${startLine}, column ${startColumn}`);
    }

    value += this.input[this.position]; // closing /
    this.advance();

    // Read flags
    while (this.position < this.input.length && /[gimsuy]/.test(this.input[this.position])) {
      value += this.input[this.position];
      this.advance();
    }

    return {
      type: 'REGEX',
      value,
      position: startOffset,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }

  private readNumber(): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.position;
    let value = '';

    while (this.position < this.input.length && /[0-9]/.test(this.input[this.position])) {
      value += this.input[this.position];
      this.advance();
    }

    return {
      type: 'NUMBER',
      value,
      position: startOffset,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }

  private readIdentifier(): Token {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.position;
    let value = '';

    while (this.position < this.input.length && /[a-zA-Z_0-9]/.test(this.input[this.position])) {
      value += this.input[this.position];
      this.advance();
    }

    const type = KEYWORDS[value.toLowerCase()] || 'IDENTIFIER';
    return {
      type,
      value,
      position: startOffset,
      line: startLine,
      column: startColumn,
      offset: startOffset,
    };
  }

  private readSymbol(): Token | null {
    const startLine = this.line;
    const startColumn = this.column;
    const startOffset = this.position;
    const char = this.input[this.position];
    const next = this.position + 1 < this.input.length ? this.input[this.position + 1] : null;

    // Two-char operators
    if (char === '!' && next === '=') {
      this.advance();
      this.advance();
      return {
        type: 'NOT_EQUALS',
        value: '!=',
        position: startOffset,
        line: startLine,
        column: startColumn,
        offset: startOffset,
      };
    }
    if (char === '<' && next === '=') {
      this.advance();
      this.advance();
      return {
        type: 'LTE',
        value: '<=',
        position: startOffset,
        line: startLine,
        column: startColumn,
        offset: startOffset,
      };
    }
    if (char === '>' && next === '=') {
      this.advance();
      this.advance();
      return {
        type: 'GTE',
        value: '>=',
        position: startOffset,
        line: startLine,
        column: startColumn,
        offset: startOffset,
      };
    }

    // Single-char operators and delimiters
    const symbols: Record<string, TokenType> = {
      '=': 'EQUALS',
      '<': 'LT',
      '>': 'GT',
      '+': 'PLUS',
      '-': 'MINUS',
      '*': 'STAR',
      '/': 'SLASH',
      '%': 'PERCENT',
      '^': 'CARET',
      '(': 'LPAREN',
      ')': 'RPAREN',
      '[': 'LBRACKET',
      ']': 'RBRACKET',
      ',': 'COMMA',
      '.': 'DOT',
      '|': 'PIPE',
      ':': 'COLON',
      ';': 'SEMICOLON',
    };

    if (symbols[char]) {
      this.advance();
      return {
        type: symbols[char],
        value: char,
        position: startOffset,
        line: startLine,
        column: startColumn,
        offset: startOffset,
      };
    }

    return null;
  }
}
