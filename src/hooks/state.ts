import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HookPayload } from './payload.js';

interface StateEntry {
  file: string;
  cwd: string;
  ts: number;
}

export function resolveSessionKey(
  payload: HookPayload,
  warn: (msg: string) => void = defaultWarn
): string {
  const harness = sanitize(payload.harness ?? 'unknown');
  if (payload.sessionId) {
    return `${harness}-${sanitize(payload.sessionId)}`;
  }
  const cwd = payload.cwd ?? process.cwd();
  const hash = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 8);
  warn(
    `council-axi: session id missing from hook payload, using cwd-based key; ` +
    `edit tracking is shared across sessions in ${cwd}`
  );
  return `${harness}-cwd-${hash}`;
}

export function recordEdit(key: string, file: string, cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const entry: StateEntry = { file: path.resolve(cwd, file), cwd, ts: Date.now() };
  const target = stateFilePath(key, env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fd = fs.openSync(target, 'a');
  try {
    fs.writeSync(fd, JSON.stringify(entry) + '\n');
    fs.fsyncSync(fd); // durable before exit: the stop hook may fire immediately after
  } finally {
    fs.closeSync(fd);
  }
}

export function pendingEdits(key: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const target = stateFilePath(key, env);
  if (!fs.existsSync(target)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of fs.readFileSync(target, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    let entry: StateEntry;
    try {
      const parsed: unknown = JSON.parse(line);
      entry = parsed as StateEntry;
      if (typeof entry.file !== 'string') continue;
    } catch {
      continue; // killed-process partial write
    }
    if (!seen.has(entry.file)) {
      seen.add(entry.file);
      out.push(entry.file);
    }
  }
  return out;
}

export function clearSession(key: string, env: NodeJS.ProcessEnv = process.env): void {
  fs.rmSync(stateFilePath(key, env), { force: true });
}

export function stateFilePath(key: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0
    ? env.XDG_STATE_HOME
    : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'council-axi', `${sanitize(key)}.jsonl`);
}

function sanitize(text: string): string {
  return text.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function defaultWarn(msg: string): void {
  console.error(msg);
}
