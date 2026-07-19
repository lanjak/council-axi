import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import ignore, { type Ignore } from 'ignore';
import { CouncilError } from './errors.js';

export interface ArtifactBlock {
  label: string;
  content: string;
  truncated: boolean;
}

export interface ArtifactBundle {
  blocks: ArtifactBlock[];
  totalBytes: number;
  warnings: string[];
}

export interface AssembleOptions {
  files?: string[];
  diff?: { range?: string; paths?: string[] };
  stdin?: string;
  capBytes?: number;
  cwd?: string;
}

export const DEFAULT_CAP_BYTES = 400_000;

const ALWAYS_SKIP = new Set(['node_modules', '.git']);

export function assembleArtifacts(options: AssembleOptions): ArtifactBundle {
  const cwd = options.cwd ?? process.cwd();
  const warnings: string[] = [];
  const explicit: ArtifactBlock[] = [];
  const expanded: ArtifactBlock[] = [];

  for (const input of options.files ?? []) {
    const full = path.resolve(cwd, input);
    if (!fs.existsSync(full)) {
      warnings.push(`not found: ${input}`);
      continue;
    }
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const file of expandDirectory(full, cwd)) {
        const block = readFileBlock(file, cwd, warnings);
        if (block) expanded.push(block);
      }
    } else {
      const block = readFileBlock(full, cwd, warnings);
      if (block) explicit.push(block);
    }
  }

  if (options.stdin) {
    explicit.push({
      label: '--- stdin ---',
      content: options.stdin,
      truncated: false,
    });
  }

  const diffBlocks: ArtifactBlock[] = [];
  if (options.diff !== undefined) {
    const diffBlock = gitDiffBlock(options.diff, cwd);
    if (diffBlock) diffBlocks.push(diffBlock);
  }

  // Priority order: explicit --file blocks, diff, then directory expansions.
  // Cap: each block truncated to 25% of the remaining budget; when the budget
  // is exhausted the rest are omitted and named in warnings.
  const capBytes = options.capBytes ?? DEFAULT_CAP_BYTES;
  let remaining = capBytes;
  const blocks: ArtifactBlock[] = [];

  const applyBudget = (block: ArtifactBlock): boolean => {
    if (remaining <= 0) return false;
    const size = Buffer.byteLength(block.content);
    const perFileCap = Math.max(1, Math.floor(remaining * 0.25));
    if (size > perFileCap) {
      const cut = Buffer.from(block.content).subarray(0, perFileCap).toString('utf8');
      const marker = `\n[truncated at ${perFileCap} of ${size} bytes]`;
      blocks.push({
        label: block.label.replace(' ---', ', truncated ---'),
        content: cut + marker,
        truncated: true,
      });
      remaining -= Buffer.byteLength(cut + marker);
    } else {
      blocks.push(block);
      remaining -= size;
    }
    return true;
  };

  const ordered = [...explicit, ...diffBlocks, ...expanded];
  for (const block of ordered) {
    if (!applyBudget(block)) {
      const omittedFrom = ordered.indexOf(block);
      for (const skipped of ordered.slice(omittedFrom)) {
        warnings.push(`omitted (artifact cap ${formatBytes(capBytes)} reached): ${labelName(skipped.label)}`);
      }
      break;
    }
  }

  return {
    blocks,
    totalBytes: blocks.reduce((n, b) => n + Buffer.byteLength(b.content), 0),
    warnings,
  };
}

function labelName(label: string): string {
  return label.replace(/^--- /, '').replace(/ ---$/, '');
}

function readFileBlock(full: string, cwd: string, warnings: string[]): ArtifactBlock | undefined {
  const rel = path.relative(cwd, full);
  const fd = fs.openSync(full, 'r');
  try {
    const head = Buffer.alloc(8192);
    const read = fs.readSync(fd, head, 0, 8192, 0);
    if (isBinary(head.subarray(0, read))) {
      warnings.push(`skipped binary file: ${rel}`);
      return undefined;
    }
    const content = fs.readFileSync(full, 'utf8');
    const size = Buffer.byteLength(content);
    return { label: `--- ${rel} (${formatBytes(size)}) ---`, content, truncated: false };
  } finally {
    fs.closeSync(fd);
  }
}

function isBinary(head: Buffer): boolean {
  if (head.length >= 2) {
    const bom = head[0] === 0xff && head[1] === 0xfe;
    const beBom = head[0] === 0xfe && head[1] === 0xff;
    if (bom || beBom) return true;
  }
  return head.includes(0x00);
}

function expandDirectory(dir: string, cwd: string): string[] {
  const rules: { base: string; ig: Ignore }[] = [];
  const results: string[] = [];

  function loadRule(directory: string) {
    const file = path.join(directory, '.gitignore');
    if (fs.existsSync(file)) {
      rules.push({ base: directory, ig: ignore().add(fs.readFileSync(file, 'utf8')) });
    }
  }

  function ignored(full: string, isDir: boolean): boolean {
    for (const rule of rules) {
      if (full.startsWith(rule.base + path.sep)) {
        const rel = path.relative(rule.base, full);
        if (rule.ig.ignores(rel + (isDir ? '/' : ''))) return true;
      }
    }
    return false;
  }

  function walk(current: string) {
    loadRule(current);
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (ignored(full, entry.isDirectory())) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) results.push(full);
    }
  }

  walk(dir);
  return results;
}

function gitDiffBlock(spec: { range?: string; paths?: string[] }, cwd: string): ArtifactBlock | undefined {
  const range = spec.range ?? 'HEAD';
  const args = ['diff', range];
  if (spec.paths && spec.paths.length > 0) {
    args.push('--', ...spec.paths);
  }

  let content: string;
  try {
    content = execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // Covers both "not a git repository" (exit 128) and a missing git binary
    // (ENOENT) - both surface as the same user-facing error.
    throw new CouncilError(
      `--diff requires a git repository and the git binary (cwd: ${cwd})`,
      'NOT_A_REPO'
    );
  }

  if (content.trim().length === 0) return undefined;
  const size = Buffer.byteLength(content);
  return { label: `--- git diff ${range} (${formatBytes(size)}) ---`, content, truncated: false };
}

export function formatArtifactPreamble(bundle: ArtifactBundle): string {
  if (bundle.blocks.length === 0) return '';
  let out = '## Artifacts\n\n';
  for (const block of bundle.blocks) {
    out += `${block.label}\n${block.content}\n\n`;
  }
  return out;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
