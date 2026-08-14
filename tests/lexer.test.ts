// tests/lexer.test.ts
import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/lexer';

describe('Lexer', () => {
  it('tokenizes SELECT', () => {
    const tokens = new Lexer('select').tokenize();
    expect(tokens[0]).toEqual({ type: 'SELECT', value: 'select', position: 0, line: 1, column: 1, offset: 0 });
  });

  it('tokenizes WHERE', () => {
    const tokens = new Lexer('where').tokenize();
    expect(tokens[0]).toEqual({ type: 'WHERE', value: 'where', position: 0, line: 1, column: 1, offset: 0 });
  });

  it('tokenizes string value', () => {
    const tokens = new Lexer('"done"').tokenize();
    expect(tokens[0]).toEqual({ type: 'STRING', value: 'done', position: 0, line: 1, column: 1, offset: 0 });
  });

  it('tokenizes number value', () => {
    const tokens = new Lexer('42').tokenize();
    expect(tokens[0]).toEqual({ type: 'NUMBER', value: '42', position: 0, line: 1, column: 1, offset: 0 });
  });

  it('tokenizes operators', () => {
    const tokens = new Lexer('= != < > <= >=').tokenize();
    expect(tokens[0].type).toBe('EQUALS');
    expect(tokens[1].type).toBe('NOT_EQUALS');
    expect(tokens[2].type).toBe('LT');
    expect(tokens[3].type).toBe('GT');
    expect(tokens[4].type).toBe('LTE');
    expect(tokens[5].type).toBe('GTE');
  });

  it('tokenizes keywords', () => {
    const tokens = new Lexer('and or not in contains').tokenize();
    expect(tokens[0].type).toBe('AND');
    expect(tokens[1].type).toBe('OR');
    expect(tokens[2].type).toBe('NOT');
    expect(tokens[3].type).toBe('IN');
    expect(tokens[4].type).toBe('CONTAINS');
  });

  it('tokenizes full select query', () => {
    const tokens = new Lexer('select where status = "done" order by priority').tokenize();
    expect(tokens.map(t => t.type)).toEqual([
      'SELECT', 'WHERE', 'IDENTIFIER', 'EQUALS', 'STRING',
      'ORDER', 'BY', 'IDENTIFIER', 'EOF'
    ]);
  });

  it('handles whitespace', () => {
    const tokens = new Lexer('  select   where  ').tokenize();
    expect(tokens.filter(t => t.type !== 'EOF')).toHaveLength(2);
  });

  it('throws on invalid character', () => {
    expect(() => new Lexer('@').tokenize()).toThrow('Unexpected character');
  });
});
