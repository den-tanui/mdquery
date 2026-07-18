// src/types.ts

// Token types
export type TokenType =
  | 'SELECT' | 'UPDATE' | 'CREATE' | 'DELETE'
  | 'WHERE' | 'SET' | 'ORDER' | 'BY' | 'GROUP' | 'HAVING'
  | 'LIMIT' | 'OFFSET' | 'DISTINCT'
  | 'AND' | 'OR' | 'NOT' | 'IN' | 'CONTAINS' | 'ANY' | 'ALL'
  | 'EXISTS' | 'IS' | 'EMPTY'
  | 'BEFORE' | 'AFTER' | 'DENY' | 'RUN'
  | 'IDENTIFIER' | 'NUMBER' | 'STRING' | 'BOOLEAN'
  | 'COMMA' | 'DOT' | 'LPAREN' | 'RPAREN' | 'LBRACKET' | 'RBRACKET'
  | 'EQUALS' | 'NOT_EQUALS' | 'LT' | 'GT' | 'LTE' | 'GTE'
  | 'PLUS' | 'MINUS' | 'STAR' | 'PIPE'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// AST Node types
export type ASTNode =
  | SelectNode
  | UpdateNode
  | CreateNode
  | DeleteNode
  | TriggerNode;

export interface SelectNode {
  type: 'select';
  fields: (string | AggregateNode)[];
  distinct?: boolean;
  where?: WhereNode;
  groupBy?: string[];
  orderBy?: OrderByNode[];
  limit?: number;
  offset?: number;
}

export interface UpdateNode {
  type: 'update';
  where: WhereNode;
  set: Record<string, ValueNode>;
}

export interface CreateNode {
  type: 'create';
  fields: Record<string, ValueNode>;
}

export interface DeleteNode {
  type: 'delete';
  where: WhereNode;
}

export interface TriggerNode {
  type: 'trigger';
  event: 'before' | 'after';
  operation: 'create' | 'update' | 'delete';
  where?: WhereNode;
  action: TriggerAction;
}

export type TriggerAction = DenyAction | UpdateNode | CreateNode | RunAction;

export interface DenyAction {
  type: 'deny';
  message: string;
}

export interface RunAction {
  type: 'run';
  command: string;
}

export interface WhereNode {
  type: 'and' | 'or' | 'comparison' | 'exists' | 'in' | 'any' | 'all';
  left?: WhereNode | FieldNode;
  op?: string;
  right?: WhereNode | ValueNode | SelectNode;
  field?: string;
  subquery?: SelectNode;
}

export interface FieldNode {
  type: 'field';
  name: string;
}

export type ValueNode =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null'; value: null }
  | { type: 'array'; items: ValueNode[] }
  | BuiltinNode
  | SelectNode;

export interface BuiltinNode {
  type: 'builtin';
  name: string;
  args: (FieldNode | ValueNode)[];
}

export interface AggregateNode {
  type: 'aggregate';
  func: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field: string;
}

export interface OrderByNode {
  field: string;
  direction: 'asc' | 'desc';
}

// Execution types
export interface QueryOptions {
  dir?: string;
  files?: string[];
  query: string;
  context?: Record<string, any>;
  triggers?: TriggerNode[];
  format?: 'json' | 'table' | 'csv';
}

export interface QueryResult {
  type: 'select' | 'update' | 'create' | 'delete';
  data?: Record<string, any>[];
  count?: number;
  updated?: number;
  created?: number;
  deleted?: number;
  id?: string;
  format?: 'json' | 'table' | 'csv';
}

// Document type
export interface Document {
  id: string;
  title: string;
  description: string;
  filepath: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

// Schema type
export interface FieldSpec {
  type: 'text' | 'int' | 'boolean' | 'date' | 'datetime' | 'enum' | 'stringList' | 'taskIdList';
  caption?: string;
  required?: boolean;
  hidden?: boolean;
  values?: { value: string; label: string; visual?: string }[];
  default?: any;
}

export interface Schema {
  fields: Record<string, FieldSpec>;
  fieldOrder: string[];
}
