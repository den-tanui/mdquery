// tests/file-metadata.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir, userInfo } from 'os';
import { join } from 'path';
import { buildFileMetadata, FileOps } from '../src/files';
import { FastFileOps } from '../src/file-io';

describe('buildFileMetadata', () => {
  it('builds a metadata map from a file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdquery-meta-'));
    const f = join(dir, 'a.md');
    writeFileSync(f, '---\ntitle: A\n---\n');
    const meta = buildFileMetadata(f)!;
    expect(meta).toBeDefined();
    expect(meta.abspath).toBe(f);
    expect(meta.mtime).toBeInstanceOf(Date);
    expect(meta.atime).toBeInstanceOf(Date);
    expect(meta.ctime).toBeInstanceOf(Date);
    expect(meta.size).toBeGreaterThan(0);
    expect(meta.mode).toMatch(/^[rwx-]{9}$/);
    expect(meta.owner).toBe(userInfo().username);
    expect(meta.group).toBe(String(process.getgid()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when stat fails (missing file)', () => {
    expect(buildFileMetadata('/nonexistent/definitely-missing.md')).toBeUndefined();
  });
});

describe('read paths load metadata lazily', () => {
  it('FileOps.readFiles loads metadata only when requested', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdquery-meta-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n');
    const withMeta = await FileOps.readFiles(dir, { metadata: true });
    expect(withMeta[0].metadata).toBeDefined();
    expect(withMeta[0].metadata!.mtime).toBeInstanceOf(Date);
    const withoutMeta = await FileOps.readFiles(dir);
    expect(withoutMeta[0].metadata).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('FastFileOps.readFiles loads metadata only when analysis requires it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdquery-meta-'));
    writeFileSync(join(dir, 'a.md'), '---\ntitle: A\n---\n');
    const paths = await FastFileOps.listFiles(dir);
    const withMeta = await FastFileOps.readFiles(dir, paths, {
      requiresContent: false, bodyPredicates: [], requiresMetadata: true
    });
    expect(withMeta[0].metadata).toBeDefined();
    const withoutMeta = await FastFileOps.readFiles(dir, paths, {
      requiresContent: false, bodyPredicates: [], requiresMetadata: false
    });
    expect(withoutMeta[0].metadata).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});