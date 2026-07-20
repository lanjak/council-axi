import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debateCommand } from '../../src/commands/debate.js';
import { runDebate } from '../../src/debate/loop.js';
import { loadConfig } from '../../src/config.js';
import type { DebateTurn } from '../../src/types.js';

vi.mock('../../src/debate/loop.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runDebate: vi.fn(),
}));
vi.mock('../../src/config.js', () => ({ loadConfig: vi.fn() }));

const t = (round: number, provider: string, verdict: 'agree' | 'disagree'): DebateTurn => ({
  round, provider, model: `${provider}-m`, status: 'success', response: `x\nVERDICT: ${verdict.toUpperCase()}`, verdict,
});

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: string) => { logs.push(s); });
  vi.mocked(loadConfig).mockReturnValue({
    providers: {
      kimi: { name: 'kimi', displayName: 'Kimi', apiKey: 'k', baseURL: 'https://x/v1', model: 'kimi-m' },
      deepseek: { name: 'deepseek', displayName: 'DeepSeek', apiKey: 'k', baseURL: 'https://x/v1', model: 'ds-m' },
    },
  });
});
afterEach(() => vi.restoreAllMocks());

describe('debateCommand', () => {
  it('runs a debate and prints the TOON output', async () => {
    vi.mocked(runDebate).mockResolvedValue({
      turns: [t(1, 'kimi', 'agree'), t(1, 'deepseek', 'agree')],
      status: 'consensus',
    });
    await debateCommand('should we?', {});
    const out = logs.join('\n');
    expect(out).toContain('council[debate]:');
    expect(out).toContain('consensus: reached in 1 of 5 rounds');
    expect(vi.mocked(runDebate).mock.calls[0][1]).toMatchObject({ maxRounds: 5, participate: false, models: ['kimi', 'deepseek'] });
  });

  it('honors --max-rounds and --models', async () => {
    vi.mocked(runDebate).mockResolvedValue({ turns: [t(1, 'kimi', 'agree')], status: 'cap' });
    await debateCommand('q', { models: 'kimi', maxRounds: '3' });
    expect(vi.mocked(runDebate).mock.calls[0][1]).toMatchObject({ maxRounds: 3, models: ['kimi'] });
  });

  it('rejects a non-numeric --max-rounds', async () => {
    await expect(debateCommand('q', { maxRounds: 'nope' })).rejects.toMatchObject({ code: 'BAD_ARG' });
  });

  it('rejects fewer than 2 requested judges', async () => {
    vi.mocked(loadConfig).mockReturnValue({ providers: { kimi: { name: 'kimi', displayName: 'Kimi', apiKey: 'k', baseURL: 'https://x/v1', model: 'kimi-m' } } });
    await expect(debateCommand('q', {})).rejects.toMatchObject({ code: 'NO_QUORUM' });
  });
});
