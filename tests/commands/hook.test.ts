import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hookCommand } from '../../src/commands/hook.js';
import { runCouncil } from '../../src/council.js';
import { clearSession } from '../../src/hooks/state.js';
import { assembleArtifacts } from '../../src/artifacts.js';

vi.mock('../../src/council.js', () => ({
  runCouncil: vi.fn(),
}));

vi.mock('../../src/hooks/state.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/hooks/state.js')>('../../src/hooks/state.js');
  return {
    ...actual,
    clearSession: vi.fn(actual.clearSession),
  };
});

vi.mock('../../src/artifacts.js', () => ({
  assembleArtifacts: vi.fn(() => ({ blocks: [{ label: '--- git diff HEAD (1 B) ---', content: 'x', truncated: false }], totalBytes: 1, warnings: [] })),
  formatArtifactPreamble: vi.fn(() => '## Artifacts\n\n--- git diff HEAD (1 B) ---\nx\n\n'),
}));

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

function seedEdits(key: string, files: string[]) {
  const stateDir = path.join(dir, 'council-axi');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, `${key}.jsonl`),
    files.map((f) => JSON.stringify({ file: f, cwd: '/proj', ts: 1 })).join('\n') + '\n'
  );
}

const gateEnv = () => {
  process.env.COUNCIL_PROVIDERS = 'mimo,deepseek';
  process.env.MIMO_API_KEY = 'k';
  process.env.MIMO_BASE_URL = 'https://a/v1';
  process.env.MIMO_MODEL = 'm1';
  process.env.DEEPSEEK_API_KEY = 'k';
  process.env.DEEPSEEK_BASE_URL = 'https://b/v1';
  process.env.DEEPSEEK_MODEL = 'm2';
};
const clearGateEnv = () => {
  for (const v of ['COUNCIL_PROVIDERS', 'MIMO_API_KEY', 'MIMO_BASE_URL', 'MIMO_MODEL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL']) {
    delete process.env[v];
  }
};

describe('hookCommand stop gate', () => {
  beforeEach(() => {
    gateEnv();
    vi.mocked(runCouncil).mockReset();
    vi.mocked(clearSession).mockClear();
  });
  afterEach(clearGateEnv);

  const payload = JSON.stringify({ session_id: 'g1', harness: 'claude-code', cwd: '/proj' });

  it('exits 0 silently with no pending edits and never calls providers', async () => {
    await hookCommand('stop', { payload });
    expect(process.exitCode).toBe(0);
    expect(runCouncil).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('blocks (exit 2) on a majority-fail verdict, clears state, prints synthesis', async () => {
    seedEdits('claude-code-g1', ['/proj/a.ts']);
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'mimo', model: 'm1', status: 'success', response: 'bug\nVERDICT: fail' },
      { provider: 'deepseek', model: 'm2', status: 'success', response: 'also bad\nVERDICT: fail' },
    ]);

    await hookCommand('stop', { payload });

    expect(process.exitCode).toBe(2);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('VERDICT: fail');
    expect(errSpy.mock.calls.flat().join(' ')).toContain('fail');
    expect(fs.existsSync(path.join(dir, 'council-axi', 'claude-code-g1.jsonl'))).toBe(false);
  });

  it('passes (exit 0) when fails are not a majority and clears state', async () => {
    seedEdits('claude-code-g1', ['/proj/a.ts']);
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'mimo', model: 'm1', status: 'success', response: 'ok\nVERDICT: pass' },
      { provider: 'deepseek', model: 'm2', status: 'success', response: 'fine\nVERDICT: pass' },
    ]);

    await hookCommand('stop', { payload });

    expect(process.exitCode).toBe(0);
    expect(fs.existsSync(path.join(dir, 'council-axi', 'claude-code-g1.jsonl'))).toBe(false);
  });

  it('keeps the block verdict (exit 2, synthesis, no gate_error) even when clearSession throws', async () => {
    seedEdits('claude-code-g1', ['/proj/a.ts']);
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'mimo', model: 'm1', status: 'success', response: 'bug\nVERDICT: fail' },
      { provider: 'deepseek', model: 'm2', status: 'success', response: 'also bad\nVERDICT: fail' },
    ]);
    vi.mocked(clearSession).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied, unlink');
    });

    await hookCommand('stop', { payload });

    expect(process.exitCode).toBe(2);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('VERDICT: fail');
    expect(out).not.toContain('gate_error');
    const err = errSpy.mock.calls.flat().join(' ');
    expect(err).toContain('fail');
    expect(err).not.toContain('gate_error');
  });

  it('keeps the pass verdict (exit 0, pass message, no gate_error) even when clearSession throws', async () => {
    seedEdits('claude-code-g1', ['/proj/a.ts']);
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'mimo', model: 'm1', status: 'success', response: 'ok\nVERDICT: pass' },
      { provider: 'deepseek', model: 'm2', status: 'success', response: 'fine\nVERDICT: pass' },
    ]);
    vi.mocked(clearSession).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied, unlink');
    });

    await hookCommand('stop', { payload });

    expect(process.exitCode).toBe(0);
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toContain('pass');
    expect(out).not.toContain('gate_error');
  });

  it('fails open below quorum and KEEPS state for manual re-review', async () => {
    seedEdits('claude-code-g1', ['/proj/a.ts']);
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'mimo', model: 'm1', status: 'success', response: 'bad\nVERDICT: fail' },
      { provider: 'deepseek', model: 'm2', status: 'error', error: { message: 'rate limit' } },
    ]);

    await hookCommand('stop', { payload });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('gate_error');
    expect(fs.existsSync(path.join(dir, 'council-axi', 'claude-code-g1.jsonl'))).toBe(true);
  });

  it('exits 0 and clears state when edits are pending but the diff is empty, without calling runCouncil', async () => {
    seedEdits('claude-code-g1', ['/proj/a.ts']);
    vi.mocked(assembleArtifacts).mockReturnValueOnce({ blocks: [], totalBytes: 0, warnings: [] });

    await hookCommand('stop', { payload });

    expect(process.exitCode).toBe(0);
    expect(runCouncil).not.toHaveBeenCalled();
    expect(clearSession).toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, 'council-axi', 'claude-code-g1.jsonl'))).toBe(false);
  });

  it('fails open on an internal error and keeps state', async () => {
    seedEdits('claude-code-g1', ['/proj/a.ts']);
    vi.mocked(runCouncil).mockRejectedValue(new Error('catastrophic'));

    await hookCommand('stop', { payload });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('gate_error');
    expect(fs.existsSync(path.join(dir, 'council-axi', 'claude-code-g1.jsonl'))).toBe(true);
  });
});
