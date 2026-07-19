import { describe, it, expect, vi } from 'vitest';
import { reviewCommand } from '../src/commands/review.js';
import { runCouncil } from '../src/council.js';

vi.mock('../src/council.js', () => ({
  runCouncil: vi.fn(),
}));

describe('reviewCommand', () => {
  it('renders TOON output when judges respond', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'openai', model: 'gpt-4o', status: 'success', response: 'Ship it.' },
    ]);

    await reviewCommand('ship?', { models: 'openai' });

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('council[review]: "ship?"');
    expect(output).toContain('Ship it.');
    logSpy.mockRestore();
  });

  it('attaches file artifacts to the prompt', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-cli-'));
    fs.writeFileSync(path.join(dir, 'plan.md'), 'PLAN CONTENT');
    const cwd = process.cwd();
    process.chdir(dir);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'openai', model: 'gpt-4o', status: 'success', response: 'ok' },
    ]);

    try {
      await reviewCommand('question?', { models: 'openai', file: ['plan.md'] });
      const prompt = vi.mocked(runCouncil).mock.calls.at(-1)![1].prompt;
      expect(prompt).toContain('## Artifacts');
      expect(prompt).toContain('PLAN CONTENT');
      expect(prompt).toContain('question?');
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
      logSpy.mockRestore();
    }
  });

  it('errors clearly when --stdin is given with a terminal stdin', async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    await expect(reviewCommand('q', { models: 'openai', stdin: true })).rejects.toThrow(/terminal/);
    Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
  });

  it('respects COUNCIL_MAX_ARTIFACT_BYTES env override to truncate large files', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-capbytes-'));
    // Create a file larger than our override cap (50 bytes)
    fs.writeFileSync(path.join(dir, 'large.txt'), 'x'.repeat(100));
    const cwd = process.cwd();
    process.chdir(dir);

    const originalEnv = process.env.COUNCIL_MAX_ARTIFACT_BYTES;
    process.env.COUNCIL_MAX_ARTIFACT_BYTES = '50';

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'openai', model: 'gpt-4o', status: 'success', response: 'ok' },
    ]);

    try {
      await reviewCommand('question?', { models: 'openai', file: ['large.txt'] });
      const prompt = vi.mocked(runCouncil).mock.calls.at(-1)![1].prompt;
      expect(prompt).toContain('[truncated at');
      expect(prompt).toContain('question?');
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
      logSpy.mockRestore();
      if (originalEnv === undefined) {
        delete process.env.COUNCIL_MAX_ARTIFACT_BYTES;
      } else {
        process.env.COUNCIL_MAX_ARTIFACT_BYTES = originalEnv;
      }
    }
  });

  it('falls back to default cap when COUNCIL_MAX_ARTIFACT_BYTES is invalid', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-capbytes-invalid-'));
    // Create a small file that should NOT be truncated
    fs.writeFileSync(path.join(dir, 'small.txt'), 'test content');
    const cwd = process.cwd();
    process.chdir(dir);

    const originalEnv = process.env.COUNCIL_MAX_ARTIFACT_BYTES;
    process.env.COUNCIL_MAX_ARTIFACT_BYTES = 'not-a-number';

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'openai', model: 'gpt-4o', status: 'success', response: 'ok' },
    ]);

    try {
      await reviewCommand('question?', { models: 'openai', file: ['small.txt'] });
      const prompt = vi.mocked(runCouncil).mock.calls.at(-1)![1].prompt;
      expect(prompt).toContain('test content');
      expect(prompt).not.toContain('[truncated at');
      expect(prompt).toContain('question?');
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
      logSpy.mockRestore();
      if (originalEnv === undefined) {
        delete process.env.COUNCIL_MAX_ARTIFACT_BYTES;
      } else {
        process.env.COUNCIL_MAX_ARTIFACT_BYTES = originalEnv;
      }
    }
  });

  it('falls back to default cap when COUNCIL_MAX_ARTIFACT_BYTES is negative', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-capbytes-negative-'));
    // Create a small file that should NOT be truncated
    fs.writeFileSync(path.join(dir, 'small.txt'), 'test content');
    const cwd = process.cwd();
    process.chdir(dir);

    const originalEnv = process.env.COUNCIL_MAX_ARTIFACT_BYTES;
    process.env.COUNCIL_MAX_ARTIFACT_BYTES = '-5';

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(runCouncil).mockResolvedValue([
      { provider: 'openai', model: 'gpt-4o', status: 'success', response: 'ok' },
    ]);

    try {
      await reviewCommand('question?', { models: 'openai', file: ['small.txt'] });
      const prompt = vi.mocked(runCouncil).mock.calls.at(-1)![1].prompt;
      expect(prompt).toContain('test content');
      expect(prompt).not.toContain('[truncated at');
      expect(prompt).toContain('question?');
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
      logSpy.mockRestore();
      if (originalEnv === undefined) {
        delete process.env.COUNCIL_MAX_ARTIFACT_BYTES;
      } else {
        process.env.COUNCIL_MAX_ARTIFACT_BYTES = originalEnv;
      }
    }
  });
});
