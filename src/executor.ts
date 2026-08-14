// src/executor.ts

import { Parser } from './parser';
import { FileOps, FileData, ReadOptions } from './files';
import { FastFileOps, FileIOAnalysis, isNegatedContentOp, applyContentPrefilter } from './file-io';
import { QueryAnalyzer, buildContentPrefilterTree, type ContentPrefilterNode } from './query-analyzer';
import { isAbsolute, join } from 'path';
import {
  ASTNode, Expression, SelectStatement, UpdateStatement, CreateStatement, DeleteStatement,
  BinaryOpNode, UnaryOpNode, FunctionCallNode, MethodCallNode, ArrayIndexNode, MapIndexNode,
  FieldNode, ValueNode, SubqueryNode, PipeNode, UnionNode, TriggerStatement, OrderByNode,
  JoinNode, ExecutorHooks, QueryResult
} from './types';
import { ContentExtractor } from './content-extractor';
import { TypeSystem } from './type-system';
import { copyToClipboard } from './clipboard';
import { Builtins } from './builtins';

// Trigger context for before/after trigger evaluation
export interface TriggerContext {
  old?: FileData | Record<string, any>;
  new?: FileData | Record<string, any>;
}

// Evaluation context
export interface EvaluationContext {
  file?: FileData | Record<string, any>;
  variables?: Record<string, any>;
}

const AGGREGATE_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'];

export class Executor {
  private dir: string;
  private context?: Record<string, any>;
  private triggerContext?: TriggerContext;
  private readOptions: ReadOptions;
  private hooks?: ExecutorHooks;
  private contentExtractorCache: Map<string, ContentExtractor> = new Map();
  private lastAst: ASTNode | null = null;

  constructor(
    dir: string,
    context?: Record<string, any>,
    triggerContext?: TriggerContext,
    readOptions: ReadOptions = {},
    hooks?: ExecutorHooks
  ) {
    this.dir = dir;
    this.context = context;
    this.triggerContext = triggerContext;
    this.readOptions = readOptions;
    this.hooks = hooks;
  }

  // Main execution method — parses the query and executes it
  async execute(query: string): Promise<QueryResult> {
    const ast = new Parser(query).parse();
    this.lastAst = ast;

    if (this.hooks?.onBeforeExecute) {
      this.hooks.onBeforeExecute(ast);
    }

    return this.executeAST(ast);
  }

  private async executeAST(ast: ASTNode): Promise<QueryResult> {
    switch (ast.type) {
      case 'select':
        return this.executeSelect(ast);
      case 'update':
        return this.executeUpdate(ast);
      case 'create':
        return this.executeCreate(ast);
      case 'delete':
        return this.executeDelete(ast);
      case 'pipe':
        return this.executePipe(ast);
      case 'union':
        return this.executeUnion(ast);
      case 'trigger':
        return this.executeTrigger(ast);
      default:
        throw new Error(`Unknown AST type: ${(ast as any).type}`);
    }
  }

  private async readFilesWithHooks(dir: string, options: ReadOptions = {}): Promise<FileData[]> {
    let files: FileData[];

    if (options.fast) {
      const paths = await FastFileOps.listFiles(dir, options);
      const analysis = this.analyzeCurrentQuery();
      const prefilterTree = this.contentPrefilterTree();
      if (prefilterTree) {
        const filtered = await applyContentPrefilter(
          paths,
          prefilterTree,
          (op, pattern) => FastFileOps.preFilterByContent(dir, paths, pattern, isNegatedContentOp(op))
        );
        files = await FastFileOps.readFiles(dir, filtered, analysis);
      } else {
        files = await FastFileOps.readFiles(dir, paths, analysis);
      }
    } else {
      files = await FileOps.readFiles(dir, options);
    }

    if (this.hooks?.onAfterRead) {
      return files.map(f => this.hooks!.onAfterRead!(f));
    }

    return files;
  }

  // Build the content prefilter tree for the most recently parsed query, or
  // null when there is nothing to prefilter (no WHERE, or no content/body
  // predicate that grepts can safely approximate). The tree preserves the
  // WHERE's AND/OR/NOT structure so the fast path can combine grepts results
  // correctly instead of using a flat bodyPredicates[0] list.
  private contentPrefilterTree(): ContentPrefilterNode | null {
    const ast = this.lastAst;
    if (!ast || !('where' in ast) || !ast.where) return null;
    return buildContentPrefilterTree(ast.where);
  }

  // Derive the FileIOAnalysis for the most recently parsed query so the fast
  // path knows whether to pre-filter by content and whether to load bodies.
  private analyzeCurrentQuery(): FileIOAnalysis {
    if (!this.lastAst) return { requiresContent: false, bodyPredicates: [] };
    const plan = new QueryAnalyzer(this.lastAst).analyze();
    return {
      requiresContent: plan.lazyLoading.requiresContent,
      bodyPredicates: plan.pushdownPredicates
        .filter(p => p.field === 'content' || p.field === 'body')
        .map(p => ({ field: p.field, op: p.op, value: String(p.value) }))
    };
  }

  // ===== SELECT =====

  private async executeSelect(node: SelectStatement): Promise<QueryResult> {
    let files = await this.readFilesWithHooks(this.dir, this.readOptions);

    // WHERE
    if (node.where) {
      files = files.filter(f => this.evaluateExpression(node.where!, { file: f }));
    }

    // GROUP BY
    if (node.groupBy) {
      files = this.groupBy(files, node.groupBy);
    }

    // HAVING
    if (node.having) {
      files = files.filter(f => this.evaluateExpression(node.having!, { file: f }));
    }

    // ORDER BY
    if (node.orderBy) {
      files = this.orderBy(files, node.orderBy);
    }

    // LIMIT
    if (node.limit) {
      files = files.slice(0, node.limit);
    }

    // OFFSET
    if (node.offset) {
      files = files.slice(node.offset);
    }

    // JOIN
    if (node.join) {
      files = await this.executeJoin(files, node.join);
    }

    // DISTINCT
    if (node.distinct) {
      files = this.distinct(files, node.fields);
    }

    // Projection
    const data = files.map(f => this.project(f, node.fields));

    return {
      type: 'select',
      data,
      count: data.length
    };
  }

  // Project a file into the selected fields
  private project(file: FileData, fields: Expression[]): Record<string, any> {
    const result: Record<string, any> = {};

    for (const field of fields) {
      if (field.type === 'wildcard') {
        Object.assign(result, this.flattenFileData(file));
      } else if (field.type === 'field') {
        const value = this.evaluateExpression(field, { file });
        result[field.alias || field.name] = value;
      } else if (field.type === 'function_call' && this.isAggregate(field.name)) {
        const key = this.aggregateKey(field);
        result[field.alias || key] = (file as any)[key];
      } else if (field.type === 'function_call') {
        const value = this.evaluateExpression(field, { file });
        result[field.alias || this.generateFieldName(field)] = value;
      } else {
        const value = this.evaluateExpression(field, { file });
        result[this.generateFieldName(field)] = value;
      }
    }

    return result;
  }

  // Flatten file data for wildcard selection
  private flattenFileData(file: FileData): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(file.frontmatter || {})) {
      result[key] = value;
    }

    result['filename'] = file.filename;
    result['path'] = file.path;
    result['abspath'] = file.abspath;
    result['filepath'] = file.filepath;

    return result;
  }

  // Generate field name for complex expressions
  private generateFieldName(expr: Expression): string {
    switch (expr.type) {
      case 'function_call': return `${expr.name}()`;
      case 'method_call': return `${this.generateFieldName(expr.object)}.${expr.method}()`;
      case 'array_index': return `${this.generateFieldName(expr.object)}[${this.generateFieldName(expr.index)}]`;
      case 'map_index': return `${this.generateFieldName(expr.object)}.${this.generateFieldName(expr.key)}`;
      case 'binary_op': return `${this.generateFieldName(expr.left)}_${expr.op}_${this.generateFieldName(expr.right)}`;
      case 'unary_op': return `${expr.op}_${this.generateFieldName(expr.operand)}`;
      default: return 'expr';
    }
  }

  private isAggregate(name: string): boolean {
    return AGGREGATE_FUNCTIONS.includes(name);
  }

  private aggregateKey(expr: FunctionCallNode): string {
    const arg = expr.args[0];
    const argName = arg && arg.type === 'field' ? arg.name : '*';
    return `${expr.name}(${argName})`;
  }

  // Group files by fields and compute aggregates
  private groupBy(files: FileData[], fields: string[]): FileData[] {
    const groups = new Map<string, FileData[]>();

    for (const file of files) {
      const key = fields.map(f => String((file as any)[f])).join('|');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(file);
    }

    const result: FileData[] = [];
    for (const [, groupFiles] of groups) {
      const aggregated: any = { ...groupFiles[0] };

      aggregated['count(*)'] = groupFiles.length;
      for (const field of fields) {
        aggregated[`count(${field})`] = groupFiles.length;
      }

      result.push(aggregated as FileData);
    }

    return result;
  }

  // Sort files by order-by fields
  private orderBy(files: FileData[], orderBy: OrderByNode[]): FileData[] {
    return files.sort((a, b) => {
      for (const { field, direction } of orderBy) {
        const aVal = (a as any)[field];
        const bVal = (b as any)[field];

        if (aVal === bVal) continue;

        // Handle dates
        if (aVal instanceof Date && bVal instanceof Date) {
          const compare = aVal.getTime() - bVal.getTime();
          return direction === 'asc' ? compare : -compare;
        }

        // Handle date strings
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          const isADate = /^\d{4}-\d{2}-\d{2}(T|\s)/.test(aVal);
          const isBDate = /^\d{4}-\d{2}-\d{2}(T|\s)/.test(bVal);
          if (isADate && isBDate) {
            const compare = new Date(aVal).getTime() - new Date(bVal).getTime();
            return direction === 'asc' ? compare : -compare;
          }
        }

        // Default comparison
        const compare = aVal < bVal ? -1 : 1;
        return direction === 'asc' ? compare : -compare;
      }
      return 0;
    });
  }

  // Remove duplicate rows based on selected fields
  private distinct(files: FileData[], fields: Expression[]): FileData[] {
    const seen = new Set<string>();
    return files.filter(f => {
      const key = fields.map(field => {
        if (field.type === 'field') return String((f as any)[field.name]);
        if (field.type === 'wildcard') return JSON.stringify(this.flattenFileData(f));
        return '';
      }).join('|');

      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  // Execute JOIN
  private async executeJoin(files: FileData[], join: JoinNode): Promise<FileData[]> {
    const joinedFiles = await this.readFilesWithHooks(join.right.table);
    const result: FileData[] = [];

    for (const file of files) {
      for (const joined of joinedFiles) {
        const merged: any = { ...file };

        for (const [key, value] of Object.entries(joined)) {
          if (key !== 'id' && key !== 'filepath' && key !== 'content') {
            merged[`${join.right.table}.${key}`] = value;
          }
        }

        if (join.on && this.evaluateExpression(join.on, { file: merged })) {
          result.push(merged as FileData);
        }
      }
    }

    return result;
  }

  // ===== UPDATE =====

  private async executeUpdate(node: UpdateStatement): Promise<QueryResult> {
    const files = await this.readFilesWithHooks(this.dir, this.readOptions);
    const matches = node.where
      ? files.filter(f => this.evaluateExpression(node.where!, { file: f }))
      : files;

    if (matches.length === 0) {
      throw new Error(this.noMatchError(node.where));
    }

    // Check for immutable field updates
    for (const field of FileOps.IMMUTABLE_FIELDS) {
      if (node.set[field] !== undefined) {
        throw new Error(`cannot update immutable field '${field}'`);
      }
    }

    for (const file of matches) {
      // Update fields with type conversion
      for (const [key, { value, type }] of Object.entries(node.set)) {
        let result = this.evaluateExpression(value, { file });
        if (type) {
          result = TypeSystem.convertType(result, type);
        }
        (file as any)[key] = result;
        file.frontmatter[key] = result;
      }

      // Call hook if provided
      if (this.hooks?.onBeforeWrite) {
        this.hooks.onBeforeWrite(file, 'update');
      }

      // Write back to the original file path
      await FileOps.writeFile(file.filepath, file, this.getFileBody(file));
    }

    return {
      type: 'update',
      updated: matches.length
    };
  }

  // ===== CREATE =====

  private async executeCreate(node: CreateStatement): Promise<QueryResult> {
    const newFile: any = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Set fields with type conversion
    for (const [key, { value, type }] of Object.entries(node.fields)) {
      let result = this.evaluateExpression(value, { file: newFile });
      if (type) {
        result = TypeSystem.convertType(result, type);
      }
      newFile[key] = result;
    }

    // Determine target: abspath > path > file/filename > error
    let target: string;
    if (newFile.abspath) {
      target = newFile.abspath;
    } else if (newFile.path) {
      target = this.resolveTargetPath(newFile.path);
    } else if (newFile.file || newFile.filename) {
      target = this.dir;
    } else {
      throw new Error('create requires path to file');
    }

    // Call hook if provided
    if (this.hooks?.onBeforeWrite) {
      this.hooks.onBeforeWrite(newFile, 'create');
    }

    await FileOps.writeFile(target, newFile, '');

    return {
      type: 'create',
      created: 1
    };
  }

  // ===== DELETE =====

  private async executeDelete(node: DeleteStatement): Promise<QueryResult> {
    // Require where clause for delete
    if (!node.where) {
      throw new Error('delete requires a where clause');
    }

    const files = await this.readFilesWithHooks(this.dir, this.readOptions);
    const matches = node.where ? files.filter(f => this.evaluateExpression(node.where!, { file: f })) : files;

    if (matches.length === 0) {
      throw new Error(this.noMatchError(node.where));
    }

    for (const file of matches) {
      const { unlink } = await import('fs/promises');
      await unlink(file.filepath);
    }

    return {
      type: 'delete',
      deleted: matches.length
    };
  }

  // ===== PIPE / UNION / TRIGGER =====

  private async executePipe(node: PipeNode): Promise<QueryResult> {
    const result = await this.executeAST(node.expr);

    if (node.fn === 'clipboard' && result.data) {
      const values = result.data.map((f: any) => f.filename || f.title || '').join('\n');
      copyToClipboard(values);
    }

    return result;
  }

  private async executeUnion(node: UnionNode): Promise<QueryResult> {
    throw new Error('UNION execution not implemented');
  }

  private async executeTrigger(node: TriggerStatement): Promise<QueryResult> {
    throw new Error('Trigger execution not implemented');
  }

  private noMatchError(where?: Expression): string {
    if (where && where.type === 'binary_op' && where.left.type === 'field' && where.right.type === 'string') {
      return `no file with ${where.left.name} '${where.right.value}'`;
    }
    return 'no files matched the query';
  }

  private resolveTargetPath(p: string): string {
    if (isAbsolute(p)) return p;
    return join(this.dir, p);
  }

  // ===== Expression evaluation =====

  // Evaluate expression tree
  evaluateExpression(expr: Expression, context: EvaluationContext): any {
    switch (expr.type) {
      case 'binary_op': return this.evaluateBinaryOp(expr, context);
      case 'unary_op': return this.evaluateUnaryOp(expr, context);
      case 'function_call': return this.evaluateFunctionCall(expr, context);
      case 'method_call': return this.evaluateMethodCall(expr, context);
      case 'array_index': return this.evaluateArrayIndex(expr, context);
      case 'map_index': return this.evaluateMapIndex(expr, context);
      case 'field': return this.evaluateField(expr, context);
      case 'subquery': return this.evaluateSubquery(expr, context);
      case 'paren': return this.evaluateExpression(expr.expression, context);
      case 'wildcard': return this.flattenFileData(context.file as FileData);
      case 'exists': return false;
      default:
        if (this.isValueNode(expr as Expression)) {
          return this.evaluateValue(expr as ValueNode);
        }
        throw new Error(`Unsupported expression type: ${(expr as Expression).type}`);
    }
  }

  // Evaluate binary operations with type-specific behavior
  private evaluateBinaryOp(expr: BinaryOpNode, context: EvaluationContext): any {
    // Legacy `not x op y` semantics: a comparison whose left operand is NOT
    // negates the whole comparison (e.g. `not status = "done"`).
    if (expr.left.type === 'unary_op' && expr.left.op === 'NOT') {
      const inner: BinaryOpNode = { ...expr, left: expr.left.operand };
      return !this.evaluateBinaryOp(inner, context);
    }

    const left = this.evaluateExpression(expr.left, context);
    const right = this.evaluateExpression(expr.right, context);

    switch (expr.op) {
      case '=':
      case '!=':
      case '>':
      case '<':
      case '>=':
      case '<=':
      case 'CONTAINS':
      case 'STARTS_WITH':
      case 'ENDS_WITH':
        return TypeSystem.evaluateComparison(expr.op, left, right);
      case 'NOT CONTAINS':
        return !TypeSystem.evaluateComparison('CONTAINS', left, right);
      case 'NOT STARTS_WITH':
        return !TypeSystem.evaluateComparison('STARTS_WITH', left, right);
      case 'NOT ENDS_WITH':
        return !TypeSystem.evaluateComparison('ENDS_WITH', left, right);
      case 'IN':
        return this.evaluateIn(left, right);
      case 'NOT IN':
        return !this.evaluateIn(left, right);
      case 'IS EMPTY':
        return this.isEmpty(left);
      case 'IS NOT EMPTY':
        return !this.isEmpty(left);
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
      case '^':
        return TypeSystem.evaluateArithmetic(expr.op, left, right);
      case 'AND':
        return Boolean(left) && Boolean(right);
      case 'OR':
        return Boolean(left) || Boolean(right);
      default:
        // ANY/ALL operators: op like 'ANY =', 'ALL CONTAINS'
        if (expr.op.startsWith('ANY ')) {
          return this.evaluateAny(left, expr.op.slice(4), right);
        }
        if (expr.op.startsWith('ALL ')) {
          return this.evaluateAll(left, expr.op.slice(4), right);
        }
        throw new Error(`Unsupported binary operator: ${expr.op}`);
    }
  }

  // Evaluate IN operator
  private evaluateIn(left: any, right: any): boolean {
    // toc() returns array of { level, title } — match against titles
    if (Array.isArray(right) && right.length > 0 &&
        typeof right[0] === 'object' && right[0] !== null && 'title' in right[0]) {
      const needle = String(left).toLowerCase();
      return right.some(item => String((item as any).title).toLowerCase().includes(needle));
    }

    if (Array.isArray(right)) {
      return right.some(item => this.looseEqual(left, item));
    }

    if (Array.isArray(left)) {
      return left.includes(right);
    }

    return false;
  }

  // Loose equality with string/number coercion
  private looseEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a === 'string' && typeof b === 'number') return a === String(b);
    if (typeof a === 'number' && typeof b === 'string') return String(a) === b;
    return false;
  }

  // Evaluate ANY operator: array.some(item => item <op> right)
  private evaluateAny(left: any, subOp: string, right: any): boolean {
    if (!Array.isArray(left)) return false;
    return left.some(item => TypeSystem.evaluateComparison(subOp, item, right));
  }

  // Evaluate ALL operator: array.every(item => item <op> right)
  private evaluateAll(left: any, subOp: string, right: any): boolean {
    if (!Array.isArray(left)) return false;
    return left.every(item => TypeSystem.evaluateComparison(subOp, item, right));
  }

  // Evaluate IS EMPTY
  private isEmpty(value: any): boolean {
    return value === undefined || value === null || value === '';
  }

  // Evaluate unary operations
  private evaluateUnaryOp(expr: UnaryOpNode, context: EvaluationContext): any {
    const operand = this.evaluateExpression(expr.operand, context);
    return TypeSystem.evaluateUnary(expr.op, operand);
  }

  // Evaluate function calls
  private evaluateFunctionCall(expr: FunctionCallNode, context: EvaluationContext): any {
    const args = expr.args.map(arg => this.evaluateExpression(arg, context));

    // Aggregates (precomputed by groupBy)
    if (this.isAggregate(expr.name)) {
      const key = this.aggregateKey(expr);
      const file = context.file as any;
      return file ? file[key] : undefined;
    }

    // Content-extraction builtins
    switch (expr.name) {
      case 'links': return this.evaluateLinks(args, context);
      case 'images': return this.evaluateImages(args, context);
      case 'codeblocks': return this.evaluateCodeblocks(args, context);
      case 'section': return this.evaluateSection(args, context);
      case 'grep': return this.evaluateGrep(args, context);
      case 'toc': return this.evaluateToc(args, context);
      case 'content': return this.evaluateContent(args, context);
      case 'fields': return this.evaluateFields(args, context);
      case 'has': return args[0] !== undefined && args[0] !== null;
      case 'has_section': return this.evaluateHasSection(args, context);
    }

    // Apply hooks
    if (this.hooks?.onBuiltinCall) {
      const result = this.hooks.onBuiltinCall(expr.name, args, context.file as Record<string, any>);
      if (result !== undefined) return result;
    }

    // Fallback to legacy builtins (now, next_date, upper, len, trim, ...)
    return Builtins.call(expr.name, args, context.file as Record<string, any>, undefined, this.hooks);
  }

  // Evaluate method calls
  private evaluateMethodCall(expr: MethodCallNode, context: EvaluationContext): any {
    const object = this.evaluateExpression(expr.object, context);
    const args = expr.args.map(arg => this.evaluateExpression(arg, context));

    // Array methods
    if (Array.isArray(object)) {
      return this.evaluateArrayMethod(object, expr.method, args, context);
    }

    // String methods
    if (typeof object === 'string') {
      return this.evaluateStringMethod(object, expr.method, args, context);
    }

    // Object methods
    if (typeof object === 'object' && object !== null) {
      return this.evaluateObjectMethod(object, expr.method, args, context);
    }

    throw new Error(`Unsupported method call: ${expr.method} on ${typeof object}`);
  }

  // Evaluate array methods
  private evaluateArrayMethod(array: any[], method: string, args: any[], context: EvaluationContext): any {
    switch (method) {
      case 'filter': return this.evaluateArrayFilter(array, args[0], context);
      case 'map': return this.evaluateArrayMap(array, args[0], context);
      case 'where': return this.evaluateArrayFilter(array, args[0], context);
      case 'first': return array.length > 0 ? array[0] : undefined;
      case 'last': return array.length > 0 ? array[array.length - 1] : undefined;
      case 'sort': return this.evaluateArraySort(array, args[0], context);
      case 'slice': return this.evaluateArraySlice(array, args);
      case 'flatten': return this.evaluateArrayFlatten(array);
      case 'unique': return this.evaluateArrayUnique(array);
      case 'count': return array.length;
      default: throw new Error(`Unsupported array method: ${method}`);
    }
  }

  // Evaluate array filter
  private evaluateArrayFilter(array: any[], predicate: any, context: EvaluationContext): any[] {
    return array.filter(item => {
      const itemContext = { ...context, variables: { ...context.variables, _: item } };
      return this.evaluateExpression(predicate, itemContext);
    });
  }

  // Evaluate array map
  private evaluateArrayMap(array: any[], mapper: any, context: EvaluationContext): any[] {
    return array.map(item => {
      const itemContext = { ...context, variables: { ...context.variables, _: item } };
      return this.evaluateExpression(mapper, itemContext);
    });
  }

  // Evaluate array sort
  private evaluateArraySort(array: any[], comparator: any, context: EvaluationContext): any[] {
    return [...array].sort((a, b) => {
      const aContext = { ...context, variables: { ...context.variables, _: a } };
      const bContext = { ...context, variables: { ...context.variables, _: b } };
      const aValue = this.evaluateExpression(comparator, aContext);
      const bValue = this.evaluateExpression(comparator, bContext);
      return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
    });
  }

  // Evaluate array slice
  private evaluateArraySlice(array: any[], args: any[]): any[] {
    const start = args[0] || 0;
    const end = args[1] || array.length;
    return array.slice(start, end);
  }

  // Evaluate array flatten
  private evaluateArrayFlatten(array: any[]): any[] {
    return array.flat();
  }

  // Evaluate array unique
  private evaluateArrayUnique(array: any[]): any[] {
    return [...new Set(array)];
  }

  // Evaluate string methods
  private evaluateStringMethod(str: string, method: string, args: any[], context: EvaluationContext): any {
    switch (method) {
      case 'length': return str.length;
      case 'toLowerCase': return str.toLowerCase();
      case 'toUpperCase': return str.toUpperCase();
      case 'trim': return str.trim();
      case 'startsWith': return str.startsWith(args[0]);
      case 'endsWith': return str.endsWith(args[0]);
      case 'includes': return str.includes(args[0]);
      case 'slice': return str.slice(args[0], args[1]);
      default: throw new Error(`Unsupported string method: ${method}`);
    }
  }

  // Evaluate object methods
  private evaluateObjectMethod(obj: Record<string, any>, method: string, args: any[], context: EvaluationContext): any {
    switch (method) {
      case 'keys': return Object.keys(obj);
      case 'values': return Object.values(obj);
      case 'entries': return Object.entries(obj);
      case 'length': return Object.keys(obj).length;
      default: throw new Error(`Unsupported object method: ${method}`);
    }
  }

  // Evaluate array index
  private evaluateArrayIndex(expr: ArrayIndexNode, context: EvaluationContext): any {
    const array = this.evaluateExpression(expr.object, context);
    const index = this.evaluateExpression(expr.index, context);

    if (!Array.isArray(array)) {
      throw new Error(`Cannot index non-array: ${typeof array}`);
    }

    if (typeof index !== 'number') {
      throw new Error(`Array index must be number: ${typeof index}`);
    }

    // Handle negative indices (Python-style)
    if (index < 0) {
      return array[array.length + index];
    }

    return array[index];
  }

  // Evaluate map index (property access like new.status, item.title)
  private evaluateMapIndex(expr: MapIndexNode, context: EvaluationContext): any {
    const object = this.evaluateExpression(expr.object, context);
    const key = this.evaluateExpression(expr.key, context);

    if (typeof object !== 'object' || object === null) {
      throw new Error(`Cannot index non-object: ${typeof object}`);
    }

    if (typeof key !== 'string') {
      throw new Error(`Object key must be string: ${typeof key}`);
    }

    return object[key];
  }

  // Evaluate field reference
  private evaluateField(expr: FieldNode, context: EvaluationContext): any {
    // Trigger context: old / new
    if (expr.name === 'old' && this.triggerContext?.old) {
      return this.triggerContext.old;
    }
    if (expr.name === 'new' && this.triggerContext?.new) {
      return this.triggerContext.new;
    }

    // Check variables first
    if (context.variables && expr.name in context.variables) {
      return context.variables[expr.name];
    }

    const file = context.file as FileData | undefined;
    if (file) {
      // Identity fields
      switch (expr.name) {
        case 'filename': return file.filename;
        case 'path': return file.path;
        case 'abspath': return file.abspath;
        case 'filepath': return file.filepath;
        case '_filename': return file.filename;
        case '_path': return file.path;
        case '_content': return this.getFileBody(file);
      }

      // Frontmatter fields
      if (file.frontmatter && expr.name in file.frontmatter) {
        const value = file.frontmatter[expr.name];

        if (this.hooks?.onEvaluateValue) {
          return this.hooks.onEvaluateValue(value, expr.name);
        }

        return value;
      }

      // Direct fields (set by update or spread onto the row)
      if (expr.name in file) {
        return (file as any)[expr.name];
      }
    }

    // Missing field → undefined (absent-field contract)
    return undefined;
  }

  // Type guard for ValueNode
  private isValueNode(expr: Expression): expr is ValueNode {
    return ['string', 'number', 'boolean', 'null', 'empty', 'regex', 'array'].includes(expr.type);
  }

  // Type guard for field update
  private isFieldUpdate(update: any): update is { value: Expression } {
    return typeof update === 'object' && update !== null && 'value' in update;
  }

  // Evaluate value literals
  private evaluateValue(expr: ValueNode): any {
    switch (expr.type) {
      case 'string': return expr.value;
      case 'number': return expr.value;
      case 'boolean': return expr.value;
      case 'null': return null;
      case 'empty': return undefined;
      case 'regex': return new RegExp(expr.value);
      case 'array': return expr.items.map(item => this.evaluateValue(item));
      case 'field': return this.evaluateField(expr, {});
      case 'subquery': return this.evaluateSubquery(expr, {});
      default: throw new Error(`Unsupported value type: ${(expr as ValueNode).type}`);
    }
  }

  // Evaluate subquery
  private evaluateSubquery(expr: SubqueryNode, context: EvaluationContext): any {
    throw new Error('Subquery evaluation not implemented');
  }

  // ===== Content builtins =====

  private evaluateLinks(args: any[], context: EvaluationContext): any {
    if (!this.getFileBody(context.file)) {
      return [];
    }
    const extractor = this.getContentExtractor(context.file as FileData);
    return extractor.extractLinks();
  }

  private evaluateImages(args: any[], context: EvaluationContext): any {
    if (!this.getFileBody(context.file)) {
      return [];
    }
    const extractor = this.getContentExtractor(context.file as FileData);
    return extractor.extractImages();
  }

  private evaluateCodeblocks(args: any[], context: EvaluationContext): any {
    if (!this.getFileBody(context.file)) {
      return [];
    }
    const extractor = this.getContentExtractor(context.file as FileData);
    return extractor.extractCodeblocks();
  }

  private evaluateSection(args: any[], context: EvaluationContext): any {
    if (!this.getFileBody(context.file)) {
      return [];
    }
    const extractor = this.getContentExtractor(context.file as FileData);
    return extractor.extractSections();
  }

  private evaluateGrep(args: any[], context: EvaluationContext): any {
    if (!this.getFileBody(context.file)) {
      return [];
    }
    const extractor = this.getContentExtractor(context.file as FileData);
    return extractor.extractGrep(args[0]);
  }

  private evaluateToc(args: any[], context: EvaluationContext): any {
    const file = context.file as FileData;
    // Prefer precomputed regex-based sections (fast path, avoids remark parse)
    if (file.sections && file.sections.size > 0) {
      return Array.from(file.sections.values()).map(s => ({ level: s.level, title: s.title }));
    }
    if (!this.getFileBody(file)) {
      return [];
    }
    const extractor = this.getContentExtractor(file);
    return extractor.extractToc();
  }

  private evaluateContent(args: any[], context: EvaluationContext): any {
    if (!this.getFileBody(context.file)) {
      return '';
    }

    const body = this.getFileBody(context.file);
    if (args.length === 0) {
      return body;
    }

    // Handle line range: content(start, end)
    if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number') {
      const lines = body.split('\n');
      return lines.slice(args[0] - 1, args[1]).join('\n');
    }

    return body;
  }

  private evaluateFields(args: any[], context: EvaluationContext): any {
    if (!context.file) {
      return [];
    }

    if (args.length === 0) {
      return Object.keys(context.file.frontmatter || {});
    }

    // Handle fields('values')
    if (args[0] === 'values') {
      return Object.values(context.file.frontmatter || {});
    }

    return Object.keys(context.file.frontmatter || {});
  }

  // Evaluate has section("name")
  private evaluateHasSection(args: any[], context: EvaluationContext): boolean {
    const name = String(args[0] ?? '');
    const file = context.file as FileData | undefined;
    if (!file) return false;

    // Prefer file.sections (from parseSections) — exact match
    if (file.sections?.has(name)) {
      return true;
    }

    // Fall back to ContentExtractor
    if (this.getFileBody(file)) {
      const extractor = this.getContentExtractor(file);
      return extractor.extractSections().some(s => s.title === name);
    }

    return false;
  }

  // Resolve the markdown body for content extraction:
  // prefers the precomputed `body`, falls back to legacy shapes.
  private getFileBody(file: any): string {
    if (!file) return '';
    if (typeof file.body === 'string') return file.body;
    if (typeof file.content === 'string') return file.content;
    return file.content?.raw ?? '';
  }

  // Get or create content extractor
  private getContentExtractor(file: FileData): ContentExtractor {
    if (!this.getFileBody(file)) {
      throw new Error('File content not loaded');
    }

    const cacheKey = file.path || file.filename;
    if (this.contentExtractorCache.has(cacheKey)) {
      return this.contentExtractorCache.get(cacheKey)!;
    }

    const extractor = new ContentExtractor(this.getFileBody(file));
    this.contentExtractorCache.set(cacheKey, extractor);
    return extractor;
  }
}