// tests/file-io.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastFileOps } from '../src/file-io';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

function makeTree(): string {
  const root = join(tmpdir(), `mdquery-fio-${randomUUID()}`);
  mkdirSync(join(root, 'sub', 'deep'), { recursive: true });
  mkdirSync(join(root, '.hidden'), { recursive: true });
  writeFileSync(join(root, 'top.md'), '---\ntitle: Top\n---\n');
  writeFileSync(join(root, 'sub', 'mid.md'), '---\ntitle: Mid\n---\n');
  writeFileSync(join(root, 'sub', 'deep', 'deep.md'), '---\ntitle: Deep\n---\n');
  writeFileSync(join(root, '.hidden', 'secret.md'), '---\ntitle: Secret\n---\n');
  writeFileSync(join(root, '.secret.md'), '---\ntitle: Secret File\n---\n');
  writeFileSync(join(root, 'notes.txt'), 'not markdown');
  return root;
}

function makeGitignoreTree(): string {
  const root = join(tmpdir(), `mdquery-fio-gi-${randomUUID()}`);
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'sub/\n');
  writeFileSync(join(root, 'top.md'), '---\ntitle: Top\n---\n');
  writeFileSync(join(root, 'sub', 'mid.md'), '---\ntitle: Mid\n---\n');
  writeFileSync(join(root, '.git', 'config.md'), '---\ntitle: Git Config\n---\n');
  return root;
}

describe('FastFileOps.listFiles', () => {
  let dir: string;
  beforeAll(() => { dir = makeTree(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('lists only .md files recursively by default', async () => {
    const files = await FastFileOps.listFiles(dir);
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['sub/deep/deep.md', 'sub/mid.md', 'top.md']);
  });

  it('respects depth 1 (top level only)', async () => {
    const files = await FastFileOps.listFiles(dir, { depth: 1 });
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['top.md']);
  });

  it('respects depth 2 (one subdirectory level)', async () => {
    const files = await FastFileOps.listFiles(dir, { depth: 2 });
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['sub/mid.md', 'top.md']);
  });

  it('skips hidden files by default, includes with hidden: true', async () => {
    const without = await FastFileOps.listFiles(dir);
    expect(without.some(f => f.includes('secret'))).toBe(false);
    const withHidden = await FastFileOps.listFiles(dir, { hidden: true });
    expect(withHidden.some(f => f.includes('secret'))).toBe(true);
  });

  it('returns absolute paths', async () => {
    const files = await FastFileOps.listFiles(dir);
    expect(files[0]).toMatch(/^\/.*\.md$/);
  });
});

describe('FastFileOps.listFiles gitignore + .git handling', () => {
  let dir: string;
  beforeAll(() => { dir = makeGitignoreTree(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('respects .gitignore (excludes sub/)', async () => {
    const files = await FastFileOps.listFiles(dir);
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['top.md']);
  });

  it('includes gitignored files when ignore: false', async () => {
    const files = await FastFileOps.listFiles(dir, { ignore: false });
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['sub/mid.md', 'top.md']);
  });

  it('always skips .git even with hidden: true', async () => {
    const files = await FastFileOps.listFiles(dir, { hidden: true });
    expect(files.some(f => f.includes('.git'))).toBe(false);
    const rel = files.map(f => f.replace(dir + '/', '')).sort();
    expect(rel).toEqual(['top.md']);
  });
});