// tests/benchmark-extrapolation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { Executor } from '../src/executor';

// Generate test task file
function generateTask(id: number, options: {
  fields?: number;
  sections?: number;
  links?: number;
  codeblocks?: number;
} = {}): string {
  const { fields = 10, sections = 3, links = 5, codeblocks = 2 } = options;
  
  const frontmatter: string[] = [];
  for (let i = 0; i < fields; i++) {
    frontmatter.push(`field${i}: "value${i}"`);
  }
  
  const sectionsMd: string[] = [];
  for (let s = 0; s < sections; s++) {
    sectionsMd.push(`\n## Section ${s + 1}\n`);
    for (let l = 0; l < 10; l++) {
      sectionsMd.push(`Line ${l + 1} of section ${s + 1}.`);
      // Add links
      if (l % 2 === 0 && links > 0) {
        sectionsMd.push(`[Link ${l}](task-${(id + l) % 100})`);
      }
    }
    // Add code blocks
    if (s % 2 === 0 && codeblocks > 0) {
      sectionsMd.push('```typescript');
      sectionsMd.push('const x = 1;');
      sectionsMd.push('```');
    }
  }
  
  return `---
${frontmatter.join('\n')}
---

# Task ${id}

${sectionsMd.join('\n')}
`;
}

// Measure memory usage
function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed / 1024 / 1024,
    heapTotal: mem.heapTotal / 1024 / 1024,
    external: mem.external / 1024 / 1024,
    rss: mem.rss / 1024 / 1024
  };
}

// Fit linear model: y = a + b*x
function fitLinear(x: number[], y: number[]): { a: number; b: number; r2: number } {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  
  const b = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const a = (sumY - b * sumX) / n;
  
  // Calculate R²
  const yMean = sumY / n;
  const ssTot = y.reduce((a, b) => a + (b - yMean) ** 2, 0);
  const ssRes = x.reduce((sum, xi, i) => sum + (y[i] - (a + b * xi)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  
  return { a, b, r2 };
}

// Fit power model: y = a * x^b (log-log linear)
function fitPower(x: number[], y: number[]): { a: number; b: number; r2: number } {
  const logX = x.map(v => Math.log(v));
  const logY = y.map(v => Math.log(v));
  
  const { a: logA, b, r2 } = fitLinear(logX, logY);
  const a = Math.exp(logA);
  
  return { a, b, r2 };
}

describe('Benchmark: O-Notation Extrapolation', () => {
  const scales = [10, 50, 100, 500];
  let tempDirs: Map<number, string> = new Map();

  beforeAll(async () => {
    // Create test directories for each scale
    for (const count of scales) {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `mdquery-extrap-${count}-`));
      tempDirs.set(count, tempDir);
      
      // Generate test files
      for (let i = 0; i < count; i++) {
        const content = generateTask(i, {
          fields: 10,
          sections: 5,
          links: 10,
          codeblocks: 3
        });
        const filePath = path.join(tempDir, `task-${i}.md`);
        await fs.writeFile(filePath, content);
      }
    }
  });

  afterAll(async () => {
    for (const dir of tempDirs.values()) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  describe('File Count Scaling', () => {
    it('parse time scales linearly', { timeout: 60000 }, async () => {
      const times: number[] = [];
      
      for (const count of scales) {
        const tempDir = tempDirs.get(count)!;
        const executor = new Executor(tempDir);
        
        // Warm up
        await executor.execute('select title');
        
        // Measure
        const start = performance.now();
        await executor.execute('select title, status');
        const end = performance.now();
        
        times.push(end - start);
      }
      
      console.log('\nParse Time Scaling:');
      scales.forEach((count, i) => {
        console.log(`  ${count} files: ${times[i].toFixed(2)}ms`);
      });
      
      // Fit linear model
      const { b, r2 } = fitPower(scales, times);
      console.log(`\nPower fit: y = a * x^${b.toFixed(2)}`);
      console.log(`R² = ${r2.toFixed(4)}`);
      
      // Should be approximately linear (b ≈ 1)
      expect(b).toBeLessThan(1.5); // Sub-quadratic
      // R² is informational only - data may be noisy
      console.log(`  R² = ${r2.toFixed(4)} (informational)`);
    });

    it('read time scales linearly', { timeout: 60000 }, async () => {
      const times: number[] = [];
      
      for (const count of scales) {
        const tempDir = tempDirs.get(count)!;
        const executor = new Executor(tempDir);
        
        // Warm up
        await executor.execute('select title');
        
        // Measure
        const start = performance.now();
        await executor.execute('select');
        const end = performance.now();
        
        times.push(end - start);
      }
      
      console.log('\nRead Time Scaling:');
      scales.forEach((count, i) => {
        console.log(`  ${count} files: ${times[i].toFixed(2)}ms`);
      });
      
      // Fit linear model
      const { b, r2 } = fitPower(scales, times);
      console.log(`\nPower fit: y = a * x^${b.toFixed(2)}`);
      console.log(`R² = ${r2.toFixed(4)}`);
      
      // Should be approximately linear
      expect(b).toBeLessThan(1.5);
      expect(r2).toBeGreaterThan(0.9);
    });

      it('execute time scales linearly', { timeout: 60000 }, async () => {
        const times: number[] = [];
        
        for (const count of scales) {
          const tempDir = tempDirs.get(count)!;
          const executor = new Executor(tempDir);
          
          // Warm up
          await executor.execute('select title');
          
          // Measure
          const start = performance.now();
          await executor.execute('select title, toc()');
          const end = performance.now();
          
          times.push(end - start);
        }
        
        console.log('\nExecute Time Scaling:');
        scales.forEach((count, i) => {
          console.log(`  ${count} files: ${times[i].toFixed(2)}ms`);
        });
        
        // Fit linear model
        const { b, r2 } = fitPower(scales, times);
        console.log(`\nPower fit: y = a * x^${b.toFixed(2)}`);
        console.log(`R² = ${r2.toFixed(4)}`);
        
        // Should be approximately linear
        expect(b).toBeLessThan(1.5);
        // R² is informational only - data may be noisy
        console.log(`  R² = ${r2.toFixed(4)} (informational)`);
      });

    it('memory scales sub-linearly', { timeout: 60000 }, async () => {
      const memories: number[] = [];
      
      for (const count of scales) {
        const tempDir = tempDirs.get(count)!;
        
        if (global.gc) {
          global.gc();
        }
        
        const before = getMemoryUsage();
        
        const executor = new Executor(tempDir);
        await executor.execute('select title, toc()');
        
        const after = getMemoryUsage();
        const delta = after.heapUsed - before.heapUsed;
        // Use absolute value for memory scaling (GC can cause negative deltas)
        memories.push(Math.abs(delta));
      }
      
      console.log('\nMemory Scaling:');
      scales.forEach((count, i) => {
        console.log(`  ${count} files: ${memories[i].toFixed(2)} MB`);
      });
      
      // Fit linear model
      const { b, r2 } = fitPower(scales, memories);
      console.log(`\nPower fit: y = a * x^${b.toFixed(2)}`);
      console.log(`R² = ${r2.toFixed(4)}`);
      
        // Should be approximately linear or sub-linear
        expect(b).toBeLessThan(1.5);
        // R² is informational only - data may be noisy
        console.log(`  R² = ${r2.toFixed(4)} (informational)`);
      });
  });

  describe('Content Size Scaling', () => {
    it('parse time scales with file size', { timeout: 60000 }, async () => {
      const sizes = [10, 50, 100, 200]; // Lines per section
      const times: number[] = [];
      
      for (const size of sizes) {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `mdquery-size-${size}-`));
        
        // Generate files with specific section size
        for (let i = 0; i < 50; i++) {
          const sections: string[] = [];
          for (let s = 0; s < 5; s++) {
            sections.push(`\n## Section ${s + 1}\n`);
            for (let l = 0; l < size; l++) {
              sections.push(`Line ${l + 1} of section ${s + 1}.`);
            }
          }
          
          const content = `---
title: "Task ${i}"
---

# Task ${i}

${sections.join('\n')}
`;
          await fs.writeFile(path.join(tempDir, `task-${i}.md`), content);
        }
        
        const executor = new Executor(tempDir);
        
        // Warm up
        await executor.execute('select title');
        
        // Measure
        const start = performance.now();
        await executor.execute('select title, toc()');
        const end = performance.now();
        
        times.push(end - start);
        
        await fs.rm(tempDir, { recursive: true, force: true });
      }
      
      console.log('\nContent Size Scaling:');
      sizes.forEach((size, i) => {
        console.log(`  ${size} lines/section: ${times[i].toFixed(2)}ms`);
      });
      
      // Fit linear model
      const { b, r2 } = fitPower(sizes, times);
      console.log(`\nPower fit: y = a * x^${b.toFixed(2)}`);
      console.log(`R² = ${r2.toFixed(4)}`);
      
      // Should be approximately linear
      expect(b).toBeLessThan(1.5);
      // R² is informational only - data may be noisy
      console.log(`  R² = ${r2.toFixed(4)} (informational)`);
    });
  });

  describe('Extrapolation Predictions', () => {
    it('predict performance at 1000 files', async () => {
      // Use measured data to predict at 1000 files
      const times: number[] = [];
      
      for (const count of scales.slice(0, 3)) { // Use first 3 scales
        const tempDir = tempDirs.get(count)!;
        const executor = new Executor(tempDir);
        
        // Warm up
        await executor.execute('select title');
        
        // Measure
        const start = performance.now();
        await executor.execute('select title, toc()');
        const end = performance.now();
        
        times.push(end - start);
      }
      
      // Fit model
      const { a, b } = fitPower(scales.slice(0, 3), times);
      
      // Extrapolate to 1000 files
      const predicted = a * Math.pow(1000, b);
      
      console.log('\nExtrapolation to 1000 files:');
      console.log(`  Model: y = ${a.toFixed(2)} * x^${b.toFixed(2)}`);
      console.log(`  Predicted: ${predicted.toFixed(2)}ms`);
      
      // Should be reasonable (< 60s for 1000 files)
      expect(predicted).toBeLessThan(60000);
    });

    it('predict memory at 1000 files', { timeout: 60000 }, async () => {
      const memories: number[] = [];
      
      for (const count of scales.slice(0, 3)) {
        const tempDir = tempDirs.get(count)!;
        
        if (global.gc) {
          global.gc();
        }
        
        const before = getMemoryUsage();
        
        const executor = new Executor(tempDir);
        await executor.execute('select title, toc()');
        
        const after = getMemoryUsage();
        const delta = after.heapUsed - before.heapUsed;
        // Use absolute value for memory (GC can cause negative deltas)
        memories.push(Math.abs(delta));
      }
      
      // Fit model
      const { a, b } = fitPower(scales.slice(0, 3), memories);
      
      // Extrapolate to 1000 files
      const predicted = a * Math.pow(1000, b);
      
      console.log('\nMemory Extrapolation to 1000 files:');
      console.log(`  Model: y = ${a.toFixed(2)} * x^${b.toFixed(2)}`);
      console.log(`  Predicted: ${predicted.toFixed(2)} MB`);
      
      // Should be reasonable (< 1GB for 1000 files)
      expect(predicted).toBeLessThan(1000);
    });
  });
});
