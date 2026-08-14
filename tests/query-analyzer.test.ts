// tests/query-analyzer.test.ts

import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser';
import { QueryAnalyzer } from '../src/query-analyzer';

describe('Query Analyzer', () => {
  describe('Predicate Pushdown', () => {
    it('extracts simple predicates', () => {
      const ast = new Parser('select where status = "done" and priority > 3').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.pushdownPredicates).toEqual([
        { field: 'status', op: '=', value: 'done', canPushdown: true },
        { field: 'priority', op: '>', value: 3, canPushdown: true }
      ]);
    });
    
    it('handles negated predicates', () => {
      const ast = new Parser('select where not status = "done"').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.pushdownPredicates).toEqual([
        { field: 'status', op: '!=', value: 'done', canPushdown: true }
      ]);
    });
    
    it('handles reversed operands', () => {
      const ast = new Parser('select where "done" = status').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.pushdownPredicates).toEqual([
        { field: 'status', op: '=', value: 'done', canPushdown: true }
      ]);
    });
    
    it('ignores complex predicates that cannot be pushed down', () => {
      const ast = new Parser('select where links().length > 3').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.pushdownPredicates).toEqual([]);
    });
  });
  
  describe('Lazy Loading Analysis', () => {
    it('detects when content loading is not required', () => {
      const ast = new Parser('select title, status where status = "done"').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.lazyLoading.requiresContent).toBe(false);
      expect(plan.lazyLoading.builtins).toEqual([]);
    });
    
    it('detects when content loading is required', () => {
      const ast = new Parser('select title, toc() where status = "done"').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.lazyLoading.requiresContent).toBe(true);
      expect(plan.lazyLoading.builtins).toEqual(['toc']);
    });
    
    it('detects multiple content-extraction builtins', () => {
      const ast = new Parser('select links(), images(), toc()[0] where status = "done"').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.lazyLoading.requiresContent).toBe(true);
      expect(plan.lazyLoading.builtins).toEqual(['links', 'images', 'toc']);
    });
  });
  
  describe('Execution Plan', () => {
    it('creates execution plan without content loading', () => {
      const ast = new Parser('select title, status where status = "done"').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.executionOrder).toEqual([
        'file_discovery',
        'frontmatter_loading',
        'post_filtering',
        'field_projection'
      ]);
    });
    
    it('creates execution plan with content loading', () => {
      const ast = new Parser('select title, toc() where status = "done"').parse();
      const analyzer = new QueryAnalyzer(ast);
      const plan = analyzer.analyze();
      
      expect(plan.executionOrder).toEqual([
        'file_discovery',
        'frontmatter_loading',
        'post_filtering',
        'content_loading',
        'builtin_toc',
        'field_projection'
      ]);
    });
  });
});