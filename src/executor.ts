// src/executor.ts
import { Parser } from './parser';
import { FileOps, FileData, ReadOptions } from './files';
import { isAbsolute, join } from 'path';
import { ASTNode, SelectNode, UpdateNode, CreateNode, DeleteNode, WhereNode, ValueNode, ExecutorHooks } from './types';
import { copyToClipboard } from './clipboard';
import { Builtins } from './builtins';

export interface QueryResult {
  type: 'select' | 'update' | 'create' | 'delete';
  data?: FileData[];
  count?: number;
  updated?: number;
  created?: number;
  deleted?: number;
}

export interface TriggerContext {
  old?: FileData;
  new?: FileData;
}

export class Executor {
  private dir: string;
  private context?: Record<string, any>;
  private triggerContext?: TriggerContext;
  private readOptions: ReadOptions;
  private currentFile?: FileData;
  private hooks?: ExecutorHooks;

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

  async execute(query: string): Promise<QueryResult> {
    const ast = new Parser(query).parse();
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
      default:
        throw new Error(`Unknown AST type: ${(ast as any).type}`);
    }
  }

  private async readFilesWithHooks(dir: string, options: ReadOptions = {}): Promise<FileData[]> {
    const files = await FileOps.readFiles(dir, options);
    
    // Apply onAfterRead hook if provided
    if (this.hooks?.onAfterRead) {
      return files.map(f => this.hooks!.onAfterRead!(f));
    }
    
    return files;
  }

  private resolveField(file: FileData, field: string): any {
    // Handle section.<name> virtual fields
    if (field.startsWith('section.')) {
      const sectionName = field.slice(8);
      return file.sections?.get(sectionName)?.content || null;
    }
    
    // Handle toc field
    if (field === 'toc') {
      return file.sections ? Array.from(file.sections.values()) : [];
    }
    
    // Default: return regular field
    return (file as any)[field];
  }

  private async executePipe(node: any): Promise<QueryResult> {
    const result = await this.executeAST(node.expr);
    
    // Handle clipboard function
    if (node.fn === 'clipboard' && result.data) {
      const values = result.data.map((f: any) => f.filename || f.title || '').join('\n');
      copyToClipboard(values);
    }
    
    return result;
  }

  private async executeSelect(node: SelectNode): Promise<QueryResult> {
    let files = await this.readFilesWithHooks(this.dir, this.readOptions);

    // WHERE
    if (node.where) {
      files = files.filter(f => this.evaluateWhere(f, node.where!));
    }

    // GROUP BY
    if (node.groupBy) {
      files = this.groupBy(files, node.groupBy);
    }

    // HAVING
    if (node.having) {
      files = files.filter(f => this.evaluateWhere(f, node.having!));
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

    // Select specific fields (handle aggregates)
    const hasAggregates = node.fields.some(f => typeof f === 'object' && f.type === 'aggregate');
    if (node.fields[0] !== '*' || hasAggregates) {
      files = files.map(f => {
        this.currentFile = f;
        const selected: any = {};
        for (const field of node.fields) {
          if (typeof field === 'string') {
            selected[field] = (f as any)[field];
          } else if (typeof field === 'object' && field.type === 'aggregate') {
            // Aggregate fields are already computed by groupBy
            const key = `${field.func}(${field.field})`;
            selected[key] = (f as any)[key];
          } else if (typeof field === 'object' && (field as any).type === 'builtin') {
            // Evaluate builtin function
            const builtinNode = field as any;
            const args = builtinNode.args.map((arg: any) => this.evaluateValue(arg));
            const result = Builtins.call(builtinNode.name, args, f, undefined, this.hooks);
            // Use full expression as key to avoid overwriting duplicate function calls
            const key = `${builtinNode.name}(${builtinNode.args.map((a: any) => a.name || a.value || a.type).join(', ')})`;
            selected[key] = result;
          }
        }
        return selected;
      });
    }

    return {
      type: 'select',
      data: files,
      count: files.length
    };
  }

  private distinct(files: FileData[], fields: (string | any)[]): FileData[] {
    const seen = new Set<string>();
    return files.filter(f => {
      const key = fields.map(field => {
        if (typeof field === 'string') {
          return String((f as any)[field]);
        }
        if (typeof field === 'object' && field.type === 'aggregate') {
          return `${field.func}(${field.field})`;
        }
        return '';
      }).join('|');
      
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async executeJoin(files: FileData[], join: any): Promise<FileData[]> {
    // Load the joined table
    const joinedFiles = await this.readFilesWithHooks(join.table);
    
    // Perform the join
    const result: FileData[] = [];
    
    for (const file of files) {
      for (const joined of joinedFiles) {
        // Create a merged file-like object
        const merged: any = { ...file };
        
        // Add joined fields with prefix
        for (const [key, value] of Object.entries(joined)) {
          if (key !== 'id' && key !== 'filepath' && key !== 'content') {
            merged[`${join.table}.${key}`] = value;
          }
        }
        
        // Check ON condition
        if (this.evaluateWhere(merged as FileData, join.on)) {
          result.push(merged as FileData);
        }
      }
    }
    
    return result;
  }

  private async executeUpdate(node: UpdateNode): Promise<QueryResult> {
    const files = await this.readFilesWithHooks(this.dir, this.readOptions);
    const matches = node.where
      ? files.filter(f => this.evaluateWhere(f, node.where))
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
      // Set current file for field references
      this.currentFile = file;

      // Update fields
      for (const [key, value] of Object.entries(node.set)) {
        (file as any)[key] = this.evaluateValue(value);
      }

      // Call hook if provided
      if (this.hooks?.onBeforeWrite) {
        this.hooks.onBeforeWrite(file, 'update');
      }

      // Write back to the original file path
      await FileOps.writeFile(file.filepath, file, file.content);
    }

    return {
      type: 'update',
      updated: matches.length
    };
  }

  private async executeCreate(node: CreateNode): Promise<QueryResult> {
    const newFile: any = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Set fields
    for (const [key, value] of Object.entries(node.fields)) {
      newFile[key] = this.evaluateValue(value);
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

  private async executeDelete(node: DeleteNode): Promise<QueryResult> {
    // Require where clause for delete
    if (!node.where) {
      throw new Error('delete requires a where clause');
    }

    const files = await this.readFilesWithHooks(this.dir, this.readOptions);
    const matches = node.where ? files.filter(f => this.evaluateWhere(f, node.where)) : files;

    if (matches.length === 0) {
      throw new Error(this.noMatchError(node.where));
    }

    for (const file of matches) {
      // Delete file
      const { unlink } = await import('fs/promises');
      await unlink(file.filepath);
    }

    return {
      type: 'delete',
      deleted: matches.length
    };
  }

  private noMatchError(where?: WhereNode): string {
    if (where && where.type === 'comparison' && where.field) {
      const value = where.value && where.value.type === 'string' ? where.value.value : '';
      return `no file with ${where.field} '${value}'`;
    }
    return 'no files matched the query';
  }

  private resolveTargetPath(p: string): string {
    if (isAbsolute(p)) return p;
    return join(this.dir, p);
  }

  private evaluateWhere(file: FileData, where: WhereNode): boolean {
    switch (where.type) {
      case 'and':
        return this.evaluateWhere(file, where.left as WhereNode) &&
               this.evaluateWhere(file, where.right as WhereNode);
      case 'or':
        return this.evaluateWhere(file, where.left as WhereNode) ||
               this.evaluateWhere(file, where.right as WhereNode);
      case 'not':
        return !this.evaluateWhere(file, where.expr as WhereNode);
      case 'comparison':
        return this.evaluateComparison(file, where.field!, where.op!, where.value!, where.fieldPath);
      case 'array_comparison':
        return this.evaluateArrayComparison(file, where.field!, where.arrayOp!, where.arrayCondition!);
      case 'in':
        return this.evaluateIn(file, where.field!, where.value!, false);
      case 'not_in':
        return this.evaluateIn(file, where.field!, where.value!, true);
      case 'has':
        return this.evaluateHas(file, where.field!);
      case 'exists':
        return this.evaluateExists(file, where.subquery!);
      default:
        return false;
    }
  }

  private evaluateArrayComparison(file: FileData, field: string, arrayOp: string, condition: WhereNode): boolean {
    const arrayValue = (file as any)[field];
    
    if (!Array.isArray(arrayValue)) {
      return false;
    }

    if (arrayOp === 'any') {
      return arrayValue.some((item: any) => {
        // For string arrays, create a temp file with a special value field
        // For object arrays, spread the item properties
        const tempFile = typeof item === 'object' 
          ? { ...file, ...item }
          : { ...file, _value: item };
        
        // If the condition has an empty field, use _value
        if (condition.type === 'comparison' && condition.field === '') {
          const tempCondition = { ...condition, field: '_value', fieldPath: '_value' };
          return this.evaluateWhere(tempFile, tempCondition);
        }
        
        return this.evaluateWhere(tempFile, condition);
      });
    }

    if (arrayOp === 'all') {
      return arrayValue.every((item: any) => {
        const tempFile = typeof item === 'object'
          ? { ...file, ...item }
          : { ...file, _value: item };
        
        if (condition.type === 'comparison' && condition.field === '') {
          const tempCondition = { ...condition, field: '_value', fieldPath: '_value' };
          return this.evaluateWhere(tempFile, tempCondition);
        }
        
        return this.evaluateWhere(tempFile, condition);
      });
    }

    return false;
  }

  private evaluateIn(file: FileData, field: string, value: ValueNode, negate: boolean): boolean {
    const fieldValue = (file as any)[field];
    const list = this.evaluateValue(value);
    
    if (!Array.isArray(list)) {
      return false;
    }

    // Absent field: = v → false, != v → true
    if (fieldValue === undefined) {
      return negate; // not_in returns true for absent, in returns false
    }

    const found = list.some((item: any) => {
      // Type coercion
      if (typeof fieldValue === 'string' && typeof item === 'number') {
        return fieldValue === String(item);
      }
      if (typeof fieldValue === 'number' && typeof item === 'string') {
        return String(fieldValue) === item;
      }
      return fieldValue === item;
    });

    return negate ? !found : found;
  }

  private evaluateHas(file: FileData, field: string): boolean {
    // Handle section.<name> virtual fields
    if (field.startsWith('section.')) {
      const sectionName = field.slice(8);
      return file.sections?.has(sectionName) || false;
    }
    
    return (file as any)[field] !== undefined;
  }

  private evaluateExists(file: FileData, subquery: any): boolean {
    // Run the subquery synchronously by creating a temporary executor
    // For now, we'll use a simplified approach: check if the subquery would return results
    // This is a simplified version - in production, you'd want to handle this more robustly
    try {
      // Parse and evaluate the subquery
      const parser = new (require('./parser').Parser)(subquery);
      const ast = parser.parse();
      
      // For exists, we just need to know if there would be any results
      // We'll use the same file context for the subquery
      if (ast.type === 'select') {
        const selectNode = ast as SelectNode;
        // Simplified: check if where condition matches
        if (selectNode.where) {
          return this.evaluateWhere(file, selectNode.where);
        }
        // No where clause means all files match
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private evaluateComparison(file: FileData, field: string, op: string, value: ValueNode, fieldPath?: string, subquery?: any): boolean {
    // Handle count(select ...) with outer field correlation
    if (field === 'count(select)' && subquery) {
      const compareValue = value ? this.evaluateValue(value) : null;
      const count = this.evaluateSubqueryCount(file, subquery);
      
      if (!op || compareValue === null) {
        return count > 0;
      }
      
      switch (op) {
        case '=': return count === compareValue;
        case '!=': return count !== compareValue;
        case '<': return count < compareValue;
        case '>': return count > compareValue;
        case '<=': return count <= compareValue;
        case '>=': return count >= compareValue;
        default: return false;
      }
    }

    // Handle aggregate functions in comparisons (e.g., count(*) > 1)
    const aggregateMatch = field.match(/^(count|sum|avg|min|max)\((.+)\)$/);
    if (aggregateMatch) {
      const [, func, aggField] = aggregateMatch;
      const compareValue = this.evaluateValue(value);
      
      // For aggregated comparisons, we need to evaluate against grouped data
      // This is a simplified version - in production, you'd want to handle this more robustly
      const fieldValue = (file as any)[field] || (file as any)[`${func}(${aggField})`];
      
      if (fieldValue === undefined) return false;
      
      const coercedFieldValue = typeof fieldValue === 'string' ? Number(fieldValue) : fieldValue;
      const coercedCompareValue = typeof compareValue === 'string' ? Number(compareValue) : compareValue;
      
      switch (op) {
        case '=': return coercedFieldValue === coercedCompareValue;
        case '!=': return coercedFieldValue !== coercedCompareValue;
        case '<': return coercedFieldValue < coercedCompareValue;
        case '>': return coercedFieldValue > coercedCompareValue;
        case '<=': return coercedFieldValue <= coercedCompareValue;
        case '>=': return coercedFieldValue >= coercedCompareValue;
        default: return false;
      }
    }

    // Handle trigger variables (new.field, old.field)
    let fieldValue: any;
    if (fieldPath && this.triggerContext) {
      const [prefix, ...rest] = fieldPath.split('.');
      const fieldName = rest.join('.');
      if (prefix === 'new' && this.triggerContext.new) {
        fieldValue = (this.triggerContext.new as any)[fieldName];
      } else if (prefix === 'old' && this.triggerContext.old) {
        fieldValue = (this.triggerContext.old as any)[fieldName];
      } else {
        fieldValue = this.resolveField(file, field);
      }
    } else {
      fieldValue = this.resolveField(file, field);
    }

    const compareValue = this.evaluateValue(value);

    // Absent field contract: = v → false, != v → true
    if (fieldValue === undefined) {
      if (op === '=') return false;
      if (op === '!=') return true;
      // For other operators, absent field returns false
      return false;
    }

    // Type coercion for comparison
    let coercedFieldValue = fieldValue;
    let coercedCompareValue = compareValue;
    
    // Convert to same type for comparison
    if (typeof fieldValue === 'string' && typeof compareValue === 'number') {
      coercedFieldValue = Number(fieldValue);
    } else if (typeof fieldValue === 'number' && typeof compareValue === 'string') {
      coercedCompareValue = Number(compareValue);
    } else if (fieldValue instanceof Date && typeof compareValue === 'string') {
      // Date vs string: parse string as date
      const parsed = new Date(compareValue);
      if (!isNaN(parsed.getTime())) {
        coercedCompareValue = parsed;
      }
    } else if (typeof fieldValue === 'string' && compareValue instanceof Date) {
      // String vs Date: parse string as date
      const parsed = new Date(fieldValue);
      if (!isNaN(parsed.getTime())) {
        coercedFieldValue = parsed;
      }
    } else if (typeof fieldValue === 'string' && typeof compareValue === 'string') {
      // Both strings: check if they look like dates
      const isFieldDate = /^\d{4}-\d{2}-\d{2}(T|\s)/.test(fieldValue);
      const isCompareDate = /^\d{4}-\d{2}-\d{2}(T|\s)/.test(compareValue);
      if (isFieldDate && isCompareDate) {
        coercedFieldValue = new Date(fieldValue);
        coercedCompareValue = new Date(compareValue);
      }
    }

    switch (op) {
      case '=':
        return coercedFieldValue === coercedCompareValue;
      case '!=':
        return coercedFieldValue !== coercedCompareValue;
      case '<':
        return coercedFieldValue < coercedCompareValue;
      case '>':
        return coercedFieldValue > coercedCompareValue;
      case '<=':
        return coercedFieldValue <= coercedCompareValue;
      case '>=':
        return coercedFieldValue >= coercedCompareValue;
      case 'contains':
        return String(fieldValue).includes(String(compareValue));
      case 'starts_with':
        return String(fieldValue).startsWith(String(compareValue));
      case 'ends_with':
        return String(fieldValue).endsWith(String(compareValue));
      case 'not_contains':
        return !String(fieldValue).includes(String(compareValue));
      case 'not_starts_with':
        return !String(fieldValue).startsWith(String(compareValue));
      case 'not_ends_with':
        return !String(fieldValue).endsWith(String(compareValue));
      case 'is_empty':
        return !fieldValue || fieldValue === '';
      case 'is_not_empty':
        return fieldValue && fieldValue !== '';
      default:
        return false;
    }
  }

  private evaluateSubqueryCount(file: FileData, subquery: any): number {
    // Run the subquery and count results
    try {
      // For correlated subqueries with outer.field references,
      // we need to replace outer.field with actual values
      if (subquery.where) {
        const correlatedWhere = this.correlateSubquery(subquery.where, file);
        subquery = { ...subquery, where: correlatedWhere };
      }
      
      // Create a new executor for the subquery
      const subExecutor = new Executor(this.dir, this.context, this.triggerContext, this.readOptions);
      const result = subExecutor.executeSubquerySync(subquery);
      return result;
    } catch {
      return 0;
    }
  }

  private correlateSubquery(where: any, file: FileData): any {
    // Replace outer.field references with actual values from the outer file
    if (where.type === 'comparison') {
      if (where.fieldPath && where.fieldPath.startsWith('outer.')) {
        const outerField = where.fieldPath.slice(6); // Remove 'outer.' prefix
        const outerValue = (file as any)[outerField];
        return { ...where, field: outerField, fieldPath: outerField, value: { type: typeof outerValue === 'string' ? 'string' : 'number', value: outerValue } };
      }
    }
    
    if (where.type === 'and' || where.type === 'or') {
      return {
        ...where,
        left: this.correlateSubquery(where.left, file),
        right: this.correlateSubquery(where.right, file)
      };
    }
    
    if (where.type === 'not') {
      return {
        ...where,
        expr: this.correlateSubquery(where.expr, file)
      };
    }
    
    return where;
  }

  executeSubquerySync(subquery: any): number {
    // Synchronous version for subquery evaluation
    try {
      const files = FileOps.readFilesSync(this.dir, this.readOptions);
      let count = 0;
      
      for (const file of files) {
        if (subquery.where) {
          if (this.evaluateWhere(file, subquery.where)) {
            count++;
          }
        } else {
          count++;
        }
      }
      
      return count;
    } catch {
      return 0;
    }
  }

  private evaluateValue(value: ValueNode): any {
    let result: any;
    
    if (value.type === 'string') result = value.value;
    else if (value.type === 'number') result = value.value;
    else if (value.type === 'boolean') result = value.value;
    else if (value.type === 'null') result = null;
    else if (value.type === 'empty') result = null;
    else if (value.type === 'field') result = this.currentFile ? this.resolveField(this.currentFile, value.name) : null;
    else if (value.type === 'array') result = value.items.map(item => this.evaluateValue(item));
    else if (value.type === 'binary') result = this.evaluateBinary(value);
    else if (value.type === 'builtin') {
      const args = value.args.map(arg => this.evaluateValue(arg));
      result = Builtins.call(value.name, args, this.context, undefined, this.hooks);
    }
    else result = value;
    
    // Call hook if provided
    if (this.hooks?.onEvaluateValue && result !== undefined) {
      result = this.hooks.onEvaluateValue(result, '');
    }
    
    return result;
  }

  private evaluateBinary(expr: { op: '+' | '-'; left: ValueNode; right: ValueNode }): any {
    const left = this.evaluateValue(expr.left);
    const right = this.evaluateValue(expr.right);

    // number +/- number → number
    if (typeof left === 'number' && typeof right === 'number') {
      return expr.op === '+' ? left + right : left - right;
    }

    // string + string → concat
    if (typeof left === 'string' && typeof right === 'string' && expr.op === '+') {
      return left + right;
    }

    // list +/- list → set union/difference
    if (Array.isArray(left) && Array.isArray(right)) {
      if (expr.op === '+') {
        // Union (dedupe)
        return [...new Set([...left, ...right])];
      } else {
        // Difference
        return left.filter(item => !right.includes(item));
      }
    }

    // list +/- scalar → add/remove element
    if (Array.isArray(left) && !Array.isArray(right)) {
      if (expr.op === '+') {
        // Add element (dedupe)
        return left.includes(right) ? left : [...left, right];
      } else {
        // Remove element
        return left.filter(item => item !== right);
      }
    }

    // scalar + list (string) → list prepend (dedupe)
    if (!Array.isArray(left) && Array.isArray(right) && expr.op === '+' && typeof left === 'string') {
      return right.includes(left) ? right : [left, ...right];
    }

    throw new Error(`Cannot apply ${expr.op} to ${typeof left} and ${typeof right}`);
  }

  private groupBy(files: FileData[], fields: string[]): FileData[] {
    // Group files by the specified fields and calculate aggregates
    const groups = new Map<string, FileData[]>();
    
    for (const file of files) {
      const key = fields.map(f => String((file as any)[f])).join('|');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(file);
    }
    
    // Convert groups to aggregated results
    const result: FileData[] = [];
    for (const [, groupFiles] of groups) {
      const aggregated: any = { ...groupFiles[0] };
      
      // Calculate count
      aggregated['count(*)'] = groupFiles.length;
      
      // Store the count for each field
      for (const field of fields) {
        aggregated[`count(${field})`] = groupFiles.length;
      }
      
      result.push(aggregated as FileData);
    }
    
    return result;
  }

  private orderBy(files: FileData[], orderBy: { field: string; direction: 'asc' | 'desc' }[]): FileData[] {
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
            const aDate = new Date(aVal);
            const bDate = new Date(bVal);
            const compare = aDate.getTime() - bDate.getTime();
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
}
