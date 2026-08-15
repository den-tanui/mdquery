// src/parser.ts
import { Token, TokenType, ASTNode, Expression, SelectStatement, UpdateStatement, 
  CreateStatement, DeleteStatement, TriggerStatement, PipeNode, UnionNode,
  BinaryOpNode, UnaryOpNode, FunctionCallNode, MethodCallNode, ArrayIndexNode,
  MapIndexNode, FieldNode, ValueNode, ParenNode, WildcardNode, SubqueryNode,
  JoinNode, FromClause, OrderByNode } from './types';
import { Lexer } from './lexer';

// Binding power table for Pratt parser
const BINDING_POWER: Record<string, number> = {
  // OR has lowest precedence
  'OR': 10,
  'AND': 20,
  // Comparisons
  '=': 30, '!=': 30, '<': 30, '>': 30, '<=': 30, '>=': 30,
  'IN': 30, 'NOT IN': 30, 'CONTAINS': 30, 'STARTS_WITH': 30, 'ENDS_WITH': 30,
  'IS': 30, 'ANY': 30, 'ALL': 30,
  // Additive
  '+': 40, '-': 40,
  // Multiplicative
  '*': 50, '/': 50, '%': 50,
  // Exponentiation (right associative)
  '^': 60,
  // Unary
  'NOT': 70, '!': 70, 'UNARY_MINUS': 70, 'UNARY_PLUS': 70,
  // Function calls, method calls, indexing
  'CALL': 80, 'METHOD': 90, 'INDEX': 80
};

export class Parser {
  private tokens: Token[];
  private position: number = 0;

  constructor(input: string) {
    this.tokens = new Lexer(input).tokenize();
  }

  parse(): ASTNode {
    const token = this.current();

    // Check for UNION first
    if (token.type === 'UNION') {
      return this.parseUnion(this.parseSelect());
    }
    
    let ast: ASTNode;
    
    if (token.type === 'SELECT') ast = this.parseSelect();
    else if (token.type === 'UPDATE') ast = this.parseUpdate();
    else if (token.type === 'CREATE') ast = this.parseCreate();
    else if (token.type === 'DELETE') ast = this.parseDelete();
    else if (token.type === 'BEFORE' || token.type === 'AFTER') ast = this.parseTrigger();
    else throw new Error(`Unexpected token: ${token.value}`);

    // Handle pipe syntax
    if (this.current().type === 'PIPE') {
      this.advance();
      const fn = this.expect('IDENTIFIER').value;
      this.expect('LPAREN');
      const args: ValueNode[] = [];
      while (this.current().type !== 'RPAREN') {
        args.push(this.parseValue());
        if (this.current().type === 'COMMA') this.advance();
      }
      this.expect('RPAREN');
      return { type: 'pipe', expr: ast, fn, args };
    }

    // Check for UNION after the query
    if (this.current().type === 'UNION') {
      return this.parseUnion(ast as SelectStatement);
    }

    return ast;
  }

  private parseSelect(): SelectStatement {
    this.advance(); // skip SELECT

    const node: SelectStatement = { type: 'select', fields: [] };

    // DISTINCT
    if (this.current().type === 'DISTINCT') {
      node.distinct = true;
      this.advance();
    }

    // Parse fields if not a keyword
    if (this.current().type !== 'EOF' && !this.isKeyword() && this.current().type !== 'FROM') {
      node.fields = this.parseFieldList();
    } else if (node.fields.length === 0) {
      // Default to wildcard if no fields specified
      node.fields = [{ type: 'wildcard' }];
    }

    // FROM clause
    if (this.current().type === 'FROM') {
      this.advance();
      const fromClause = this.parseFromClause();
      node.from = fromClause;
    }

    // WHERE
    if (this.current().type === 'WHERE') {
      this.advance();
      node.where = this.parseExpression();
    }

    // GROUP BY
    if (this.current().type === 'GROUP') {
      this.advance();
      this.expect('BY');
      node.groupBy = this.parseIdentifierList();
    }

    // HAVING
    if (this.current().type === 'HAVING') {
      this.advance();
      node.having = this.parseExpression();
    }

    // ORDER BY
    if (this.current().type === 'ORDER') {
      this.advance();
      this.expect('BY');
      node.orderBy = this.parseOrderBy();
    }

    // LIMIT
    if (this.current().type === 'LIMIT') {
      this.advance();
      node.limit = parseInt(this.expect('NUMBER').value);
    }

    // OFFSET
    if (this.current().type === 'OFFSET') {
      this.advance();
      node.offset = parseInt(this.expect('NUMBER').value);
    }

    // JOIN
    if (this.current().type === 'LEFT' || this.current().type === 'RIGHT' ||
        this.current().type === 'INNER' || this.current().type === 'CROSS') {
      node.join = this.parseJoin();
    } else if (this.current().type === 'JOIN') {
      node.join = this.parseJoin();
    }

    return node;
  }

  private parseUnion(firstQuery: SelectStatement): UnionNode {
    const queries = [firstQuery];
    let all = false;

    while (this.current().type === 'UNION') {
      this.advance();
      if (this.current().type === 'ALL') {
        all = true;
        this.advance();
      }
      queries.push(this.parseSelect());
    }

    return { type: 'union', queries, all };
  }

  private parseJoin(): JoinNode {
    let joinType: 'left' | 'right' | 'inner' | 'cross' = 'cross';
    
    if (this.current().type === 'LEFT') {
      joinType = 'left';
      this.advance();
      this.expect('JOIN');
    } else if (this.current().type === 'RIGHT') {
      joinType = 'right';
      this.advance();
      this.expect('JOIN');
    } else if (this.current().type === 'INNER') {
      joinType = 'inner';
      this.advance();
      this.expect('JOIN');
    } else if (this.current().type === 'CROSS') {
      joinType = 'cross';
      this.advance();
      if (this.current().type === 'JOIN') {
        this.advance();
      }
    } else {
      this.expect('JOIN');
    }
    
    const right = this.parseFromClause();
    let on: Expression | undefined;
    
    if (joinType !== 'cross' && this.current().type === 'ON') {
      this.advance();
      on = this.parseExpression();
    }
    
    // For now, we'll use a default left table
    const left: FromClause = { table: 'current', alias: 'a' };
    
    return { type: 'join', joinType, left, right, on };
  }

  private parseFromClause(): FromClause {
    const table = this.expect('IDENTIFIER').value;
    let alias: string | undefined;
    
    if (this.current().type === 'IDENTIFIER' && this.current().value !== 'ON') {
      alias = this.advance().value;
    }
    
    return { table, alias };
  }

  private parseUpdate(): UpdateStatement {
    this.advance(); // skip UPDATE
    const node: UpdateStatement = { type: 'update', set: {} };

    // WHERE
    if (this.current().type === 'WHERE') {
      this.advance();
      node.where = this.parseExpression();
    }

    // SET
    if (this.current().type === 'SET') {
      this.advance();
      node.set = this.parseSetClause();
    }

    return node;
  }

  private parseCreate(): CreateStatement {
    this.advance(); // skip CREATE
    const node: CreateStatement = { type: 'create', fields: {} };

    node.fields = this.parseSetClause();

    return node;
  }

  private parseDelete(): DeleteStatement {
    this.advance(); // skip DELETE
    const node: DeleteStatement = { type: 'delete' };

    // WHERE
    if (this.current().type === 'WHERE') {
      this.advance();
      node.where = this.parseExpression();
    }

    return node;
  }

  private parseTrigger(): TriggerStatement {
    const event = this.advance().type === 'BEFORE' ? 'before' : 'after';
    const opToken = this.current();
    let operation: 'create' | 'update' | 'delete';
    
    if (opToken.type === 'CREATE') {
      operation = 'create';
    } else if (opToken.type === 'UPDATE') {
      operation = 'update';
    } else if (opToken.type === 'DELETE') {
      operation = 'delete';
    } else {
      throw new Error(`Expected CREATE, UPDATE, or DELETE, got ${opToken.type}`);
    }
    
    this.advance();

    const node: TriggerStatement = {
      type: 'trigger',
      event,
      operation,
      action: { type: 'deny', message: '' } // default
    };

    // WHERE
    if (this.current().type === 'WHERE') {
      this.advance();
      node.where = this.parseExpression();
    }

    // Action
    const actionToken = this.current();
    if (actionToken.type === 'DENY') {
      this.advance();
      const message = this.expect('STRING').value;
      node.action = { type: 'deny', message };
    } else if (actionToken.type === 'SET') {
      this.advance();
      node.action = { type: 'update', set: this.parseSetClause() };
    } else if (actionToken.type === 'RUN') {
      this.advance();
      const command = this.expect('STRING').value;
      node.action = { type: 'run', command };
    }

    return node;
  }

  private parseFieldList(): Expression[] {
    const fields: Expression[] = [];

    while (this.current().type !== 'EOF' && !this.isKeyword()) {
      const expr = this.parseExpression();
      
      // Check for AS alias
      let alias: string | undefined;
      if (this.current().type === 'AS') {
        this.advance();
        alias = this.expect('IDENTIFIER').value;
        // Add alias to the last field
        if (expr.type === 'field') {
          expr.alias = alias;
        } else if (expr.type === 'function_call') {
          expr.alias = alias;
        }
      }
      
      fields.push(expr);

      if (this.current().type === 'COMMA') {
        this.advance();
      } else {
        break;
      }
    }

    return fields;
  }

  private parseExpression(rbp: number = 0): Expression {
    let left = this.parsePrefix();
    
    while (rbp < this.getBindingPower(this.current())) {
      left = this.parseInfix(left);
    }
    
    return left;
  }

  private parsePrefix(): Expression {
    const token = this.current();
    
    // Unary operators
    if (this.isTokenType(token, 'NOT') || this.isTokenType(token, 'MINUS') || this.isTokenType(token, 'PLUS')) {
      const op = this.isTokenType(token, 'NOT') ? 'NOT' : token.value;
      this.advance();
      const operand = this.parseExpression(BINDING_POWER[op]);
      return { type: 'unary_op', op, operand };
    }
    
    // Parentheses
    if (token.type === 'LPAREN') {
      this.advance(); // skip (
      const expr = this.parseExpression();
      this.expect('RPAREN');
      return { type: 'paren', expression: expr };
    }
    
    // Function call
    if (token.type === 'IDENTIFIER' && this.peek().type === 'LPAREN') {
      return this.parseFunctionCall();
    }
    
    // Array literal
    if (token.type === 'LBRACKET') {
      return this.parseArrayLiteral();
    }
    
    // Value literals
    if (token.type === 'STRING' || token.type === 'NUMBER' || token.type === 'BOOLEAN' ||
        token.type === 'REGEX' || token.value === 'null' || token.type === 'EMPTY') {
      return this.parseValue();
    }
    
    // HAS keyword
    if (token.type === 'HAS') {
      return this.parseHas();
    }
    
    // EXISTS keyword
    if (token.type === 'EXISTS') {
      return this.parseExists();
    }
    
    // Field reference
    if (token.type === 'IDENTIFIER') {
      this.advance();
      return { type: 'field', name: token.value };
    }
    
    // Wildcard
    if (token.type === 'STAR') {
      this.advance();
      return { type: 'wildcard' };
    }
    
    throw new Error(`Unexpected token in prefix: ${token.value}`);
  }

  private parseInfix(left: Expression): Expression {
    const token = this.current();
    
    // EXISTS operator
    if (token.type === 'EXISTS') {
      this.advance();
      this.expect('LPAREN');
      const query = this.parseSelect();
      this.expect('RPAREN');
      return { type: 'exists', subquery: query };
    }
    
    // EXISTS operator
    if (this.isTokenType(token, 'EXISTS')) {
      this.advance();
      this.expect('LPAREN');
      const query = this.parseSelect();
      this.expect('RPAREN');
      return { type: 'exists', subquery: query };
    }
    
    // Binary operators
    if (token.type === 'EQUALS' || token.type === 'NOT_EQUALS' ||
        token.type === 'LT' || token.type === 'GT' ||
        token.type === 'LTE' || token.type === 'GTE' ||
        token.type === 'PLUS' || token.type === 'MINUS' ||
        token.type === 'STAR' || token.type === 'SLASH' ||
        token.type === 'PERCENT' || token.type === 'AND' || token.type === 'OR') {
      const op = this.getOperator();
      this.advance();
      
      // Check for subquery in right operand
      let right: Expression;
      if (this.current().type === 'LPAREN' && this.peek().type === 'SELECT') {
        this.advance(); // skip (
        const query = this.parseSelect();
        this.expect('RPAREN');
        right = { type: 'subquery', query };
      } else {
        right = this.parseExpression(BINDING_POWER[op]);
      }
      
      return { type: 'binary_op', left, op, right };
    }
    
    // Exponentiation (right associative)
    if (token.type === 'CARET') {
      const op = '^';
      this.advance();
      // Right associative: use current binding power - 1
      const right = this.parseExpression(BINDING_POWER[op] - 1);
      return { type: 'binary_op', left, op, right };
    }
    
    // IN operator
    
    // IN operator
    if (token.type === 'IN') {
      this.advance();
      let right: Expression;
      
      if (this.current().type === 'LPAREN') {
        // Peek ahead to see if it's a subquery
        const nextToken = this.peek();
        if (nextToken.type === 'SELECT') {
          // IN (subquery)
          this.advance(); // skip (
          const query = this.parseSelect();
          this.expect('RPAREN');
          right = { type: 'subquery', query };
        } else {
          // IN (list)
          this.advance(); // skip (
          const items: ValueNode[] = [];
          while (this.current().type !== 'RPAREN') {
            items.push(this.parseValue());
            if (this.current().type === 'COMMA') this.advance();
          }
          this.expect('RPAREN');
          right = { type: 'array', items };
        }
      } else {
        // IN function_call
        right = this.parseExpression(BINDING_POWER['IN']);
      }
      
      return { type: 'binary_op', left, op: 'IN', right };
    }
    
    // NOT IN operator
    if (token.type === 'NOT' && this.peek().type === 'IN') {
      this.advance(); // skip NOT
      this.advance(); // skip IN
      let right: Expression;
      
      if (this.current().type === 'LPAREN') {
        this.advance(); // skip (
        const items: ValueNode[] = [];
        while (this.current().type !== 'RPAREN') {
          items.push(this.parseValue());
          if (this.current().type === 'COMMA') this.advance();
        }
        this.expect('RPAREN');
        right = { type: 'array', items };
      } else {
        right = this.parseExpression(BINDING_POWER['IN']);
      }
      
      return { type: 'binary_op', left, op: 'NOT IN', right };
    }
    
    // CONTAINS, STARTS_WITH, ENDS_WITH
    if (token.type === 'CONTAINS' || token.type === 'STARTS_WITH' || token.type === 'ENDS_WITH') {
      const op = token.type;
      this.advance();
      const right = this.parseExpression(BINDING_POWER[op]);
      return { type: 'binary_op', left, op, right };
    }
    
    // NOT CONTAINS, NOT STARTS_WITH, NOT ENDS_WITH
    if (token.type === 'NOT') {
      const nextType = this.peek().type;
      if (nextType === 'CONTAINS' || nextType === 'STARTS_WITH' || nextType === 'ENDS_WITH') {
        this.advance(); // skip NOT
        const op = `NOT ${this.current().type}`;
        this.advance();
        const right = this.parseExpression(BINDING_POWER[op]);
        return { type: 'binary_op', left, op, right };
      }
    }
    
    // IS EMPTY / IS NOT EMPTY
    if (token.type === 'IS') {
      this.advance();
      if (this.current().type === 'NOT') {
        this.advance();
        this.expect('EMPTY');
        return { type: 'binary_op', left, op: 'IS NOT EMPTY', right: { type: 'empty' } };
      }
      this.expect('EMPTY');
      return { type: 'binary_op', left, op: 'IS EMPTY', right: { type: 'empty' } };
    }
    
    // ANY operator: field any <op> value (e.g. tags any = "backend")
    if (token.type === 'ANY') {
      this.advance();
      const subOp = this.getOperator();
      this.advance();
      const right = this.parseExpression(BINDING_POWER[subOp] || BINDING_POWER['=']);
      return { type: 'binary_op', left, op: `ANY ${subOp}`, right };
    }
    
    // ALL operator: field all <op> value (e.g. tags all contains "backend")
    if (token.type === 'ALL') {
      this.advance();
      const subOp = this.getOperator();
      this.advance();
      const right = this.parseExpression(BINDING_POWER[subOp] || BINDING_POWER['=']);
      return { type: 'binary_op', left, op: `ALL ${subOp}`, right };
    }
    
    // Function call (postfix)
    if (token.type === 'LPAREN') {
      return this.parseFunctionCallArgs(left);
    }
    
    // Method call (postfix) - only for chained methods like .filter(), .map()
    // (method names may lex as keywords: .join() → JOIN, .where() → WHERE)
    if (token.type === 'DOT' && this.isChainedMethod(this.peek().value)) {
      return this.parseMethodCall(left);
    }
    
    // Map index (postfix) - for property access like .text, .url
    if (token.type === 'DOT' && this.peek().type === 'IDENTIFIER') {
      return this.parseMapIndex(left);
    }
    
    // Array index (postfix)
    if (this.isTokenType(token, 'LBRACKET')) {
      return this.parseArrayIndex(left);
    }
    
    // Map index (postfix) - check if next token is STRING or IDENTIFIER
    if (this.isTokenType(token, 'LBRACKET') && 
        (this.peek().type === 'STRING' || this.peek().type === 'IDENTIFIER')) {
      return this.parseMapIndex(left);
    }
    
    throw new Error(`Unexpected token in infix: ${token.value}`);
  }

  private parseFunctionCall(): FunctionCallNode {
    const name = this.expect('IDENTIFIER').value;
    this.expect('LPAREN');
    const args: Expression[] = [];
    
    while (this.current().type !== 'RPAREN') {
      args.push(this.parseExpression());
      if (this.current().type === 'COMMA') this.advance();
    }
    
    this.expect('RPAREN');
    
    // Check for property accessor (e.g., grep(/TODO/g)('text'))
    if (this.current().type === 'LPAREN') {
      return this.parseFunctionCallArgs({ type: 'function_call', name, args });
    }
    
    return { type: 'function_call', name, args };
  }

  private parseFunctionCallArgs(left: Expression): FunctionCallNode {
    this.expect('LPAREN');
    const args: Expression[] = [];

    while (this.current().type !== 'RPAREN') {
      args.push(this.parseExpression());
      if (this.current().type === 'COMMA') this.advance();
    }

    this.expect('RPAREN');
    
    // Handle property accessor pattern: grep(/TODO/g)('text')
    if (left.type === 'function_call') {
      return { type: 'function_call', name: left.name, args: [...left.args, ...args] };
    }
    
    return { type: 'function_call', name: (left as FieldNode).name, args };
  }

  private isChainedMethod(method: string): boolean {
    const chainedMethods = ['filter', 'map', 'where', 'first', 'last', 'sort', 'slice', 'flatten', 'unique', 'count', 'join', 'keys', 'values'];
    return chainedMethods.includes(method);
  }

  private parseMethodCall(object: Expression): MethodCallNode {
    this.expect('DOT');
    // Method names may lex as keywords (.join() → JOIN, .where() → WHERE),
    // so take the name from the token value regardless of token type. We only
    // reach here when isChainedMethod matched the peeked value.
    const method = this.current().value;
    this.advance();
    this.expect('LPAREN');
    const args: Expression[] = [];
    
    while (this.current().type !== 'RPAREN') {
      args.push(this.parseExpression());
      if (this.current().type === 'COMMA') this.advance();
    }
    
    this.expect('RPAREN');
    return { type: 'method_call', object, method, args };
  }

  private parseArrayIndex(object: Expression): Expression {
    this.expect('LBRACKET');
    const index = this.parseExpression();
    this.expect('RBRACKET');
    
    return { type: 'array_index', object, index };
  }

  private parseMapIndex(object: Expression): MapIndexNode {
    // Handle DOT syntax: .text, .url
    if (this.current().type === 'DOT') {
      this.advance(); // skip DOT
      const key = this.expect('IDENTIFIER').value;
      return { type: 'map_index', object, key: { type: 'string', value: key } };
    }
    
    // Handle LBRACKET syntax: ['text'], ['url']
    this.expect('LBRACKET');
    const key = this.parseValue();
    this.expect('RBRACKET');
    return { type: 'map_index', object, key };
  }

  private parseArrayLiteral(): ValueNode {
    this.expect('LBRACKET');
    const items: ValueNode[] = [];
    
    while (this.current().type !== 'RBRACKET') {
      items.push(this.parseValue());
      if (this.current().type === 'COMMA') this.advance();
    }
    
    this.expect('RBRACKET');
    return { type: 'array', items };
  }

  private parseValue(): ValueNode {
    const token = this.current();
    
    // Handle negative numbers
    if (token.type === 'MINUS' && this.peek().type === 'NUMBER') {
      this.advance(); // skip MINUS
      const numToken = this.advance(); // get NUMBER
      return { type: 'number', value: -parseInt(numToken.value) };
    }
    
    if (token.type === 'STRING') {
      this.advance();
      return { type: 'string', value: token.value };
    }
    
    if (token.type === 'NUMBER') {
      this.advance();
      return { type: 'number', value: parseInt(token.value) };
    }
    
    if (token.type === 'BOOLEAN') {
      this.advance();
      return { type: 'boolean', value: token.value === 'true' };
    }
    
    if (token.type === 'REGEX') {
      this.advance();
      return { type: 'regex', value: token.value };
    }
    
    if (token.type === 'IDENTIFIER' && token.value.toLowerCase() === 'null') {
      this.advance();
      return { type: 'null', value: null };
    }
    
    if (token.type === 'EMPTY') {
      this.advance();
      return { type: 'empty' };
    }
    
    // Array literal: [item, item, ...]
    if (token.type === 'LBRACKET') {
      this.advance(); // skip [
      const items: ValueNode[] = [];
      while (this.current().type !== 'RBRACKET') {
        items.push(this.parseValue());
        if (this.current().type === 'COMMA') this.advance();
      }
      this.expect('RBRACKET');
      return { type: 'array', items };
    }
    
    // Subquery
    if (token.type === 'LPAREN') {
      // Peek ahead to see if it's a subquery
      const nextToken = this.peek();
      if (nextToken.type === 'SELECT') {
        this.advance(); // skip (
        const query = this.parseSelect();
        this.expect('RPAREN');
        return { type: 'subquery', query };
      }
    }
    
    throw new Error(`Unexpected token in value: ${token.value}`);
  }

  private parseSetClause(): Record<string, { value: Expression; type?: string }> {
    const set: Record<string, { value: Expression; type?: string }> = {};

    while (this.current().type !== 'EOF') {
      if (this.current().type !== 'IDENTIFIER') break;
      
      const field = this.expect('IDENTIFIER').value;
      
      // Check for type annotation (e.g., field:type)
      let typeAnnotation: string | undefined;
      if (this.current().type === 'COLON') {
        this.advance();
        typeAnnotation = this.expect('IDENTIFIER').value;
      }
      
      this.expect('EQUALS');
      set[field] = { value: this.parseExpression(), type: typeAnnotation };

      if (this.current().type === 'COMMA') {
        this.advance();
      } else if (this.current().type === 'IDENTIFIER' && (this.peek().type === 'EQUALS' || this.peek().type === 'COLON')) {
        continue;
      } else {
        break;
      }
    }

    return set;
  }

  private parseIdentifierList(): string[] {
    const identifiers: string[] = [];

    while (true) {
      identifiers.push(this.expect('IDENTIFIER').value);
      if (this.current().type === 'COMMA') {
        this.advance();
      } else {
        break;
      }
    }

    return identifiers;
  }

  private parseHas(): FunctionCallNode {
    this.advance(); // skip HAS
    
    // Handle has section("name") syntax
    if (this.current().type === 'IDENTIFIER' && this.current().value.toLowerCase() === 'section') {
      this.advance(); // skip section
      this.expect('LPAREN');
      const sectionName = this.expect('STRING').value;
      this.expect('RPAREN');
      return { type: 'function_call', name: 'has_section', args: [{ type: 'string', value: sectionName }] };
    }
    
    // Handle has(field) syntax
    this.expect('LPAREN');
    const field = this.expect('IDENTIFIER').value;
    this.expect('RPAREN');
    return { type: 'function_call', name: 'has', args: [{ type: 'field', name: field }] };
  }

  private parseExists(): Expression {
    this.advance(); // skip EXISTS
    this.expect('LPAREN');
    const subquery = this.parseSelect();
    this.expect('RPAREN');
    return { type: 'exists', subquery };
  }

  private parseOrderBy(): OrderByNode[] {
    const items: OrderByNode[] = [];

    while (true) {
      // ORDER BY accepts full expressions (e.g. file().mtime), not just bare
      // identifiers. parseExpression stops at ASC/DESC/COMMA naturally: those
      // tokens have no binding power.
      const field = this.parseExpression(0);
      let direction: 'asc' | 'desc' = 'asc';

      if (this.current().type === 'IDENTIFIER') {
        const dir = this.current().value.toLowerCase();
        if (dir === 'asc' || dir === 'desc') {
          direction = dir;
          this.advance();
        }
      }

      items.push({ field, direction });

      if (this.current().type === 'COMMA') {
        this.advance();
      } else {
        break;
      }
    }

    return items;
  }

  private getBindingPower(token: Token): number {
    // Check for postfix operators
    if (token.type === 'LPAREN') return BINDING_POWER['CALL'];
    if (token.type === 'DOT') return BINDING_POWER['METHOD'];
    if (token.type === 'LBRACKET') return BINDING_POWER['INDEX'];
    
    // Check for binary operators
    const op = this.getOperator();
    if (op && BINDING_POWER[op]) return BINDING_POWER[op];
    
    // Default to 0 (lowest precedence)
    return 0;
  }

  private isTokenType(token: Token, type: TokenType): boolean {
    return token.type === type;
  }

  private getOperator(): string {
    const token = this.current();
    const ops: Record<string, string> = {
      EQUALS: '=',
      NOT_EQUALS: '!=',
      LT: '<',
      GT: '>',
      LTE: '<=',
      GTE: '>=',
      PLUS: '+',
      MINUS: '-',
      STAR: '*',
      SLASH: '/',
      PERCENT: '%',
      CARET: '^',
      AND: 'AND',
      OR: 'OR',
      IN: 'IN',
      CONTAINS: 'CONTAINS',
      STARTS_WITH: 'STARTS_WITH',
      ENDS_WITH: 'ENDS_WITH',
      IS: 'IS',
      ANY: 'ANY',
      ALL: 'ALL',
      NOT: 'NOT'
    };
    return ops[token.type] || token.value;
  }

  private isKeyword(): boolean {
    const keywords = ['WHERE', 'SET', 'ORDER', 'GROUP', 'LIMIT', 'OFFSET', 'AND', 'OR', 'BY', 'FROM', 'JOIN', 'UNION'];
    return keywords.includes(this.current().type);
  }

  private current(): Token {
    return this.tokens[this.position] || { type: 'EOF', value: '', position: -1, line: -1, column: -1, offset: -1 };
  }

  private peek(): Token {
    return this.tokens[this.position + 1] || { type: 'EOF', value: '', position: -1, line: -1, column: -1, offset: -1 };
  }

  private advance(): Token {
    const token = this.current();
    this.position++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type} (${token.value}) at line ${token.line}, column ${token.column}`);
    }
    return this.advance();
  }
}
