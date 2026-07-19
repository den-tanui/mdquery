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
  starts_with: 'STARTS_WITH',
  ends_with: 'ENDS_WITH',
  any: 'ANY',
  all: 'ALL',
  exists: 'EXISTS',
  is: 'IS',
  empty: 'EMPTY',
  before: 'BEFORE',
  after: 'AFTER',
  deny: 'DENY',
  run: 'RUN',
  true: 'BOOLEAN',
  false: 'BOOLEAN',
};

export class Lexer {
  private input: string;
  private position: number = 0;

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.position < this.input.length) {
      const char = this.input[this.position];

      // Skip whitespace
      if (/\s/.test(char)) {
        this.position++;
        continue;
      }

      // Strings (double or single quotes)
      if (char === '"' || char === "'") {
        tokens.push(this.readString(char));
        continue;
      }

      // Numbers
      if (/[0-9]/.test(char)) {
        tokens.push(this.readNumber());
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(char)) {
        tokens.push(this.readIdentifier());
        continue;
      }

      // Operators and symbols
      const symbolToken = this.readSymbol();
      if (symbolToken) {
        tokens.push(symbolToken);
        continue;
      }

      throw new Error(`Unexpected character '${char}' at position ${this.position}`);
    }

    tokens.push({ type: 'EOF', value: '', position: this.position });
    return tokens;
  }

  private readString(quote: string): Token {
    const start = this.position;
    this.position++; // skip opening quote
    let value = '';

    while (this.position < this.input.length && this.input[this.position] !== quote) {
      value += this.input[this.position];
      this.position++;
    }

    this.position++; // skip closing quote
    return { type: 'STRING', value, position: start };
  }

  private readNumber(): Token {
    const start = this.position;
    let value = '';

    while (this.position < this.input.length && /[0-9]/.test(this.input[this.position])) {
      value += this.input[this.position];
      this.position++;
    }

    return { type: 'NUMBER', value, position: start };
  }

  private readIdentifier(): Token {
    const start = this.position;
    let value = '';

    while (this.position < this.input.length && /[a-zA-Z_0-9]/.test(this.input[this.position])) {
      value += this.input[this.position];
      this.position++;
    }

    const type = KEYWORDS[value.toLowerCase()] || 'IDENTIFIER';
    return { type, value, position: start };
  }

  private readSymbol(): Token | null {
    const start = this.position;
    const char = this.input[this.position];
    const next = this.input[this.position + 1];

    const symbols: Record<string, TokenType> = {
      '=': 'EQUALS',
      '!': 'NOT_EQUALS',
      '<': 'LT',
      '>': 'GT',
      '+': 'PLUS',
      '-': 'MINUS',
      '*': 'STAR',
      '(': 'LPAREN',
      ')': 'RPAREN',
      '[': 'LBRACKET',
      ']': 'RBRACKET',
      ',': 'COMMA',
      '.': 'DOT',
      '|': 'PIPE',
    };

    // Check two-char operators
    if (char === '!' && next === '=') {
      this.position += 2;
      return { type: 'NOT_EQUALS', value: '!=', position: start };
    }
    if (char === '<' && next === '=') {
      this.position += 2;
      return { type: 'LTE', value: '<=', position: start };
    }
    if (char === '>' && next === '=') {
      this.position += 2;
      return { type: 'GTE', value: '>=', position: start };
    }

    // Single char operators
    if (symbols[char]) {
      this.position++;
      return { type: symbols[char], value: char, position: start };
    }

    return null;
  }
}
