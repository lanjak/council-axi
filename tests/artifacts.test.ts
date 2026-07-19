import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assembleArtifacts } from '../src/artifacts.js';
import { CouncilError } from '../src/errors.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-artifacts-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string | Buffer) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('assembleArtifacts - file collection', () => {
  it('attaches a single explicit file with a labeled block', () => {
    write('plan.md', 'hello plan');
    const bundle = assembleArtifacts({ files: ['plan.md'], cwd: dir });

    expect(bundle.blocks).toHaveLength(1);
    expect(bundle.blocks[0].label).toBe('--- plan.md (10 B) ---');
    expect(bundle.blocks[0].content).toBe('hello plan');
    expect(bundle.blocks[0].truncated).toBe(false);
    expect(bundle.warnings).toEqual([]);
  });

  it('warns and continues when an explicit file is missing', () => {
    write('a.md', 'A');
    const bundle = assembleArtifacts({ files: ['nope.md', 'a.md'], cwd: dir });

    expect(bundle.blocks).toHaveLength(1);
    expect(bundle.warnings[0]).toContain('nope.md');
  });

  it('expands a directory, sorted, skipping node_modules and .git', () => {
    write('src/b.ts', 'B');
    write('src/a.ts', 'A');
    write('src/node_modules/x/index.js', 'junk');
    write('src/.git/config', 'junk');
    const bundle = assembleArtifacts({ files: ['src'], cwd: dir });

    expect(bundle.blocks.map((b) => b.label)).toEqual([
      '--- src/a.ts (1 B) ---',
      '--- src/b.ts (1 B) ---',
    ]);
  });

  it('respects .gitignore including negation', () => {
    write('pkg/.gitignore', '*.log\n!keep.log\n');
    write('pkg/debug.log', 'skip me');
    write('pkg/keep.log', 'keep me');
    write('pkg/code.ts', 'code');
    const bundle = assembleArtifacts({ files: ['pkg'], cwd: dir });

    const labels = bundle.blocks.map((b) => b.label);
    expect(labels).toContain('--- pkg/keep.log (7 B) ---');
    expect(labels).toContain('--- pkg/code.ts (4 B) ---');
    expect(labels.some((l) => l.includes('debug.log'))).toBe(false);
  });

  it('skips binary files with a warning', () => {
    write('bin.dat', Buffer.from([0x89, 0x50, 0x00, 0x47]));
    write('text.md', 'text');
    const bundle = assembleArtifacts({ files: ['bin.dat', 'text.md'], cwd: dir });

    expect(bundle.blocks).toHaveLength(1);
    expect(bundle.warnings[0]).toContain('bin.dat');
    expect(bundle.warnings[0]).toContain('binary');
  });

  it('skips UTF-16 BOM files with a warning', () => {
    write('utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi', 'utf16le')]));
    const bundle = assembleArtifacts({ files: ['utf16.txt'], cwd: dir });

    expect(bundle.blocks).toHaveLength(0);
    expect(bundle.warnings[0]).toContain('utf16.txt');
  });
});

describe('assembleArtifacts - cap enforcement', () => {
  it('marks truncated files in the label', () => {
    write('big.md', 'x'.repeat(10_000));
    const bundle = assembleArtifacts({ files: ['big.md'], cwd: dir, capBytes: 1000 });

    expect(bundle.blocks[0].truncated).toBe(true);
    expect(bundle.blocks[0].label).toContain('truncated');
    // Content includes 250 bytes of text plus marker (which shows: \n[truncated at 250 of 10000 bytes])
    expect(bundle.blocks[0].content.startsWith('x'.repeat(250))).toBe(true);
    expect(bundle.blocks[0].content).toContain('[truncated at 250 of 10000 bytes]');
  });

  it('a single large explicit file is never crowded out by directory expansion', () => {
    write('explicit.md', 'E'.repeat(900));
    write('dir/a.md', 'A'.repeat(900));
    write('dir/b.md', 'B'.repeat(900));
    const bundle = assembleArtifacts({ files: ['explicit.md', 'dir'], cwd: dir, capBytes: 1000 });

    expect(bundle.blocks[0].label).toContain('explicit.md');
    expect(bundle.blocks[0].truncated).toBe(true);
    // Under correct cap logic, all blocks are truncated, not omitted
    expect(bundle.blocks.some((b) => b.label.includes('dir/'))).toBe(true);
    expect(bundle.blocks.every((b) => b.truncated)).toBe(true);
    expect(bundle.warnings.some((w) => w.includes('omitted'))).toBe(false);
  });

  it('omits blocks past an exhausted cap and names them in warnings', () => {
    write('one.md', '1'.repeat(1000));
    write('two.md', '2'.repeat(800));
    write('three.md', '3'.repeat(700));
    const bundle = assembleArtifacts({ files: ['one.md', 'two.md', 'three.md'], cwd: dir, capBytes: 60 });

    // First file truncated to 25% of 60 = 15 bytes (plus marker ~23 bytes = ~38 total), remaining ~22
    // Second file truncated to 25% of 22 = 5 bytes (plus marker ~24 bytes = ~29 total), remaining negative
    // Third file: remaining <= 0 at start, so omitted
    expect(bundle.blocks).toHaveLength(2);
    expect(bundle.blocks.every((b) => b.truncated)).toBe(true);
    expect(bundle.warnings.filter((w) => w.includes('omitted'))).toHaveLength(1);
  });
});

function git(args: string[]) {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

function initRepo() {
  git(['init']);
  git(['config', 'user.email', 'test@test']);
  git(['config', 'user.name', 'test']);
}

describe('assembleArtifacts - git diff', () => {
  it('attaches staged and unstaged changes by default (git diff HEAD)', () => {
    initRepo();
    write('tracked.md', 'original');
    git(['add', '.']);
    git(['commit', '-m', 'init']);
    write('tracked.md', 'changed unstaged');
    write('staged.md', 'staged new');
    git(['add', 'staged.md']);

    const bundle = assembleArtifacts({ diff: {}, cwd: dir });
    expect(bundle.blocks).toHaveLength(1);
    expect(bundle.blocks[0].label).toContain('git diff HEAD');
    expect(bundle.blocks[0].content).toContain('changed unstaged');
    expect(bundle.blocks[0].content).toContain('staged new');
  });

  it('passes a range through', () => {
    initRepo();
    write('a.md', 'one');
    git(['add', '.']);
    git(['commit', '-m', 'one']);
    write('a.md', 'two');
    git(['add', '.']);
    git(['commit', '-m', 'two']);

    const bundle = assembleArtifacts({ diff: { range: 'HEAD~1' }, cwd: dir });
    expect(bundle.blocks[0].label).toContain('git diff HEAD~1');
    expect(bundle.blocks[0].content).toContain('two');
  });

  it('restricts to paths when given', () => {
    initRepo();
    write('keep.md', 'keep original');
    write('other.md', 'other original');
    git(['add', '.']);
    git(['commit', '-m', 'init']);
    write('keep.md', 'keep changed');
    write('other.md', 'other changed');

    const bundle = assembleArtifacts({ diff: { paths: [path.join(dir, 'keep.md')] }, cwd: dir });
    expect(bundle.blocks[0].content).toContain('keep changed');
    expect(bundle.blocks[0].content).not.toContain('other changed');
  });

  it('produces no block for an empty diff', () => {
    initRepo();
    write('a.md', 'same');
    git(['add', '.']);
    git(['commit', '-m', 'init']);

    const bundle = assembleArtifacts({ diff: {}, cwd: dir });
    expect(bundle.blocks).toHaveLength(0);
    expect(bundle.warnings).toEqual([]);
  });

  it('throws NOT_A_REPO outside a git repository', () => {
    try {
      assembleArtifacts({ diff: {}, cwd: dir });
      expect.fail('expected assembleArtifacts to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CouncilError);
      expect((err as CouncilError).code).toBe('NOT_A_REPO');
    }
  });
});

describe('formatArtifactPreamble', () => {
  it('renders blocks with labels and returns empty for nothing', async () => {
    const { formatArtifactPreamble } = await import('../src/artifacts.js');
    expect(formatArtifactPreamble({ blocks: [], totalBytes: 0, warnings: [] })).toBe('');

    write('a.md', 'AAA');
    const bundle = assembleArtifacts({ files: ['a.md'], cwd: dir });
    const preamble = formatArtifactPreamble(bundle);
    expect(preamble).toBe('## Artifacts\n\n--- a.md (3 B) ---\nAAA\n\n');
  });
});
