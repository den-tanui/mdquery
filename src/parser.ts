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

    if (token.type === 'SELECT') return this.parseSelect();
    if (token.type === 'UPDATE') return this.parseUpdate();
    if (token.type === 'CREATE') return this.parseCreate();
    if (token.type === 'DELETE') return this.parseDelete();

    throw new Error(`Unexpected token: ${token.value}`);
  }

  private parseSelect(): SelectNode {
    this.advance(); // skip SELECT

    const node: SelectNode = { type: 'select', fields: ['*'] };

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
          // Aggregate function
          const func = token.value.toLowerCase();
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

  private parseComparison(): WhereNode {
    const token = this.current();

    // EXISTS subquery
    if (token.type === 'EXISTS') {
      this.advance();
      this.expect('LPAREN');
      const subquery = this.parseSelect();
      this.expect('RPAREN');
      return { type: 'exists', subquery };
    }

    // IN list
    if (token.type === 'IDENTIFIER' && this.peek().type === 'IN') {
      const field = token.value;
      this.advance(); // skip field
      this.advance(); // skip IN
      this.expect('LPAREN');
      const items: ValueNode[] = [];
      while (this.current().type !== 'RPAREN') {
        items.push(this.parseValue());
        if (this.current().type === 'COMMA') this.advance();
      }
      this.expect('RPAREN');
      return { type: 'in', field, value: { type: 'array', items } };
    }

    // field operator value
    if (token.type === 'IDENTIFIER') {
      const field = token.value;
      this.advance();

      const opToken = this.current();
      const op = this.getOperator();
      this.advance();

      const value = this.parseValue();
      return { type: 'comparison', field, op, value };
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

    while (this.current().type !== 'EOF' && !this.isKeyword()) {
      const field = this.expect('IDENTIFIER').value;
      this.expect('EQUALS');
      set[field] = this.parseValue();

      if (this.current().type === 'COMMA') {
        this.advance();
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
