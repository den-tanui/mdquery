// tests/parser-rewrite.test.ts
import { describe, expect, it } from 'vitest';
import { Parser } from '../src/parser';
import {
  ArrayIndexNode,
  ASTNode,
  BinaryOpNode,
  CreateStatement,
  DeleteStatement,
  Expression,
  FieldNode,
  FromClause,
  FunctionCallNode,
  JoinNode,
  MapIndexNode,
  MethodCallNode,
  OrderByNode,
  ParenNode,
  SelectStatement,
  SubqueryNode,
  UnaryOpNode,
  UpdateStatement,
  ValueNode,
  WildcardNode,
} from '../src/types';

// Helper to cast AST node to specific type
const asSelect = (ast: ASTNode): SelectStatement => ast as SelectStatement;
const asUpdate = (ast: ASTNode): UpdateStatement => ast as UpdateStatement;
const asCreate = (ast: ASTNode): CreateStatement => ast as CreateStatement;
const asDelete = (ast: ASTNode): DeleteStatement => ast as DeleteStatement;

// Helper to verify AST node is valid JSON object
export const isValidASTNode = (node: any) => {
  expect(node).toBeDefined();
  expect(typeof node).toBe('object');
  expect(node).not.toBeNull();
  expect(node).not.toEqual({});

  // FromClause doesn't have a type property
  if (node.table && !node.type) return;

  expect(typeof node.type).toBe('string');

  // Verify it can be serialized/deserialized
  const serialized = JSON.stringify(node);
  const deserialized = JSON.parse(serialized);
  expect(deserialized).toEqual(node);
};

describe('Parser Rewrite - TDD (Pratt Parser)', () => {
  describe('Basic Statements', () => {
    it('parses SELECT statement', () => {
      const ast = new Parser('select').parse() as SelectStatement;
      isValidASTNode(ast);
      expect(ast).toEqual({
        type: 'select',
        fields: [{ type: 'wildcard' }],
      });
    });

    it('parses UPDATE statement', () => {
      const ast = new Parser('update').parse() as UpdateStatement;
      isValidASTNode(ast);
      expect(ast.type).toBe('update');
    });

    it('parses CREATE statement', () => {
      const ast = new Parser('create').parse() as CreateStatement;
      isValidASTNode(ast);
      expect(ast.type).toBe('create');
    });

    it('parses DELETE statement', () => {
      const ast = new Parser('delete').parse() as DeleteStatement;
      isValidASTNode(ast);
      expect(ast.type).toBe('delete');
    });
  });

  describe('Field Lists', () => {
    it('parses wildcard field', () => {
      const ast = new Parser('select *').parse() as SelectStatement;
      expect(ast.fields).toEqual([{ type: 'wildcard' }]);
    });

    it('parses simple field list', () => {
      const ast = new Parser('select id, title, status').parse() as SelectStatement;
      expect(ast.fields).toEqual([
        { type: 'field', name: 'id' },
        { type: 'field', name: 'title' },
        { type: 'field', name: 'status' },
      ]);
    });

    it('parses field with AS alias', () => {
      const ast = new Parser('select title as TaskName').parse() as SelectStatement;
      expect(ast.fields).toEqual([{ type: 'field', name: 'title', alias: 'TaskName' }]);
    });

    it('parses builtin function', () => {
      const ast = new Parser('select toc()').parse() as SelectStatement;
      expect(ast.fields).toEqual([{ type: 'function_call', name: 'toc', args: [] }]);
    });

    it('parses builtin with property accessor', () => {
      const ast = new Parser("select links('url')").parse() as SelectStatement;
      expect(ast.fields).toEqual([
        {
          type: 'function_call',
          name: 'links',
          args: [{ type: 'string', value: 'url' }],
        },
      ]);
    });

    it('parses aggregate function', () => {
      const ast = new Parser('select count(*)').parse() as SelectStatement;
      expect(ast.fields).toEqual([
        { type: 'function_call', name: 'count', args: [{ type: 'wildcard' }] },
      ]);
    });
  });

  describe('WHERE Clause', () => {
    it('parses simple comparison', () => {
      const ast = new Parser('select where status = "done"').parse() as SelectStatement;
      expect(ast.where).toEqual({
        type: 'binary_op',
        left: { type: 'field', name: 'status' },
        op: '=',
        right: { type: 'string', value: 'done' },
      });
    });

    it('parses AND condition', () => {
      const ast = new Parser(
        'select where status = "done" and assignee = "jane"',
      ).parse() as SelectStatement;
      expect(ast.where).toEqual({
        type: 'binary_op',
        left: {
          type: 'binary_op',
          left: { type: 'field', name: 'status' },
          op: '=',
          right: { type: 'string', value: 'done' },
        },
        op: 'AND',
        right: {
          type: 'binary_op',
          left: { type: 'field', name: 'assignee' },
          op: '=',
          right: { type: 'string', value: 'jane' },
        },
      });
    });

    it('parses OR condition', () => {
      const ast = asSelect(new Parser('select where status = "done" or priority > 3').parse());
      expect(ast.where).toBeDefined();
      if (ast.where?.type === 'binary_op') {
        expect(ast.where.op).toBe('OR');
      }
    });

    it('respects operator precedence (AND > OR)', () => {
      const ast = asSelect(
        new Parser('select where status = "done" or priority > 3 and assignee = "jane"').parse(),
      );
      expect(ast.where).toBeDefined();
      if (ast.where?.type === 'binary_op') {
        // Should be: status = "done" OR (priority > 3 AND assignee = "jane")
        expect(ast.where.op).toBe('OR');
        if (ast.where.right.type === 'binary_op') {
          expect(ast.where.right.op).toBe('AND');
        }
      }
    });

    it('parses NOT condition', () => {
      const ast = asSelect(new Parser('select where not status = "done"').parse());
      expect(ast.where).toEqual({
        type: 'binary_op',
        left: {
          type: 'unary_op',
          op: 'NOT',
          operand: { type: 'field', name: 'status' },
        },
        op: '=',
        right: { type: 'string', value: 'done' },
      });
    });

    it('parses IN condition', () => {
      const ast = asSelect(new Parser('select where status in ("todo", "doing")').parse());
      expect(ast.where).toEqual({
        type: 'binary_op',
        left: { type: 'field', name: 'status' },
        op: 'IN',
        right: {
          type: 'array',
          items: [
            { type: 'string', value: 'todo' },
            { type: 'string', value: 'doing' },
          ],
        },
      });
    });

    it('parses HAS condition', () => {
      const ast = asSelect(new Parser('select where has(section)').parse());
      expect(ast.where).toEqual({
        type: 'function_call',
        name: 'has',
        args: [{ type: 'field', name: 'section' }],
      });
    });

    it('parses HAS SECTION condition', () => {
      const ast = asSelect(new Parser('select where has section("Setup")').parse());
      expect(ast.where).toEqual({
        type: 'function_call',
        name: 'has_section',
        args: [{ type: 'string', value: 'Setup' }],
      });
    });

    it('parses "value" IN toc() condition', () => {
      const ast = asSelect(new Parser('select where "Introduction" in toc()').parse());
      expect(ast.where).toEqual({
        type: 'binary_op',
        left: { type: 'string', value: 'Introduction' },
        op: 'IN',
        right: {
          type: 'function_call',
          name: 'toc',
          args: [],
        },
      });
    });
  });

  describe('Expression Parsing (Pratt)', () => {
    it('parses simple arithmetic', () => {
      const ast = asSelect(new Parser('select where priority + 1 > 5').parse());
      expect(ast.where).toBeDefined();
      if (ast.where?.type === 'binary_op') {
        expect(ast.where.left.type).toBe('binary_op');
        if (ast.where.left.type === 'binary_op') {
          expect(ast.where.left.op).toBe('+');
        }
      }
    });

    it('respects arithmetic precedence (* > +)', () => {
      const ast = asSelect(new Parser('select where priority + 1 * 2 > 5').parse());
      expect(ast.where).toBeDefined();
      if (ast.where?.type === 'binary_op' && ast.where.left.type === 'binary_op') {
        // Should be: priority + (1 * 2) > 5
        expect(ast.where.left.right.type).toBe('binary_op');
        if (ast.where.left.right.type === 'binary_op') {
          expect(ast.where.left.right.op).toBe('*');
        }
      }
    });

    it('respects parentheses', () => {
      const ast = asSelect(new Parser('select where (priority + 1) * 2 > 5').parse());
      expect(ast.where).toBeDefined();
      if (ast.where?.type === 'binary_op' && ast.where.left.type === 'binary_op') {
        // Should be: (priority + 1) * 2 > 5
        expect(ast.where.left.left.type).toBe('paren');
      }
    });

    it('parses exponentiation (right associative)', () => {
      const ast = asSelect(new Parser('select where 2 ^ 3 ^ 2').parse());
      expect(ast.where).toBeDefined();
      if (ast.where?.type === 'binary_op') {
        // Should be: 2 ^ (3 ^ 2) = 2^9 = 512
        expect(ast.where.right.type).toBe('binary_op');
        if (ast.where.right.type === 'binary_op' && ast.where.right.right.type === 'number') {
          expect(ast.where.right.right.value).toBe(2);
        }
      }
    });

    it('parses nested function calls', () => {
      const ast = asSelect(new Parser('select where len(trim(title)) > 10').parse());
      expect(ast.where).toBeDefined();
      if (ast.where?.type === 'binary_op') {
        expect(ast.where.left.type).toBe('function_call');
        if (ast.where.left.type === 'function_call') {
          expect(ast.where.left.name).toBe('len');
          expect(ast.where.left.args[0].type).toBe('function_call');
        }
      }
    });

    it('parses unary minus', () => {
      const ast = asSelect(new Parser('select where -priority > -5').parse());
      expect(ast.where).toBeDefined();
      if (ast.where?.type === 'binary_op') {
        expect(ast.where.left.type).toBe('unary_op');
        if (ast.where.left.type === 'unary_op') {
          expect(ast.where.left.op).toBe('-');
        }
      }
    });
  });

  describe('Property Accessor Syntax', () => {
    it('parses builtin with property accessor', () => {
      const ast = new Parser("select links('url')").parse();
      expect(ast.fields[0]).toEqual({
        type: 'function_call',
        name: 'links',
        args: [{ type: 'string', value: 'url' }],
      });
    });

    it('parses section with property accessor', () => {
      const ast = new Parser("select section('title')").parse();
      expect(ast.fields[0]).toEqual({
        type: 'function_call',
        name: 'section',
        args: [{ type: 'string', value: 'title' }],
      });
    });
  });

  describe('Array Indexing Syntax', () => {
    it('parses array index', () => {
      const ast = new Parser('select toc()[0]').parse();
      expect(ast.fields[0]).toEqual({
        type: 'array_index',
        object: {
          type: 'function_call',
          name: 'toc',
          args: [],
        },
        index: { type: 'number', value: 0 },
      });
    });

    it('parses negative array index', () => {
      const ast = asSelect(new Parser('select links()[-1]').parse());
      expect(ast.fields[0].type).toBe('array_index');
      if (ast.fields[0].type === 'array_index' && ast.fields[0].index.type === 'number') {
        expect(ast.fields[0].index.value).toBe(-1);
      }
    });

    it('parses nested array index', () => {
      const ast = asSelect(new Parser('select links()[0].text').parse());
      expect(ast.fields[0].type).toBe('map_index');
      if (ast.fields[0].type === 'map_index') {
        const mapIndex = ast.fields[0] as MapIndexNode;
        expect(mapIndex.key.type).toBe('string');
        if (mapIndex.key.type === 'string') {
          expect(mapIndex.key.value).toBe('text');
        }
        expect(mapIndex.object.type).toBe('array_index');
      }
    });
  });

  describe('Method Chaining Syntax', () => {
    it('parses filter method', () => {
      const ast = new Parser("select links().filter(section = 'Setup')").parse();
      expect(ast.fields[0]).toEqual({
        type: 'method_call',
        object: {
          type: 'function_call',
          name: 'links',
          args: [],
        },
        method: 'filter',
        args: [
          {
            type: 'binary_op',
            left: { type: 'field', name: 'section' },
            op: '=',
            right: { type: 'string', value: 'Setup' },
          },
        ],
      });
    });

    it('parses map method', () => {
      const ast = new Parser("select links().map('url')").parse();
      expect(ast.fields[0].method).toBe('map');
      expect(ast.fields[0].args[0].value).toBe('url');
    });

    it('parses sort method', () => {
      const ast = new Parser("select links().sort('line')").parse();
      expect(ast.fields[0].method).toBe('sort');
    });

    it('parses slice method', () => {
      const ast = new Parser('select links().slice(0, 5)').parse();
      expect(ast.fields[0].method).toBe('slice');
      expect(ast.fields[0].args[0].value).toBe(0);
      expect(ast.fields[0].args[1].value).toBe(5);
    });

    it('parses chained methods', () => {
      const ast = new Parser(
        "select links().filter(section = 'Setup').map('url').sort('line')",
      ).parse();
      const field = ast.fields[0];
      expect(field.method).toBe('sort');
      expect(field.object.method).toBe('map');
      expect(field.object.object.method).toBe('filter');
    });

    it('parses methods whose names lex as keywords (.join, .where)', () => {
      const ast = new Parser("select tags.join('-')").parse();
      expect(ast.fields[0].method).toBe('join');
      expect(ast.fields[0].args[0].value).toBe('-');

      const whereAst = new Parser("select sections().where(title = 'Setup')").parse();
      expect(whereAst.fields[0].method).toBe('where');
    });
  });

  describe('Regex Pattern Syntax', () => {
    it('parses regex pattern', () => {
      const ast = new Parser('select where grep(/TODO/g)').parse();
      expect(ast.where).toEqual({
        type: 'function_call',
        name: 'grep',
        args: [{ type: 'regex', value: '/TODO/g' }],
      });
    });

    it('parses regex with property accessor', () => {
      const ast = new Parser("select grep(/TODO/g)('text')").parse();
      expect(ast.fields[0].type).toBe('function_call');
      expect(ast.fields[0].args[0].type).toBe('regex');
    });
  });

  describe('Content Range Syntax', () => {
    it('parses content with single argument', () => {
      const ast = new Parser('select content(10)').parse();
      expect(ast.fields[0]).toEqual({
        type: 'function_call',
        name: 'content',
        args: [{ type: 'number', value: 10 }],
      });
    });

    it('parses content with range', () => {
      const ast = new Parser('select content(1, 45)').parse();
      expect(ast.fields[0].args).toEqual([
        { type: 'number', value: 1 },
        { type: 'number', value: 45 },
      ]);
    });

    it('parses content with negative index', () => {
      const ast = new Parser('select content(-10)').parse();
      expect(ast.fields[0].args[0]).toEqual({
        type: 'unary_op',
        op: '-',
        operand: { type: 'number', value: 10 },
      });
    });
  });

  describe('Subquery Syntax', () => {
    it('parses subquery in WHERE', () => {
      const ast = new Parser('select where title in (select title from other)').parse();
      expect(ast.where.right.type).toBe('subquery');
      expect(ast.where.right.query.type).toBe('select');
    });

    it('parses EXISTS with subquery', () => {
      const ast = new Parser('select where exists (select 1 from files)').parse();
      expect(ast.where.type).toBe('exists');
      expect(ast.where.subquery.type).toBe('select');
    });

    it('parses scalar subquery', () => {
      const ast = new Parser('select where priority = (select max(priority) from files)').parse();
      expect(ast.where.right.type).toBe('subquery');
    });
  });

  describe('JOIN Syntax', () => {
    it('parses LEFT JOIN', () => {
      const ast = new Parser(
        'select from files a left join sections b on a.id = b.file_id',
      ).parse();
      if (ast.type === 'select' && ast.join) {
        expect(ast.join.joinType).toBe('left');
      }
    });

    it('parses RIGHT JOIN', () => {
      const ast = new Parser(
        'select from files a right join sections b on a.id = b.file_id',
      ).parse();
      if (ast.type === 'select' && ast.join) {
        expect(ast.join.joinType).toBe('right');
      }
    });

    it('parses INNER JOIN', () => {
      const ast = new Parser(
        'select from files a inner join sections b on a.id = b.file_id',
      ).parse();
      if (ast.type === 'select' && ast.join) {
        expect(ast.join.joinType).toBe('inner');
      }
    });

    it('parses CROSS JOIN', () => {
      const ast = new Parser('select from files a cross join sections b').parse();
      if (ast.type === 'select' && ast.join) {
        expect(ast.join.joinType).toBe('cross');
      }
    });
  });

  describe('UNION Syntax', () => {
    it('parses UNION', () => {
      const ast = new Parser('select from tasks union select from notes').parse();
      expect(ast.type).toBe('union');
      expect(ast.queries.length).toBe(2);
    });

    it('parses UNION ALL', () => {
      const ast = new Parser('select from tasks union all select from notes').parse();
      expect(ast.all).toBe(true);
    });
  });

  describe('Type Annotations', () => {
    it('parses type annotation in CREATE', () => {
      const ast = new Parser('create title:str = "Task", priority:int = 5').parse();
      expect(ast.fields.title.type).toBe('str');
      expect(ast.fields.priority.type).toBe('int');
    });

    it('parses type annotation in UPDATE', () => {
      const ast = new Parser('update set status:str = "done"').parse();
      expect(ast.set.status.type).toBe('str');
    });
  });

  describe('Error Handling', () => {
    it('throws on invalid syntax', () => {
      expect(() => new Parser('select @').parse()).toThrow();
    });

    it('includes position in error message', () => {
      expect(() => new Parser('select where @').parse()).toThrow('position');
    });

    it('includes line/column in error message', () => {
      expect(() => new Parser('select\n\nwhere @').parse()).toThrow('line 3');
    });

    it('throws on unterminated string', () => {
      expect(() => new Parser('select "hello').parse()).toThrow('Unterminated string');
    });

    it('throws on unterminated parentheses', () => {
      expect(() => new Parser('select (title').parse()).toThrow('Expected RPAREN');
    });
  });

  describe('Complex Queries', () => {
    it('parses full SELECT query', () => {
      const ast = new Parser(
        'select title, status where status = "done" order by priority desc limit 10',
      ).parse();
      expect(ast.type).toBe('select');
      expect(ast.fields.length).toBe(2);
      expect(ast.where).toBeDefined();
      expect(ast.orderBy).toBeDefined();
      expect(ast.limit).toBe(10);
    });

    it('parses query with builtin and property', () => {
      const ast = new Parser("select title, links('url') where status = 'todo'").parse();
      expect(ast.fields.length).toBe(2);
      expect(ast.fields[1].type).toBe('function_call');
    });

    it('parses query with array indexing', () => {
      const ast = new Parser("select title where toc()[0] = 'Introduction'").parse();
      expect(ast.where.left.type).toBe('array_index');
    });

    it('parses query with method chaining', () => {
      const ast = new Parser(
        "select title where links().filter(section = 'Setup').count() > 0",
      ).parse();
      expect(ast.where.left.type).toBe('method_call');
    });

    it('parses query with regex', () => {
      const ast = new Parser("select title where grep(/TODO/gi)('text') contains 'fix'").parse();
      expect(ast.where.left.type).toBe('function_call');
    });

    it('parses query with subquery', () => {
      const ast = new Parser('select title where title in (select title from other)').parse();
      expect(ast.where.right.type).toBe('subquery');
    });

    it('parses query with JOIN', () => {
      const ast = new Parser(
        'select a.title, b.content from files a left join sections b on a.id = b.file_id',
      ).parse();
      expect(ast.join).toBeDefined();
    });
  });

  describe('All AST Nodes are Valid JSON', () => {
    it('every AST node is a valid JSON object', () => {
      const queries = [
        'select title where status = "done"',
        "select links().filter(section = 'Setup').map('url')",
        'select where grep(/TODO/gi)',
        'select content(1, 10)',
        'select toc()[0]',
        'select where title in (select title from files)',
        'select from files a left join sections b on a.id = b.id',
      ];

      for (const query of queries) {
        const ast = new Parser(query).parse();
        isValidASTNode(ast);

        // Recursively check all nodes
        const checkNode = (node: any) => {
          if (!node) return;
          isValidASTNode(node);

          for (const key in node) {
            if (Array.isArray(node[key])) {
              node[key].forEach(checkNode);
            } else if (typeof node[key] === 'object') {
              checkNode(node[key]);
            }
          }
        };

        checkNode(ast);
      }
    });

    it('no AST node is empty object', () => {
      const ast = new Parser('select title, links("url") where status = "todo"').parse();
      const checkNode = (node: any) => {
        if (!node) return;
        expect(JSON.stringify(node)).not.toBe('{}');
        expect(Object.keys(node).length).toBeGreaterThan(0);

        for (const key in node) {
          if (Array.isArray(node[key])) {
            node[key].forEach(checkNode);
          } else if (typeof node[key] === 'object') {
            checkNode(node[key]);
          }
        }
      };

      checkNode(ast);
    });
  });
});
