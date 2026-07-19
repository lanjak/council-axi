import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveSessionKey,
  recordEdit,
  pendingEdits,
  clearSession,
  stateFilePath,
} from '../../src/hooks/state.js';

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-state-'));
  env = { XDG_STATE_HOME: dir };
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolveSessionKey', () => {
  it('prefixes with the harness when both are known', () => {
    expect(resolveSessionKey({ harness: 'claude-code', sessionId: 'abc' }))
      .toBe('claude-code-abc');
  });

  it('falls back to a cwd hash with a loud warning when sessionId is missing', () => {
    const warnings: string[] = [];
    const key = resolveSessionKey(
      { harness: 'pi', cwd: '/some/dir' },
      (m) => warnings.push(m)
    );

    expect(key).toMatch(/^pi-cwd-[0-9a-f]{8}$/);
    expect(warnings[0]).toContain('session id missing');
  });

  it('keeps different harnesses on the same sessionId apart', () => {
    expect(resolveSessionKey({ harness: 'pi', sessionId: 'abc' }))
      .not.toBe(resolveSessionKey({ harness: 'claude-code', sessionId: 'abc' }));
  });
});

describe('state store', () => {
  it('records, dedupes, and clears edits', () => {
    recordEdit('k1', 'src/a.ts', '/proj', env);
    recordEdit('k1', 'src/a.ts', '/proj', env);
    recordEdit('k1', '/abs/b.ts', '/proj', env);

    expect(pendingEdits('k1', env)).toEqual(['/proj/src/a.ts', '/abs/b.ts']);
    expect(fs.existsSync(stateFilePath('k1', env))).toBe(true);

    clearSession('k1', env);
    expect(pendingEdits('k1', env)).toEqual([]);
  });

  it('returns an empty list when no state file exists', () => {
    expect(pendingEdits('nope', env)).toEqual([]);
  });

  it('skips malformed lines instead of throwing', () => {
    fs.mkdirSync(path.dirname(stateFilePath('k2', env)), { recursive: true });
    fs.writeFileSync(
      stateFilePath('k2', env),
      '{"file":"/a.ts","cwd":"/","ts":1}\nnot json\n{"file":"/b.ts","cwd":"/","ts":2}\n'
    );

    expect(pendingEdits('k2', env)).toEqual(['/a.ts', '/b.ts']);
  });

  it('keeps state isolated per session key', () => {
    recordEdit('one', 'a.ts', '/p', env);
    recordEdit('two', 'b.ts', '/p', env);

    expect(pendingEdits('one', env)).toEqual(['/p/a.ts']);
    expect(pendingEdits('two', env)).toEqual(['/p/b.ts']);
  });
});
