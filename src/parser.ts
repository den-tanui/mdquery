// src/parser.ts
import { Token, ASTNode, SelectNode, WhereNode, ValueNode, FieldNode, AggregateNode, OrderByNode, BuiltinNode } from './types';
import { Lexer } from './lexer';

export class Parser {
  private tokens: Token[];
  private position: number = 0;

  constructor(input: string) {
    this.tokens = new Lexer(input).tokenize();
  }

  parse(): ASTNode {
    const token = this.current();

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

    return ast;
  }

  private parseTrigger(): any {
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

    const node: any = {
      type: 'trigger',
      event,
      operation
    };

    // WHERE
    if (this.current().type === 'WHERE') {
      this.advance();
      node.where = this.parseWhere();
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

  private parseSelect(): SelectNode {
    this.advance(); // skip SELECT

    const node: SelectNode = { type: 'select', fields: ['*'] };

    // DISTINCT
    if (this.current().type === 'DISTINCT') {
      node.distinct = true;
      this.advance();
    }

    // Parse fields if not a keyword
    if (this.current().type !== 'EOF' && !this.isKeyword()) {
      node.fields = this.parseFieldList();
    }

    // WHERE
    if (this.current().type === 'WHERE') {
      this.advance();
      node.where = this.parseWhere();
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
      node.having = this.parseWhere();
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
    if (this.current().type === 'IDENTIFIER' && this.current().value.toLowerCase() === 'join') {
      this.advance();
      const table = this.expect('IDENTIFIER').value;
      this.expect('ON');
      const on = this.parseWhere();
      node.join = { type: 'join', table, on };
    }

    return node;
  }

  private parseUpdate(): any {
    this.advance(); // skip UPDATE
    const node: any = { type: 'update', set: {} };

    // WHERE
    if (this.current().type === 'WHERE') {
      this.advance();
      node.where = this.parseWhere();
    }

    // SET
    if (this.current().type === 'SET') {
      this.advance();
      node.set = this.parseSetClause();
    }

    return node;
  }

  private parseCreate(): any {
    this.advance(); // skip CREATE
    const node: any = { type: 'create', fields: {} };

    node.fields = this.parseSetClause();

    return node;
  }

  private parseDelete(): any {
    this.advance(); // skip DELETE
    const node: any = { type: 'delete' };

    // WHERE
    if (this.current().type === 'WHERE') {
      this.advance();
      node.where = this.parseWhere();
    }

    return node;
  }

  private parseFieldList(): (string | AggregateNode)[] {
    const fields: (string | AggregateNode)[] = [];

    while (this.current().type !== 'EOF' && !this.isKeyword()) {
      const token = this.current();

      if (token.type === 'IDENTIFIER') {
        if (this.peek().type === 'LPAREN') {
          // Check if it's an aggregate function or regular function
          const func = token.value.toLowerCase();
          if (['count', 'sum', 'avg', 'min', 'max'].includes(func)) {
            // Aggregate function
            this.advance(); // skip function name
            this.expect('LPAREN');
            let field = '*';
            if (this.current().type === 'IDENTIFIER') {
              field = this.current().value;
              this.advance();
            } else if (this.current().type === 'STAR') {
              this.advance();
            }
            this.expect('RPAREN');
            fields.push({ type: 'aggregate', func: func as any, field });
          } else {
            // Regular function call (like next_date) - treat as field name
            this.advance(); // skip function name
            this.expect('LPAREN');
            // Skip arguments
            let parenDepth = 1;
            while (this.current().type !== 'EOF' && parenDepth > 0) {
              if (this.current().type === 'LPAREN') parenDepth++;
              if (this.current().type === 'RPAREN') parenDepth--;
              this.advance();
            }
            // Use the function call as a field name for now
            fields.push(`${token.value}()`);
          }
        } else {
          fields.push(token.value);
          this.advance();
        }
      } else if (token.type === 'STAR') {
        fields.push('*');
        this.advance();
      } else if (token.type === 'RPAREN') {
        break;
      }

      if (this.current().type === 'COMMA') {
        this.advance();
      } else {
        break;
      }
    }

    return fields;
  }

  private parseWhere(): WhereNode {
    return this.parseOrExpression();
  }

  private parseOrExpression(): WhereNode {
    let left = this.parseAndExpression();

    while (this.current().type === 'OR') {
      this.advance();
      const right = this.parseAndExpression();
      left = { type: 'or', left, right };
    }

    return left;
  }

  private parseAndExpression(): WhereNode {
    let left = this.parseComparison();

    while (this.current().type === 'AND') {
      this.advance();
      const right = this.parseComparison();
      left = { type: 'and', left, right };
    }

    return left;
  }

  private parseArrayCondition(): WhereNode {
    const token = this.current();
    
    // Handle simple comparisons like = "value" or contains "value"
    if (token.type === 'EQUALS' || token.type === 'NOT_EQUALS' || 
        token.type === 'LT' || token.type === 'GT' || 
        token.type === 'LTE' || token.type === 'GTE') {
      const op = this.getOperator();
      this.advance();
      const value = this.parseValue();
      return { type: 'comparison', field: '', op, value };
    }
    
    if (token.type === 'CONTAINS' || token.type === 'STARTS_WITH' || token.type === 'ENDS_WITH') {
      const op = token.value;
      this.advance();
      const value = this.parseValue();
      return { type: 'comparison', field: '', op, value };
    }
    
    // Fall back to regular comparison parsing
    return this.parseComparison();
  }

  private parseComparison(): WhereNode {
    const token = this.current();

    // NOT
    if (token.type === 'NOT') {
      this.advance();
      const expr = this.parseComparison();
      return { type: 'not', expr };
    }

    // EXISTS subquery
    if (token.type === 'EXISTS') {
      this.advance();
      this.expect('LPAREN');
      const subquery = this.parseSelect();
      this.expect('RPAREN');
      return { type: 'exists', subquery };
    }

    // Handle aggregate functions in comparisons (e.g., count(*) > 1)
    if (token.type === 'IDENTIFIER' && this.peek().type === 'LPAREN') {
      const func = token.value.toLowerCase();
      if (['count', 'sum', 'avg', 'min', 'max'].includes(func)) {
        this.advance(); // skip function name
        this.expect('LPAREN');
        let field = '*';
        if (this.current().type === 'IDENTIFIER') {
          field = this.current().value;
          this.advance();
        } else if (this.current().type === 'STAR') {
          this.advance();
        }
        this.expect('RPAREN');
        
        const opToken = this.current();
        const op = this.getOperator();
        this.advance();
        
        const value = this.parseValue();
        return { type: 'comparison', field: `${func}(${field})`, fieldPath: `${func}(${field})`, op, value };
      }
    }

    // field operator value (including new.field, old.field)
    if (token.type === 'IDENTIFIER') {
      let field = token.value;
      let fieldPath = token.value;
      this.advance();

      // Handle new.field or old.field
      if (this.current().type === 'DOT' && this.peek().type === 'IDENTIFIER') {
        const prefix = field;
        this.advance(); // skip dot
        const fieldPart = this.expect('IDENTIFIER').value;
        field = fieldPart;
        fieldPath = `${prefix}.${fieldPart}`;
      }

      // ANY/ALL array operators
      if (this.current().type === 'ANY' || this.current().type === 'ALL') {
        const arrayOp = this.current().value;
        this.advance();
        
        // Parse the condition for each element
        // The condition should be a comparison like = "backend" or contains "ui"
        const condition = this.parseArrayCondition();
        
        return { type: 'array_comparison', field, fieldPath, arrayOp, arrayCondition: condition };
      }

      // IS [NOT] EMPTY
      if (this.current().type === 'IS') {
        this.advance();
        const notEmpty = this.current().type === 'NOT';
        if (notEmpty) this.advance();
        this.expect('EMPTY');
        return { type: 'comparison', field, fieldPath, op: notEmpty ? 'is_not_empty' : 'is_empty', value: { type: 'null', value: null } };
      }

      // IN list
      if (this.current().type === 'IN') {
        this.advance();
        this.expect('LPAREN');
        const items: ValueNode[] = [];
        while (this.current().type !== 'RPAREN') {
          items.push(this.parseValue());
          if (this.current().type === 'COMMA') this.advance();
        }
        this.expect('RPAREN');
        return { type: 'in', field, fieldPath, value: { type: 'array', items } };
      }

      // CONTAINS, STARTS_WITH, ENDS_WITH
      if (this.current().type === 'CONTAINS' || this.current().type === 'STARTS_WITH' || this.current().type === 'ENDS_WITH') {
        const op = this.current().value;
        this.advance();
        const value = this.parseValue();
        return { type: 'comparison', field, fieldPath, op, value };
      }

      const opToken = this.current();
      const op = this.getOperator();
      this.advance();

      const value = this.parseValue();
      return { type: 'comparison', field, fieldPath, op, value };
    }

    throw new Error(`Unexpected token in WHERE: ${token.value}`);
  }

  private parseValue(): ValueNode {
    const token = this.current();

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

    if (token.type === 'IDENTIFIER' && token.value.toLowerCase() === 'null') {
      this.advance();
      return { type: 'null', value: null };
    }

    if (token.type === 'IDENTIFIER' && this.peek().type === 'LPAREN') {
      return this.parseBuiltin();
    }

    if (token.type === 'IDENTIFIER') {
      this.advance();
      return { type: 'string', value: token.value };
    }

    throw new Error(`Unexpected token in value: ${token.value}`);
  }

  private parseBuiltin(): BuiltinNode {
    const name = this.expect('IDENTIFIER').value;
    this.expect('LPAREN');
    const args: (FieldNode | ValueNode)[] = [];

    while (this.current().type !== 'RPAREN') {
      if (this.current().type === 'IDENTIFIER') {
        args.push({ type: 'field', name: this.current().value });
        this.advance();
      } else {
        args.push(this.parseValue());
      }
      if (this.current().type === 'COMMA') this.advance();
    }

    this.expect('RPAREN');
    return { type: 'builtin', name, args };
  }

  private parseSetClause(): Record<string, ValueNode> {
    const set: Record<string, ValueNode> = {};

    while (this.current().type !== 'EOF') {
      if (this.current().type !== 'IDENTIFIER') break;
      
      const field = this.expect('IDENTIFIER').value;
      this.expect('EQUALS');
      set[field] = this.parseValue();

      if (this.current().type === 'COMMA') {
        this.advance();
      } else if (this.current().type === 'IDENTIFIER' && this.peek().type === 'EQUALS') {
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

  private parseOrderBy(): OrderByNode[] {
    const items: OrderByNode[] = [];

    while (true) {
      const field = this.expect('IDENTIFIER').value;
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

  private getOperator(): string {
    const token = this.current();
    const ops: Record<string, string> = {
      EQUALS: '=',
      NOT_EQUALS: '!=',
      LT: '<',
      GT: '>',
      LTE: '<=',
      GTE: '>=',
    };
    return ops[token.type] || token.value;
  }

  private isKeyword(): boolean {
    const keywords = ['WHERE', 'SET', 'ORDER', 'GROUP', 'LIMIT', 'OFFSET', 'AND', 'OR', 'BY'];
    return keywords.includes(this.current().type);
  }

  private current(): Token {
    return this.tokens[this.position] || { type: 'EOF', value: '', position: -1 };
  }

  private peek(): Token {
    return this.tokens[this.position + 1] || { type: 'EOF', value: '', position: -1 };
  }

  private advance(): Token {
    const token = this.current();
    this.position++;
    return token;
  }

  private expect(type: string): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type} (${token.value})`);
    }
    return this.advance();
  }
}
