// tests/file-metadata.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir, userInfo } from 'os';
import { join } from 'path';
import { buildFileMetadata } from '../src/files';

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