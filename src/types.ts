// src/types.ts

// Token types
export type TokenType =
  | 'SELECT'
  | 'UPDATE'
  | 'CREATE'
  | 'DELETE'
  | 'WHERE'
  | 'SET'
  | 'ORDER'
  | 'BY'
  | 'GROUP'
  | 'HAVING'
  | 'FROM'
  | 'LIMIT'
  | 'OFFSET'
  | 'DISTINCT'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'IN'
  | 'CONTAINS'
  | 'MATCHES'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'ANY'
  | 'ALL'
  | 'EXISTS'
  | 'IS'
  | 'EMPTY'
  | 'HAS'
  | 'BEFORE'
  | 'AFTER'
  | 'DENY'
  | 'RUN'
  | 'AS'
  | 'LEFT'
  | 'RIGHT'
  | 'INNER'
  | 'CROSS'
  | 'JOIN'
  | 'ON'
  | 'UNION'
  | 'IDENTIFIER'
  | 'NUMBER'
  | 'STRING'
  | 'BOOLEAN'
  | 'REGEX'
  | 'COMMA'
  | 'DOT'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'SEMICOLON'
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'LT'
  | 'GT'
  | 'LTE'
  | 'GTE'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  | 'CARET'
  | 'PIPE'
  | 'COLON'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
  line: number;
  column: number;
  offset: number;
}

// AST Node types for Pratt parser
export type ASTNode =
  | SelectStatement
  | UpdateStatement
  | CreateStatement
  | DeleteStatement
  | TriggerStatement
  | PipeNode
  | UnionNode;

export type Expression =
  | BinaryOpNode
  | UnaryOpNode
  | FunctionCallNode
  | MethodCallNode
  | ArrayIndexNode
  | MapIndexNode
  | FieldNode
  | ValueNode
  | ParenNode
  | WildcardNode
  | SubqueryNode
  | { type: 'exists'; subquery: SelectStatement };

// Statement nodes
export interface SelectStatement {
  type: 'select';
  fields: Expression[];
  distinct?: boolean;
  from?: FromClause;
  where?: Expression;
  groupBy?: string[];
  having?: Expression;
  orderBy?: OrderByNode[];
  limit?: number;
  offset?: number;
  join?: JoinNode;
}

export interface UpdateStatement {
  type: 'update';
  where?: Expression;
  set: Record<string, { value: Expression; type?: string }>;
}

export interface CreateStatement {
  type: 'create';
  fields: Record<string, { value: Expression; type?: string }>;
}

export interface DeleteStatement {
  type: 'delete';
  where?: Expression;
}

export interface TriggerStatement {
  type: 'trigger';
  event: 'before' | 'after';
  operation: 'create' | 'update' | 'delete';
  where?: Expression;
  action: TriggerAction;
}

export interface PipeNode {
  type: 'pipe';
  expr: ASTNode;
  fn: string;
  args?: ValueNode[];
}

export interface UnionNode {
  type: 'union';
  queries: SelectStatement[];
  all: boolean;
}

// Expression nodes
export interface BinaryOpNode {
  type: 'binary_op';
  left: Expression;
  op: string;
  right: Expression;
}

export interface UnaryOpNode {
  type: 'unary_op';
  op: string;
  operand: Expression;
}

export interface FunctionCallNode {
  type: 'function_call';
  name: string;
  args: Expression[];
  alias?: string;
}

export interface MethodCallNode {
  type: 'method_call';
  object: Expression;
  method: string;
  args: Expression[];
  alias?: string;
}

export interface ArrayIndexNode {
  type: 'array_index';
  object: Expression;
  index: Expression;
}

export interface MapIndexNode {
  type: 'map_index';
  object: Expression;
  key: Expression;
}

export interface FieldNode {
  type: 'field';
  name: string;
  alias?: string;
}

export interface WildcardNode {
  type: 'wildcard';
}

export interface ParenNode {
  type: 'paren';
  expression: Expression;
  alias?: string;
}

export interface SubqueryNode {
  type: 'subquery';
  query: SelectStatement;
}

// Value node types
export type ValueNode =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null'; value: null }
  | { type: 'empty' }
  | { type: 'regex'; value: string }
  | { type: 'array'; items: ValueNode[] }
  | FieldNode
  | SubqueryNode;

// Other node types
export interface JoinNode {
  type: 'join';
  joinType: 'left' | 'right' | 'inner' | 'cross';
  left: FromClause;
  right: FromClause;
  on?: Expression;
}

export interface FromClause {
  table: string;
  alias?: string;
}

export interface OrderByNode {
  field: Expression;
  direction: 'asc' | 'desc';
}

// Trigger actions
export type TriggerAction = DenyAction | UpdateStatement | CreateStatement | RunAction;

export interface DenyAction {
  type: 'deny';
  message: string;
}

export interface RunAction {
  type: 'run';
  command: string;
}

// Execution types
export interface QueryOptions {
  dirs?: string[];
  files?: string[];
  query: string;
  context?: Record<string, any>;
  triggers?: TriggerStatement[];
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
  meta?: QueryMeta;
}

export interface FileError {
  path: string;
  error: string;
  phase: 'read' | 'prefilter' | 'evaluate';
}

export interface QueryTimings {
  list: number;
  read: number;
  prefilter: number;
  evaluate: number;
  total: number;
}

export interface QueryMeta {
  filesSearched: number;
  filesMatched: number;
  timings: QueryTimings;
  errors: FileError[];
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

// Hooks for extending Executor behavior
export interface ExecutorHooks {
  // Transform AST before execution
  onBeforeExecute?: (ast: ASTNode) => ASTNode;

  // Validate/coerce values during evaluation
  onEvaluateValue?: (value: any, field: string) => any;

  // Validate before writing (create/update/delete)
  onBeforeWrite?: (file: any, operation: 'create' | 'update' | 'delete') => void;

  // Transform after reading
  onAfterRead?: (file: any) => any;

  // Handle custom builtin function calls
  onBuiltinCall?: (name: string, args: any[], context?: Record<string, any>) => any;
}

// ===== Body element data types (body-syntax design, 2026-08-17) =====

/** mdast source position */
export interface ElementPosition {
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}

export interface HeadingElement {
  title: string;
  level: number;
  content?: string;
  position?: ElementPosition;
}

export interface LinkElement {
  text: string;
  url: string;
  position?: ElementPosition;
}

export interface LinkRefElement {
  text: string;
  identifier: string;
  position?: ElementPosition;
}

export interface ImageElement {
  alt: string;
  url: string;
  position?: ElementPosition;
}

export interface ImageRefElement {
  alt: string;
  identifier: string;
  position?: ElementPosition;
}

export interface CodeElement {
  lang?: string;
  content: string;
  position?: ElementPosition;
}

export interface InlineCodeElement {
  content: string;
  position?: ElementPosition;
}

export interface TableCellElement {
  content: string;
  position?: ElementPosition;
}

export interface TableRowElement {
  cells: TableCellElement[];
  position?: ElementPosition;
}

export interface TableElement {
  headers: TableCellElement[];
  rows: TableRowElement[];
  position?: ElementPosition;
}

export interface ListItemElement {
  content: string;
  checked: boolean | null;
  children: ListItemElement[];
  position?: ElementPosition;
}

export interface ListElement {
  ordered: boolean;
  items: ListItemElement[];
  position?: ElementPosition;
}

export interface BlockquoteElement {
  content: string;
  position?: ElementPosition;
}

export interface ParagraphElement {
  content: string;
  position?: ElementPosition;
}

export interface HtmlElement {
  content: string;
  position?: ElementPosition;
}

export interface EmphasisElement {
  content: string;
  position?: ElementPosition;
}

export interface StrongElement {
  content: string;
  position?: ElementPosition;
}

export interface DeleteElement {
  content: string;
  position?: ElementPosition;
}

export interface BreakElement {
  position?: ElementPosition;
}

export interface FootnoteRefElement {
  label: string;
  position?: ElementPosition;
}

export interface DefinitionElement {
  identifier: string;
  url: string;
  title?: string;
  position?: ElementPosition;
}

export interface TocEntry {
  level: number;
  title: string;
}

/**
 * BodyIndex — lazy markdown body index. Constructed on first body-element
 * access, then cached on the FileData. One AST walk builds every index.
 */
export interface BodyIndex {
  headings: { [level: number]: HeadingElement[] };
  links: LinkElement[];
  linkRefs: LinkRefElement[];
  images: ImageElement[];
  imageRefs: ImageRefElement[];
  code: CodeElement[];
  inlineCode: InlineCodeElement[];
  tables: TableElement[];
  tableRows: TableRowElement[];
  tableCells: TableCellElement[];
  lists: ListElement[];
  listItems: ListItemElement[];
  blockquotes: BlockquoteElement[];
  paragraphs: ParagraphElement[];
  html: HtmlElement[];
  emphasis: EmphasisElement[];
  strong: StrongElement[];
  del: DeleteElement[];
  breaks: BreakElement[];
  footnotes: FootnoteRefElement[];
  definitions: DefinitionElement[];
  toc: TocEntry[];
}
