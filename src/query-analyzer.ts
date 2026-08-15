// src/query-analyzer-minimal.ts

import {
  ASTNode, Expression, SelectStatement, BinaryOpNode, UnaryOpNode,
  FunctionCallNode, FieldNode, ValueNode, MethodCallNode, ArrayIndexNode,
  MapIndexNode, SubqueryNode
} from './types';

interface PushdownPredicate {
  field: string;
  op: string;
  value: any;
  canPushdown: boolean;
}

interface LazyLoadingAnalysis {
  requiresContent: boolean;
  requiresMetadata: boolean;
  builtins: string[];
  contentFields: string[];
}

interface ExecutionPlan {
  pushdownPredicates: PushdownPredicate[];
  lazyLoading: LazyLoadingAnalysis;
  executionOrder: string[];
}

// ===== Scalar inference =====
// Static return-type inference for select expressions. Table/CSV output
// requires scalar columns, so expressions that resolve to a map or an array
// of maps are rejected before any file I/O with a shape-aware error message.

export type ScalarInference =
  | { kind: 'scalar' }
  | { kind: 'array-of-scalars' }
  | { kind: 'map'; shape: string; suggestions: string[] }
  | { kind: 'array-of-maps'; shape: string; suggestions: string[] };

const BUILTIN_SHAPES: Record<string, ScalarInference> = {
  content: { kind: 'scalar' },
  fields: { kind: 'map', shape: '{field: value}', suggestions: ["fields().keys()", "fields().values()"] },
  file: { kind: 'map', shape: '{abspath, mtime, atime, ctime, owner, group, size, mode}', suggestions: ["file().mtime", "file().abspath", "file().size"] },
  links: { kind: 'array-of-maps', shape: '{text, url, position, paragraph?, section?}', suggestions: ["links().map('url')", "links().map('text')", "links().count()"] },
  images: { kind: 'array-of-maps', shape: '{alt, url, position, paragraph?, section?}', suggestions: ["images().map('url')", "images().map('alt')"] },
  codeblocks: { kind: 'array-of-maps', shape: '{content, lang?, position, paragraph?, section?}', suggestions: ["codeblocks().map('lang')", "codeblocks().map('content')"] },
  section: { kind: 'map', shape: '{title, level, position, hierarchy, content}', suggestions: ['section("name").title', 'section("name").content'] },
  sections: { kind: 'array-of-maps', shape: '{title, level, position, hierarchy, content}', suggestions: ["sections().map('title')", "sections().first().title", "sections().count()"] },
  toc: { kind: 'array-of-maps', shape: '{level, title}', suggestions: ["toc().map('title')", "toc().map('level')"] },
  grep: { kind: 'array-of-maps', shape: '{line, column, text, captures, section, sentence?, paragraph?, ancestors?}', suggestions: ["grep(/x/).count()", "grep(/x/).map('text')", "grep(/x/).first().line"] },
  has_section: { kind: 'scalar' }
};

export function inferScalarType(expr: Expression): ScalarInference {
  switch (expr.type) {
    case 'field': return { kind: 'scalar' };
    case 'function_call': {
      // fields('values') returns an array of scalars (legacy arg form)
      if (expr.name === 'fields' && expr.args.length > 0 &&
          expr.args[0].type === 'string' && expr.args[0].value === 'values') {
        return { kind: 'array-of-scalars' };
      }
      return BUILTIN_SHAPES[expr.name] ?? { kind: 'scalar' };
    }
    case 'method_call': return inferMethodType(expr);
    case 'array_index': return inferScalarType(expr.object);
    case 'map_index': return { kind: 'scalar' };
    case 'binary_op':
    case 'unary_op':
    case 'wildcard':
    case 'subquery':
    case 'exists':
      return { kind: 'scalar' };
    case 'paren': return inferScalarType(expr.expression);
    default: return { kind: 'scalar' };
  }
}

function inferMethodType(expr: MethodCallNode): ScalarInference {
  const objectType = inferScalarType(expr.object);
  switch (expr.method) {
    case 'count':
    case 'length':
    case 'join':
      return { kind: 'scalar' };
    case 'keys':
    case 'values':
      return { kind: 'array-of-scalars' };
    case 'map':
      return { kind: 'array-of-scalars' };
    case 'first':
    case 'last':
      // Element of the array: array-of-maps → map; array-of-scalars → scalar
      return objectType.kind === 'array-of-maps'
        ? { kind: 'map', shape: objectType.shape, suggestions: objectType.suggestions }
        : { kind: 'scalar' };
    case 'filter':
    case 'where':
    case 'sort':
    case 'slice':
    case 'flatten':
    case 'unique':
      return objectType;
    case 'entries':
      return { kind: 'array-of-maps', shape: '[key, value]', suggestions: ["entries().map(_.first())"] };
    default:
      return { kind: 'scalar' };
  }
}

export class QueryAnalyzer {
  constructor(private ast: ASTNode) {}

  analyze(): ExecutionPlan {
    const pushdownPredicates = this.extractPushdownPredicates();
    const lazyLoading = this.analyzeLazyLoading();
    const executionOrder = this.createExecutionOrder();

    return {
      pushdownPredicates,
      lazyLoading,
      executionOrder
    };
  }

  private extractPushdownPredicates(): PushdownPredicate[] {
    const predicates: PushdownPredicate[] = [];

    if (this.ast.type !== 'select' || !this.ast.where) {
      return predicates;
    }

    this.extractPredicatesFromExpression(this.ast.where, predicates);

    return predicates;
  }

  private extractPredicatesFromExpression(
    expr: Expression,
    predicates: PushdownPredicate[],
    negated: boolean = false
  ): void {
    switch (expr.type) {
      case 'binary_op':
        this.extractBinaryOpPredicates(expr, predicates, negated);
        break;
      case 'unary_op':
        this.extractUnaryOpPredicates(expr, predicates, negated);
        break;
    }
  }

  // Extract predicates from binary operations
  private extractBinaryOpPredicates(
    expr: BinaryOpNode,
    predicates: PushdownPredicate[],
    negated: boolean
  ): void {
    const { left, op, right } = expr;

    // Handle field = value patterns
    if (left.type === 'field' && this.isValueNode(right)) {
      const field = left.name;
      const value = this.getValue(right);
      const effectiveOp = negated ? this.negateOperator(op) : op;
      
      predicates.push({
        field,
        op: effectiveOp,
        value,
        canPushdown: true
      });
    }
    // Handle (not field) = value patterns
    else if (left.type === 'unary_op' && left.op === 'NOT' && 
             left.operand.type === 'field' && this.isValueNode(right)) {
      const field = left.operand.name;
      const value = this.getValue(right);
      const effectiveOp = negated ? this.negateOperator('!=') : '!=';
      
      predicates.push({
        field,
        op: effectiveOp,
        value,
        canPushdown: true
      });
    }
    // Handle value = field patterns (reverse operands)
    else if (this.isValueNode(left) && right.type === 'field' && 
             (op === '=' || op === '!=' || op === '>' || op === '<' || op === '>=' || op === '<=')) {
      const field = right.name;
      const value = this.getValue(left);
      const effectiveOp = negated ? this.negateOperator(this.reverseOperator(op)) : this.reverseOperator(op);
      
      predicates.push({
        field,
        op: effectiveOp,
        value,
        canPushdown: true
      });
    }
    // Handle AND/OR combinations
    else if (op === 'AND' || op === 'OR') {
      this.extractPredicatesFromExpression(left, predicates, negated);
      this.extractPredicatesFromExpression(right, predicates, negated);
    }
    // Handle complex expressions that can't be pushed down
    else {
      // Mark as non-pushdown but still extract simple predicates from children
      this.extractPredicatesFromExpression(left, predicates, negated);
      this.extractPredicatesFromExpression(right, predicates, negated);
    }
  }

  private extractUnaryOpPredicates(
    expr: UnaryOpNode,
    predicates: PushdownPredicate[],
    negated: boolean
  ): void {
    if (expr.op === 'NOT') {
      this.extractPredicatesFromExpression(expr.operand, predicates, !negated);
    }
  }

  // Analyze which parts of the query require content loading
  private analyzeLazyLoading(): LazyLoadingAnalysis {
    const analysis: LazyLoadingAnalysis = {
      requiresContent: false,
      requiresMetadata: false,
      builtins: [],
      contentFields: []
    };

    if (this.ast.type !== 'select') {
      return analysis;
    }

    // Check fields for content-extraction builtins
    for (const field of this.ast.fields) {
      this.checkExpressionForContent(field, analysis);
    }

    // Check WHERE clause for content-extraction builtins
    if (this.ast.where) {
      this.checkExpressionForContent(this.ast.where, analysis);
    }

    // Check HAVING clause for metadata/content builtins
    if (this.ast.having) {
      this.checkExpressionForContent(this.ast.having, analysis);
    }

    // Check ORDER BY expressions for metadata/content builtins
    if (this.ast.orderBy) {
      for (const ob of this.ast.orderBy) {
        this.checkExpressionForContent(ob.field, analysis);
      }
    }

    // Check JOIN conditions for content-extraction builtins
    if (this.ast.join && this.ast.join.on) {
      this.checkExpressionForContent(this.ast.join.on, analysis);
    }

    return analysis;
  }

  // Check if expression requires content loading
  private checkExpressionForContent(
    expr: Expression,
    analysis: LazyLoadingAnalysis
  ): void {
    switch (expr.type) {
      case 'function_call':
        if (expr.name === 'file') {
          // file() needs metadata (stat), not content — separate flag
          analysis.requiresMetadata = true;
          break;
        }
        this.checkFunctionCallForContent(expr, analysis);
        break;
      case 'method_call':
        this.checkMethodCallForContent(expr, analysis);
        break;
      case 'field':
        this.checkFieldForContent(expr, analysis);
        break;
      case 'binary_op':
        this.checkExpressionForContent(expr.left, analysis);
        this.checkExpressionForContent(expr.right, analysis);
        break;
      case 'unary_op':
        this.checkExpressionForContent(expr.operand, analysis);
        break;
      case 'array_index':
        this.checkExpressionForContent(expr.object, analysis);
        this.checkExpressionForContent(expr.index, analysis);
        break;
      case 'map_index':
        this.checkExpressionForContent(expr.object, analysis);
        this.checkExpressionForContent(expr.key, analysis);
        break;
      case 'paren':
        this.checkExpressionForContent(expr.expression, analysis);
        break;
      case 'subquery':
        // Subqueries are handled separately
        break;
    }
  }

  // Check function calls for content-extraction builtins
  private checkFunctionCallForContent(
    expr: FunctionCallNode,
    analysis: LazyLoadingAnalysis
  ): void {
    const contentBuiltins = ['links', 'images', 'codeblocks', 'section', 'sections', 'grep', 'toc', 'content'];
    
    if (contentBuiltins.includes(expr.name)) {
      if (!analysis.builtins.includes(expr.name)) {
        analysis.builtins.push(expr.name);
      }
      analysis.requiresContent = true;
    }
    
    // Check arguments
    for (const arg of expr.args) {
      this.checkExpressionForContent(arg, analysis);
    }
  }

  // Check method calls for content-extraction builtins
  private checkMethodCallForContent(
    expr: MethodCallNode,
    analysis: LazyLoadingAnalysis
  ): void {
    // Check the object (which might be a function call)
    this.checkExpressionForContent(expr.object, analysis);
    
    // Check arguments
    for (const arg of expr.args) {
      this.checkExpressionForContent(arg, analysis);
    }
  }

  // Check bare field references for content/body fields. A `body` (or
  // `content`) field in a select field or WHERE predicate needs the body
  // loaded in fast mode — without this, FastFileOps.readFiles leaves body
  // undefined and the comparison throws. `content` is always loaded from raw,
  // but flagging it too is harmless and keeps the analysis uniform.
  private checkFieldForContent(
    expr: FieldNode,
    analysis: LazyLoadingAnalysis
  ): void {
    if (expr.name === 'body' || expr.name === 'content') {
      if (!analysis.contentFields.includes(expr.name)) {
        analysis.contentFields.push(expr.name);
      }
      analysis.requiresContent = true;
    }
  }

  // Create optimized execution order
  private createExecutionOrder(): string[] {
    const order: string[] = [];
    const lazyLoading = this.analyzeLazyLoading();
    
    // 1. File discovery with pushdown predicates
    order.push('file_discovery');
    
    // 2. Frontmatter loading and filtering
    order.push('frontmatter_loading');
    
    // 3. Apply remaining predicates that couldn't be pushed down
    if (this.ast.type === 'select' && this.ast.where) {
      order.push('post_filtering');
    }
    
    // 4. Content loading (only if needed)
    if (lazyLoading.requiresContent) {
      order.push('content_loading');
      
      // 5. Builtin execution
      for (const builtin of lazyLoading.builtins) {
        order.push(`builtin_${builtin}`);
      }
    }
    
    // 6. Field projection
    order.push('field_projection');
    
    // 7. Sorting, limiting, etc.
    if (this.ast.type === 'select' && this.ast.orderBy) {
      order.push('sorting');
    }
    if (this.ast.type === 'select' && this.ast.limit) {
      order.push('limiting');
    }
    
    return order;
  }

  private isValueNode(expr: Expression): expr is ValueNode {
    return ['string', 'number', 'boolean', 'null', 'empty', 'regex', 'array'].includes(expr.type);
  }

  // Get value from ValueNode
  private getValue(node: ValueNode): any {
    if (node.type === 'string' || node.type === 'number' || node.type === 'boolean') {
      return node.value;
    }
    if (node.type === 'null') {
      return null;
    }
    if (node.type === 'empty') {
      return undefined;
    }
    if (node.type === 'regex') {
      return new RegExp(node.value);
    }
    if (node.type === 'array') {
      return node.items.map(item => this.getValue(item));
    }
    return undefined;
  }

  private negateOperator(op: string): string {
    const negations: Record<string, string> = {
      '=': '!=',
      '!=': '=',
      '>': '<=',
      '<': '>=',
      '>=': '<',
      '<=': '>',
      'IN': 'NOT IN',
      'NOT IN': 'IN',
      'CONTAINS': 'NOT CONTAINS',
      'STARTS_WITH': 'NOT STARTS_WITH',
      'ENDS_WITH': 'NOT ENDS_WITH'
    };
    return negations[op] || op;
  }

  private reverseOperator(op: string): string {
    const reversals: Record<string, string> = {
      '>': '<',
      '<': '>',
      '>=': '<=',
      '<=': '>=',
    };
    return reversals[op] || op;
  }
}

// ===== Content prefilter tree =====
// The flat pushdownPredicates list loses AND/OR/NOT grouping, so the fast path
// cannot combine content predicates correctly (Bug 2). This tree preserves the
// boolean structure; NOT is pushed down to the leaves via De Morgan so every
// leaf carries its final (possibly negated) operator.

export type ContentPrefilterNode =
  | { type: 'and'; left: ContentPrefilterNode; right: ContentPrefilterNode }
  | { type: 'or'; left: ContentPrefilterNode; right: ContentPrefilterNode }
  | { type: 'leaf'; op: string; pattern: string };

const CONTENT_FIELDS = new Set(['content', 'body']);

const PREFILTERABLE_OPS = new Set([
  'CONTAINS', 'NOT CONTAINS',
  'STARTS_WITH', 'NOT STARTS_WITH',
  'ENDS_WITH', 'NOT ENDS_WITH',
  '=', '!=', 'IN', 'NOT IN'
]);

const NEGATE_OP: Record<string, string> = {
  '=': '!=', '!=': '=',
  'IN': 'NOT IN', 'NOT IN': 'IN',
  'CONTAINS': 'NOT CONTAINS', 'NOT CONTAINS': 'CONTAINS',
  'STARTS_WITH': 'NOT STARTS_WITH', 'NOT STARTS_WITH': 'STARTS_WITH',
  'ENDS_WITH': 'NOT ENDS_WITH', 'NOT ENDS_WITH': 'ENDS_WITH'
};

// Walk the WHERE AST and build a prefilter tree that preserves AND/OR/NOT
// structure. Returns null when the WHERE has no prefilterable content/body
// predicate — the caller then skips prefiltering entirely.
export function buildContentPrefilterTree(where: Expression | undefined): ContentPrefilterNode | null {
  if (!where) return null;
  return walkPrefilterExpr(where, false);
}

function walkPrefilterExpr(expr: Expression, negated: boolean): ContentPrefilterNode | null {
  switch (expr.type) {
    case 'binary_op': return walkPrefilterBinary(expr, negated);
    case 'unary_op': return expr.op === 'NOT' ? walkPrefilterExpr(expr.operand, !negated) : null;
    case 'paren': return walkPrefilterExpr(expr.expression, negated);
    default: return null;
  }
}

function walkPrefilterBinary(expr: BinaryOpNode, negated: boolean): ContentPrefilterNode | null {
  const { left, op, right } = expr;

  // AND/OR: De Morgan — NOT(A AND B) = NOT A OR NOT B
  if (op === 'AND' || op === 'OR') {
    const effective = negated ? (op === 'AND' ? 'OR' : 'AND') : op;
    return combinePrefilterNodes(effective, walkPrefilterExpr(left, negated), walkPrefilterExpr(right, negated));
  }

  // Legacy `not field op value` — the NOT wraps the field, negating the comparison
  if (left.type === 'unary_op' && left.op === 'NOT' && left.operand.type === 'field' && isPrefilterValueNode(right)) {
    const effectiveOp = negated ? op : (NEGATE_OP[op] ?? op);
    return contentPrefilterLeaf(left.operand.name, effectiveOp, right);
  }

  // field op value on a content/body field
  if (left.type === 'field' && isPrefilterValueNode(right)) {
    const effectiveOp = negated ? (NEGATE_OP[op] ?? op) : op;
    return contentPrefilterLeaf(left.name, effectiveOp, right);
  }

  // Non-content predicate (frontmatter field, function call, ...) — no prefilter
  return null;
}

function contentPrefilterLeaf(field: string, op: string, value: ValueNode): ContentPrefilterNode | null {
  if (!CONTENT_FIELDS.has(field)) return null;
  if (!PREFILTERABLE_OPS.has(op)) return null;

  // IN / NOT IN with an array value → expand to per-element leaves so each
  // element becomes a single grepts pattern.
  if (op === 'IN' && value.type === 'array') {
    return combinePrefilterNodes('OR', ...value.items.map(item => contentPrefilterLeaf(field, '=', item)));
  }
  if (op === 'NOT IN' && value.type === 'array') {
    return combinePrefilterNodes('AND', ...value.items.map(item => contentPrefilterLeaf(field, '!=', item)));
  }

  const pattern = prefilterPattern(value);
  if (pattern === null) return null;
  return { type: 'leaf', op, pattern };
}

// Extract the grepts search pattern from a value node. Only plain strings are
// prefiltered: number/boolean/regex values have executor semantics (boolean
// coercion or thrown errors) that a grepts search cannot safely approximate,
// so they are skipped rather than risking dropped candidates.
function prefilterPattern(value: ValueNode): string | null {
  if (value.type === 'string') return value.value;
  return null;
}

function isPrefilterValueNode(expr: Expression): expr is ValueNode {
  return ['string', 'number', 'boolean', 'null', 'empty', 'regex', 'array'].includes(expr.type);
}

// Combine prefilter branches. A null branch means "no content predicate": for
// AND it is the identity (universe); for OR it forces the universe — a
// non-content OR branch cannot be prefiltered without dropping candidates.
function combinePrefilterNodes(
  op: 'AND' | 'OR',
  ...nodes: (ContentPrefilterNode | null)[]
): ContentPrefilterNode | null {
  if (nodes.length === 0) return null;
  if (op === 'OR' && nodes.some(n => n === null)) return null;
  return nodes.reduce<ContentPrefilterNode | null>((acc, node) => {
    if (acc === null) return node;
    if (node === null) return acc;
    return op === 'AND'
      ? { type: 'and', left: acc, right: node }
      : { type: 'or', left: acc, right: node };
  }, null);
}