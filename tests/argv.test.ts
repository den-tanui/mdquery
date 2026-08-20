// tests/argv.test.ts
import { describe, expect, it } from 'vitest';
import { collectPositionals, mergeDirContinuations } from '../src/argv';

describe('collectPositionals', () => {
  it('collects bare words, skipping option values', () => {
    expect(collectPositionals(['select x', '--dir', 'a,', 'b', '--json'])).toEqual([
      'select x',
      'b',
    ]);
  });

  it('handles inline --dir= values', () => {
    expect(collectPositionals(['--dir=a,', 'b', 'select x'])).toEqual(['b', 'select x']);
  });

  it('skips values of other value-taking options', () => {
    expect(collectPositionals(['-d', '3', '--format', 'table', 'select x'])).toEqual(['select x']);
  });
});

describe('mergeDirContinuations', () => {
  it('merges a path-like continuation after a trailing comma', () => {
    expect(mergeDirContinuations(['--dir', 'a,', '~/b', 'select x'])).toEqual([
      '--dir',
      'a,~/b',
      'select x',
    ]);
  });

  it('merges a bare-word continuation when another positional exists (query first)', () => {
    expect(mergeDirContinuations(['select x', '--dir', 'a,', 'b'])).toEqual([
      'select x',
      '--dir',
      'a,b',
    ]);
  });

  it('merges a bare-word continuation when another positional exists (query last)', () => {
    expect(mergeDirContinuations(['--dir', 'a,', 'b', 'select x'])).toEqual([
      '--dir',
      'a,b',
      'select x',
    ]);
  });

  it('does not merge the sole bare word (it is the query)', () => {
    expect(mergeDirContinuations(['--dir', 'a,', 'select x'])).toEqual(['--dir', 'a,', 'select x']);
  });

  it('does not merge when the next arg is a flag', () => {
    expect(mergeDirContinuations(['--dir', 'a,', '--json', 'select x'])).toEqual([
      '--dir',
      'a,',
      '--json',
      'select x',
    ]);
  });

  it('merges the inline --dir= form', () => {
    expect(mergeDirContinuations(['--dir=a,', 'b', 'select x'])).toEqual(['--dir=a,b', 'select x']);
  });

  it('leaves a plain comma list untouched', () => {
    expect(mergeDirContinuations(['--dir', 'a,b', 'select x'])).toEqual([
      '--dir',
      'a,b',
      'select x',
    ]);
  });

  it('leaves repeated --dir flags untouched', () => {
    expect(mergeDirContinuations(['--dir', 'a', '--dir', 'b', 'select x'])).toEqual([
      '--dir',
      'a',
      '--dir',
      'b',
      'select x',
    ]);
  });

  it('merges multiple continuations', () => {
    expect(mergeDirContinuations(['--dir', 'a,', 'b', '--dir', 'c,', 'd', 'select x'])).toEqual([
      '--dir',
      'a,b',
      '--dir',
      'c,d',
      'select x',
    ]);
  });

  it('does not merge a trailing comma with no continuation', () => {
    expect(mergeDirContinuations(['--dir', 'a,'])).toEqual(['--dir', 'a,']);
  });
});
