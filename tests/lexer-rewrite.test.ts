// tests/lexer-rewrite.test.ts
import { describe, expect, it } from 'vitest';
import { Lexer } from '../src/lexer';

describe('Lexer Rewrite - TDD', () => {
  // Helper to get tokens without EOF
  const tokenize = (input: string) => {
    const tokens = new Lexer(input).tokenize();
    return tokens.filter((t) => t.type !== 'EOF');
  };

  // Helper to verify token is valid JSON object
  const isValidToken = (token: any) => {
    expect(token).toBeDefined();
    expect(typeof token).toBe('object');
    expect(token).not.toBeNull();
    expect(token).not.toEqual({});
    expect(typeof token.type).toBe('string');
    expect(typeof token.value).toBe('string');
    expect(typeof token.position).toBe('number');
    expect(typeof token.line).toBe('number');
    expect(typeof token.column).toBe('number');
    expect(typeof token.offset).toBe('number');
  };

  describe('Basic Tokenization', () => {
    it('tokenizes SELECT statement', () => {
      const tokens = tokenize('select');
      expect(tokens).toHaveLength(1);
      isValidToken(tokens[0]);
      expect(tokens[0]).toEqual({
        type: 'SELECT',
        value: 'select',
        position: 0,
        line: 1,
        column: 1,
        offset: 0,
      });
    });

    it('tokenizes WHERE clause', () => {
      const tokens = tokenize('where');
      expect(tokens).toHaveLength(1);
      isValidToken(tokens[0]);
      expect(tokens[0].type).toBe('WHERE');
    });

    it('tokenizes UPDATE statement', () => {
      const tokens = tokenize('update');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('UPDATE');
    });

    it('tokenizes CREATE statement', () => {
      const tokens = tokenize('create');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('CREATE');
    });

    it('tokenizes DELETE statement', () => {
      const tokens = tokenize('delete');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('DELETE');
    });
  });

  describe('String Literals', () => {
    it('tokenizes double-quoted string', () => {
      const tokens = tokenize('"hello world"');
      expect(tokens).toHaveLength(1);
      isValidToken(tokens[0]);
      expect(tokens[0]).toEqual({
        type: 'STRING',
        value: 'hello world',
        position: 0,
        line: 1,
        column: 1,
        offset: 0,
      });
    });

    it('tokenizes single-quoted string', () => {
      const tokens = tokenize("'hello world'");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('STRING');
      expect(tokens[0].value).toBe('hello world');
    });

    it('handles escaped quotes in string', () => {
      const tokens = tokenize('"hello \\"world\\""');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].value).toBe('hello "world"');
    });

    it('handles empty string', () => {
      const tokens = tokenize('""');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('STRING');
      expect(tokens[0].value).toBe('');
    });
  });

  describe('Number Literals', () => {
    it('tokenizes integer', () => {
      const tokens = tokenize('42');
      expect(tokens).toHaveLength(1);
      isValidToken(tokens[0]);
      expect(tokens[0]).toEqual({
        type: 'NUMBER',
        value: '42',
        position: 0,
        line: 1,
        column: 1,
        offset: 0,
      });
    });

    it('tokenizes negative number', () => {
      const tokens = tokenize('-5');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].type).toBe('MINUS');
      expect(tokens[1].type).toBe('NUMBER');
      expect(tokens[1].value).toBe('5');
    });

    it('tokenizes zero', () => {
      const tokens = tokenize('0');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('NUMBER');
      expect(tokens[0].value).toBe('0');
    });
  });

  describe('Boolean Literals', () => {
    it('tokenizes true', () => {
      const tokens = tokenize('true');
      expect(tokens).toHaveLength(1);
      isValidToken(tokens[0]);
      expect(tokens[0].type).toBe('BOOLEAN');
      expect(tokens[0].value).toBe('true');
    });

    it('tokenizes false', () => {
      const tokens = tokenize('false');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('BOOLEAN');
      expect(tokens[0].value).toBe('false');
    });
  });

  describe('Operators', () => {
    it('tokenizes comparison operators', () => {
      const tokens = tokenize('= != < > <= >=');
      expect(tokens).toHaveLength(6);
      expect(tokens.map((t) => t.type)).toEqual(['EQUALS', 'NOT_EQUALS', 'LT', 'GT', 'LTE', 'GTE']);
      tokens.forEach(isValidToken);
    });

    it('tokenizes arithmetic operators', () => {
      const tokens = tokenize('+ - * / %');
      expect(tokens).toHaveLength(5);
      expect(tokens.map((t) => t.type)).toEqual(['PLUS', 'MINUS', 'STAR', 'SLASH', 'PERCENT']);
    });

    it('tokenizes caret for exponentiation', () => {
      const tokens = tokenize('^');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('CARET');
    });
  });

  describe('Keywords', () => {
    it('tokenizes logical keywords', () => {
      const tokens = tokenize('and or not');
      expect(tokens).toHaveLength(3);
      expect(tokens.map((t) => t.type)).toEqual(['AND', 'OR', 'NOT']);
    });

    it('tokenizes IN keyword', () => {
      const tokens = tokenize('in');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('IN');
    });

    it('tokenizes CONTAINS keyword', () => {
      const tokens = tokenize('contains');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('CONTAINS');
    });

    it('tokenizes HAS keyword', () => {
      const tokens = tokenize('has');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('HAS');
    });

    it('tokenizes EXISTS keyword', () => {
      const tokens = tokenize('exists');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('EXISTS');
    });

    it('tokenizes AS keyword', () => {
      const tokens = tokenize('as');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('AS');
    });

    it('tokenizes JOIN keywords', () => {
      const tokens = tokenize('left join right join inner join cross join');
      expect(tokens).toHaveLength(8);
      expect(tokens.map((t) => t.type)).toEqual([
        'LEFT',
        'JOIN',
        'RIGHT',
        'JOIN',
        'INNER',
        'JOIN',
        'CROSS',
        'JOIN',
      ]);
    });

    it('tokenizes ON keyword', () => {
      const tokens = tokenize('on');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('ON');
    });

    it('tokenizes UNION keyword', () => {
      const tokens = tokenize('union all');
      expect(tokens).toHaveLength(2);
      expect(tokens.map((t) => t.type)).toEqual(['UNION', 'ALL']);
    });
  });

  describe('Identifiers', () => {
    it('tokenizes simple identifier', () => {
      const tokens = tokenize('title');
      expect(tokens).toHaveLength(1);
      isValidToken(tokens[0]);
      expect(tokens[0]).toEqual({
        type: 'IDENTIFIER',
        value: 'title',
        position: 0,
        line: 1,
        column: 1,
        offset: 0,
      });
    });

    it('tokenizes identifier with underscore', () => {
      const tokens = tokenize('my_field');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('IDENTIFIER');
      expect(tokens[0].value).toBe('my_field');
    });

    it('tokenizes identifier with numbers', () => {
      const tokens = tokenize('field123');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('IDENTIFIER');
      expect(tokens[0].value).toBe('field123');
    });

    it('tokenizes dotted identifier', () => {
      const tokens = tokenize('a.b.c');
      expect(tokens).toHaveLength(5);
      expect(tokens.map((t) => t.type)).toEqual([
        'IDENTIFIER',
        'DOT',
        'IDENTIFIER',
        'DOT',
        'IDENTIFIER',
      ]);
    });
  });

  describe('Delimiters', () => {
    it('tokenizes parentheses', () => {
      const tokens = tokenize('()');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].type).toBe('LPAREN');
      expect(tokens[1].type).toBe('RPAREN');
    });

    it('tokenizes brackets', () => {
      const tokens = tokenize('[]');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].type).toBe('LBRACKET');
      expect(tokens[1].type).toBe('RBRACKET');
    });

    it('tokenizes comma', () => {
      const tokens = tokenize(',');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('COMMA');
    });

    it('tokenizes colon', () => {
      const tokens = tokenize(':');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('COLON');
    });

    it('tokenizes semicolon', () => {
      const tokens = tokenize(';');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('SEMICOLON');
    });
  });

  describe('Property Accessor Syntax', () => {
    it('tokenizes builtin with property accessor', () => {
      const tokens = tokenize("links('text')");
      expect(tokens).toHaveLength(4);
      expect(tokens.map((t) => t.type)).toEqual(['IDENTIFIER', 'LPAREN', 'STRING', 'RPAREN']);
      expect(tokens[0].value).toBe('links');
      expect(tokens[2].value).toBe('text');
    });

    it('tokenizes section with property accessor', () => {
      const tokens = tokenize("section('title')");
      expect(tokens).toHaveLength(4);
      expect(tokens[0].value).toBe('section');
      expect(tokens[2].value).toBe('title');
    });

    it('tokenizes toc with property accessor', () => {
      const tokens = tokenize("toc('level')");
      expect(tokens).toHaveLength(4);
      expect(tokens[0].value).toBe('toc');
      expect(tokens[2].value).toBe('level');
    });

    it('tokenizes codeblocks with property accessor', () => {
      const tokens = tokenize("codeblocks('lang')");
      expect(tokens).toHaveLength(4);
      expect(tokens[0].value).toBe('codeblocks');
      expect(tokens[2].value).toBe('lang');
    });

    it('tokenizes images with property accessor', () => {
      const tokens = tokenize("images('alt')");
      expect(tokens).toHaveLength(4);
      expect(tokens[0].value).toBe('images');
      expect(tokens[2].value).toBe('alt');
    });

    it('tokenizes fields with property accessor', () => {
      const tokens = tokenize("fields('names')");
      expect(tokens).toHaveLength(4);
      expect(tokens[0].value).toBe('fields');
      expect(tokens[2].value).toBe('names');
    });
  });

  describe('Array Indexing Syntax', () => {
    it('tokenizes array index', () => {
      const tokens = tokenize('toc()[0]');
      expect(tokens).toHaveLength(6);
      expect(tokens.map((t) => t.type)).toEqual([
        'IDENTIFIER',
        'LPAREN',
        'RPAREN',
        'LBRACKET',
        'NUMBER',
        'RBRACKET',
      ]);
    });

    it('tokenizes negative array index', () => {
      const tokens = tokenize('links()[-1]');
      expect(tokens).toHaveLength(7);
      expect(tokens.map((t) => t.type)).toEqual([
        'IDENTIFIER',
        'LPAREN',
        'RPAREN',
        'LBRACKET',
        'MINUS',
        'NUMBER',
        'RBRACKET',
      ]);
      expect(tokens[5].value).toBe('1');
    });

    it('tokenizes nested array index', () => {
      const tokens = tokenize('links()[0].text');
      expect(tokens).toHaveLength(8);
      expect(tokens.map((t) => t.type)).toEqual([
        'IDENTIFIER',
        'LPAREN',
        'RPAREN',
        'LBRACKET',
        'NUMBER',
        'RBRACKET',
        'DOT',
        'IDENTIFIER',
      ]);
    });
  });

  describe('Method Chaining Syntax', () => {
    it('tokenizes filter method', () => {
      const tokens = tokenize("links().filter(section = 'Setup')");
      // links ( ) . filter ( section = 'Setup' )
      expect(tokens[0].value).toBe('links');
      expect(tokens[3].type).toBe('DOT');
      expect(tokens[4].value).toBe('filter');
    });

    it('tokenizes map method', () => {
      const tokens = tokenize("links().map('url')");
      expect(tokens[4].value).toBe('map');
    });

    it('tokenizes sort method', () => {
      const tokens = tokenize("links().sort('line')");
      expect(tokens[4].value).toBe('sort');
    });

    it('tokenizes slice method', () => {
      const tokens = tokenize('links().slice(0, 5)');
      expect(tokens[4].value).toBe('slice');
    });

    it('tokenizes flatten method', () => {
      const tokens = tokenize('section().map("hierarchy").flatten()');
      const values = tokens.map((t) => t.value);
      expect(values).toContain('flatten');
    });

    it('tokenizes count method', () => {
      const tokens = tokenize('links().count()');
      expect(tokens[4].value).toBe('count');
    });

    it('tokenizes first method', () => {
      const tokens = tokenize('links().first()');
      expect(tokens[4].value).toBe('first');
    });

    it('tokenizes last method', () => {
      const tokens = tokenize('links().last()');
      expect(tokens[4].value).toBe('last');
    });

    it('tokenizes unique method', () => {
      const tokens = tokenize('links().unique()');
      expect(tokens[4].value).toBe('unique');
    });

    it('tokenizes chained methods', () => {
      const tokens = tokenize("links().filter(section = 'Setup').map('url').sort('line')");
      const values = tokens.map((t) => t.value);
      expect(values).toContain('filter');
      expect(values).toContain('map');
      expect(values).toContain('sort');
    });
  });

  describe('Regex Pattern Syntax', () => {
    it('tokenizes regex pattern', () => {
      const tokens = tokenize('grep(/TODO/g)');
      // grep ( /TODO/g )
      expect(tokens).toHaveLength(4);
      expect(tokens[0].value).toBe('grep');
      expect(tokens[2].type).toBe('REGEX');
      expect(tokens[2].value).toBe('/TODO/g');
    });

    it('tokenizes regex with flags', () => {
      const tokens = tokenize('grep(/test\\d+/gi)');
      expect(tokens).toHaveLength(4);
      expect(tokens[2].type).toBe('REGEX');
      expect(tokens[2].value).toBe('/test\\d+/gi');
    });

    it('tokenizes regex with escapes', () => {
      const tokens = tokenize('grep(/\\.md$/)');
      expect(tokens).toHaveLength(4);
      expect(tokens[2].type).toBe('REGEX');
    });

    it('does not treat division as regex', () => {
      const tokens = tokenize('a / b');
      expect(tokens).toHaveLength(3);
      expect(tokens[1].type).toBe('SLASH');
    });
  });

  describe('Content Range Syntax', () => {
    it('tokenizes content with single argument', () => {
      const tokens = tokenize('content(10)');
      // content ( 10 )
      expect(tokens).toHaveLength(4);
      expect(tokens[0].value).toBe('content');
      expect(tokens[2].type).toBe('NUMBER');
      expect(tokens[2].value).toBe('10');
    });

    it('tokenizes content with range', () => {
      const tokens = tokenize('content(1, 45)');
      // content ( 1 , 45 )
      expect(tokens).toHaveLength(6);
      expect(tokens[2].type).toBe('NUMBER');
      expect(tokens[2].value).toBe('1');
      expect(tokens[4].type).toBe('NUMBER');
      expect(tokens[4].value).toBe('45');
    });

    it('tokenizes content with negative index', () => {
      const tokens = tokenize('content(-10)');
      // content ( - 10 )
      expect(tokens).toHaveLength(5);
      expect(tokens[2].type).toBe('MINUS');
      expect(tokens[3].type).toBe('NUMBER');
      expect(tokens[3].value).toBe('10');
    });

    it('tokenizes content with negative range', () => {
      const tokens = tokenize('content(-20, -1)');
      // content ( - 20 , - 1 )
      expect(tokens).toHaveLength(8);
    });
  });

  describe('Subquery Syntax', () => {
    it('tokenizes subquery in WHERE', () => {
      const tokens = tokenize('WHERE title IN (SELECT title FROM other)');
      // WHERE title IN ( SELECT title FROM other )
      expect(tokens[0].type).toBe('WHERE');
      expect(tokens[2].type).toBe('IN');
      expect(tokens[3].type).toBe('LPAREN');
      expect(tokens[4].type).toBe('SELECT');
    });

    it('tokenizes EXISTS with subquery', () => {
      const tokens = tokenize('WHERE EXISTS (SELECT 1 FROM files)');
      expect(tokens[1].type).toBe('EXISTS');
      expect(tokens[2].type).toBe('LPAREN');
      expect(tokens[3].type).toBe('SELECT');
    });
  });

  describe('JOIN Syntax', () => {
    it('tokenizes LEFT JOIN', () => {
      const tokens = tokenize('LEFT JOIN files ON a.id = b.id');
      expect(tokens.length).toBeGreaterThan(6);
      expect(tokens[0].type).toBe('LEFT');
      expect(tokens[1].type).toBe('JOIN');
      expect(tokens[3].type).toBe('ON');
    });

    it('tokenizes RIGHT JOIN', () => {
      const tokens = tokenize('RIGHT JOIN files ON a.id = b.id');
      expect(tokens[0].type).toBe('RIGHT');
      expect(tokens[1].type).toBe('JOIN');
    });

    it('tokenizes INNER JOIN', () => {
      const tokens = tokenize('INNER JOIN files ON a.id = b.id');
      expect(tokens[0].type).toBe('INNER');
      expect(tokens[1].type).toBe('JOIN');
    });

    it('tokenizes CROSS JOIN', () => {
      const tokens = tokenize('CROSS JOIN files');
      expect(tokens[0].type).toBe('CROSS');
      expect(tokens[1].type).toBe('JOIN');
    });
  });

  describe('UNION Syntax', () => {
    it('tokenizes UNION', () => {
      const tokens = tokenize('UNION');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('UNION');
    });

    it('tokenizes UNION ALL', () => {
      const tokens = tokenize('UNION ALL');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].type).toBe('UNION');
      expect(tokens[1].type).toBe('ALL');
    });
  });

  describe('Position Tracking', () => {
    it('tracks line numbers correctly', () => {
      const tokens = tokenize('select\nwhere\norder');
      expect(tokens[0].line).toBe(1);
      expect(tokens[1].line).toBe(2);
      expect(tokens[2].line).toBe(3);
    });

    it('tracks column numbers correctly', () => {
      const tokens = tokenize('  select');
      expect(tokens[0].column).toBe(3);
    });

    it('tracks offset correctly', () => {
      const tokens = tokenize('select where');
      expect(tokens[0].offset).toBe(0);
      expect(tokens[1].offset).toBe(7);
    });

    it('handles tabs correctly', () => {
      const tokens = tokenize('\tselect');
      expect(tokens[0].column).toBe(2);
    });
  });

  describe('Whitespace Handling', () => {
    it('skips multiple spaces', () => {
      const tokens = tokenize('  select   where  ');
      expect(tokens).toHaveLength(2);
    });

    it('skips newlines', () => {
      const tokens = tokenize('select\n\nwhere');
      expect(tokens).toHaveLength(2);
      expect(tokens[1].line).toBe(3);
    });

    it('skips mixed whitespace', () => {
      const tokens = tokenize(' \t\n select \t\n where ');
      expect(tokens).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('throws on invalid character', () => {
      expect(() => tokenize('@')).toThrow('Unexpected character');
    });

    it('includes position in error message', () => {
      expect(() => tokenize('select @')).toThrow('position 7');
    });

    it('includes line/column in error message', () => {
      expect(() => tokenize('select\n\n@')).toThrow('line 3');
    });

    it('throws on unterminated string', () => {
      expect(() => tokenize('"hello')).toThrow('Unterminated string');
    });

    it('throws on unterminated regex', () => {
      expect(() => tokenize('grep(/TODO')).toThrow('Unterminated regex');
    });
  });

  describe('Complex Queries', () => {
    it('tokenizes full SELECT query', () => {
      const tokens = tokenize('select title, status where status = "done" order by priority');
      expect(tokens.length).toBeGreaterThan(10);
      expect(tokens[0].type).toBe('SELECT');
    });

    it('tokenizes query with builtin and property', () => {
      const tokens = tokenize("select title, links('url') where status = 'todo'");
      expect(tokens.length).toBeGreaterThan(10);
    });

    it('tokenizes query with array indexing', () => {
      const tokens = tokenize("select title where toc()[0] = 'Introduction'");
      expect(tokens.length).toBeGreaterThan(10);
    });

    it('tokenizes query with method chaining', () => {
      const tokens = tokenize("select title where links().filter(section = 'Setup').count() > 0");
      expect(tokens.length).toBeGreaterThan(15);
    });

    it('tokenizes query with regex', () => {
      const tokens = tokenize("select title where grep(/TODO/gi)('text') CONTAINS 'fix'");
      expect(tokens.length).toBeGreaterThan(10);
    });

    it('tokenizes query with subquery', () => {
      const tokens = tokenize('select title where title IN (SELECT title FROM other)');
      expect(tokens.length).toBeGreaterThan(10);
      const types = tokens.map((t) => t.type);
      expect(types).toContain('IN');
      expect(types).toContain('SELECT');
      expect(types).toContain('FROM');
    });

    it('tokenizes query with JOIN', () => {
      const tokens = tokenize(
        'select a.title, b.content FROM files a LEFT JOIN sections b ON a.id = b.file_id',
      );
      expect(tokens.length).toBeGreaterThan(15);
    });

    it('tokenizes query with UNION', () => {
      const tokens = tokenize('select title FROM tasks UNION ALL select title FROM notes');
      expect(tokens.length).toBeGreaterThan(9);
      const types = tokens.map((t) => t.type);
      expect(types).toContain('UNION');
      expect(types).toContain('ALL');
      expect(types).toContain('FROM');
    });
  });

  describe('All Tokens are Valid JSON', () => {
    it('every token is a valid JSON object', () => {
      const queries = [
        'select title where status = "done"',
        "links().filter(section = 'Setup').map('url')",
        'grep(/TODO/gi)',
        'content(1, 10)',
        'toc()[0]',
        'WHERE title IN (SELECT title FROM files)',
        'LEFT JOIN sections ON a.id = b.id',
      ];

      for (const query of queries) {
        const tokens = new Lexer(query).tokenize();
        for (const token of tokens) {
          isValidToken(token);
          // Verify it can be serialized/deserialized
          const json = JSON.stringify(token);
          const parsed = JSON.parse(json);
          expect(parsed).toEqual(token);
        }
      }
    });

    it('no token is empty object', () => {
      const tokens = new Lexer('select title, links("url") where status = "todo"').tokenize();
      for (const token of tokens) {
        expect(JSON.stringify(token)).not.toBe('{}');
        expect(Object.keys(token).length).toBeGreaterThan(0);
      }
    });
  });
});
