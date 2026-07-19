import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hookCommand } from '../../src/commands/hook.js';

let dir: string;
let originalXdg: string | undefined;
let originalExitCode: number | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-hook-'));
  originalXdg = process.env.XDG_STATE_HOME;
  originalExitCode = process.exitCode;
  process.env.XDG_STATE_HOME = dir;
  process.exitCode = 0;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env.XDG_STATE_HOME = originalXdg;
  process.exitCode = originalExitCode;
  logSpy.mockRestore();
  errSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('hookCommand', () => {
  it('rejects an unknown event with the event list on stderr and exit 1', async () => {
    await hookCommand('pre-edit', {});
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls[0][0]).toContain('session-start');
    expect(errSpy.mock.calls[0][0]).toContain('post-edit');
    expect(errSpy.mock.calls[0][0]).toContain('stop');
  });

  it('rejects a missing event the same way', async () => {
    await hookCommand(undefined, {});
    expect(process.exitCode).toBe(1);
  });

  it('session-start prints provider availability and exits 0', async () => {
    process.env.COUNCIL_PROVIDERS = 'mimo';
    process.env.MIMO_API_KEY = 'k';
    process.env.MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';
    process.env.MIMO_MODEL = 'mimo-v2.5-pro';

    await hookCommand('session-start', { payload: '{"session_id":"s1","cwd":"/p"}' });

    expect(process.exitCode).toBe(0);
    const out = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('mimo');
    delete process.env.COUNCIL_PROVIDERS;
    delete process.env.MIMO_API_KEY;
    delete process.env.MIMO_BASE_URL;
    delete process.env.MIMO_MODEL;
  });

  it('post-edit records all payload files and exits 0 silently', async () => {
    await hookCommand('post-edit', {
      payload: JSON.stringify({
        session_id: 's1',
        cwd: '/proj',
        harness: 'claude-code',
        files: ['/proj/a.ts', 'src/b.ts'],
      }),
    });

    expect(process.exitCode).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();

    const stateFile = path.join(dir, 'council-axi', 'claude-code-s1.jsonl');
    const lines = fs.readFileSync(stateFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('/proj/a.ts');
    expect(lines[1]).toContain('/proj/src/b.ts');
  });

  it('post-edit warns loudly when the session id is missing', async () => {
    await hookCommand('post-edit', {
      payload: JSON.stringify({ cwd: '/proj', files: ['/proj/a.ts'] }),
    });

    expect(process.exitCode).toBe(0);
    expect(errSpy.mock.calls.flat().join(' ')).toContain('session id missing');
  });

  it('session-start never fails, even on a garbage payload', async () => {
    await hookCommand('session-start', { payload: 'not json{{{' });
    expect(process.exitCode).toBe(0);
  });
});
