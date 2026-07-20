import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDebate, roundOrder, CALLER } from '../../src/debate/loop.js';
import { loadProvider } from '../../src/providers/index.js';
import type { CouncilConfig } from '../../src/config.js';

vi.mock('../../src/providers/index.js', () => ({ loadProvider: vi.fn() }));

const config: CouncilConfig = {
  providers: {
    kimi: { name: 'kimi', displayName: 'Kimi', apiKey: 'k', baseURL: 'https://x/v1', model: 'kimi-m' },
    deepseek: { name: 'deepseek', displayName: 'DeepSeek', apiKey: 'k', baseURL: 'https://x/v1', model: 'ds-m' },
    mimo: { name: 'mimo', displayName: 'MiMo', apiKey: 'k', baseURL: 'https://x/v1', model: 'mm-m' },
  },
};

// Provider mock that answers per (provider, call#) from a script of responses.
function scriptProviders(script: Record<string, string[]>): void {
  const counts: Record<string, number> = {};
  vi.mocked(loadProvider).mockImplementation((name: string) => ({
    name,
    chat: vi.fn().mockImplementation(() => {
      const n = counts[name] ?? 0;
      counts[name] = n + 1;
      const responses = script[name] ?? [];
      if (n >= responses.length) return Promise.reject(new Error('script exhausted'));
      const r = responses[n];
      if (r === 'ERROR') return Promise.reject(new Error('boom'));
      return Promise.resolve({ content: r });
    }),
  }) as any);
}

beforeEach(() => vi.mocked(loadProvider).mockReset());

describe('roundOrder', () => {
  it('rotates the opener each round', () => {
    expect(roundOrder(['a', 'b', 'c'], 1)).toEqual(['a', 'b', 'c']);
    expect(roundOrder(['a', 'b', 'c'], 2)).toEqual(['b', 'c', 'a']);
    expect(roundOrder(['a', 'b', 'c'], 4)).toEqual(['a', 'b', 'c']);
  });
});

describe('runDebate', () => {
  it('reaches consensus and stops early', async () => {
    scriptProviders({
      kimi: ['pos A\nVERDICT: DISAGREE', 'ok\nVERDICT: AGREE'],
      deepseek: ['pos B\nVERDICT: DISAGREE', 'ok\nVERDICT: AGREE'],
    });
    const p = await runDebate(config, { prompt: 'q', models: ['kimi', 'deepseek'], participate: false, maxRounds: 5 });
    expect(p.status).toBe('consensus');
    expect(p.turns).toHaveLength(4); // 2 judges x 2 rounds
    expect(p.turns.filter((t) => t.round === 2).every((t) => t.verdict === 'agree')).toBe(true);
  });

  it('turns are sequential: each judge sees earlier same-round turns', async () => {
    const seen: string[] = [];
    vi.mocked(loadProvider).mockImplementation((name: string) => ({
      name,
      chat: vi.fn().mockImplementation((o: { prompt: string }) => {
        seen.push(`${name}:${o.prompt.includes('pos A') ? 'saw-A' : 'blind'}`);
        return Promise.resolve({ content: `pos ${name === 'kimi' ? 'A' : 'B'}\nVERDICT: AGREE` });
      }),
    }) as any);
    await runDebate(config, { prompt: 'q', models: ['kimi', 'deepseek'], participate: false, maxRounds: 5 });
    expect(seen).toEqual(['kimi:blind', 'deepseek:saw-A']);
  });

  it('hits the round cap without consensus', async () => {
    scriptProviders({
      kimi: Array(5).fill('no\nVERDICT: DISAGREE'),
      deepseek: Array(5).fill('yes\nVERDICT: AGREE'),
    });
    const p = await runDebate(config, { prompt: 'q', models: ['kimi', 'deepseek'], participate: false, maxRounds: 5 });
    expect(p.status).toBe('cap');
    expect(p.turns).toHaveLength(10);
  });

  it('throws NO_QUORUM when fewer than 2 judges survive round 1', async () => {
    scriptProviders({ kimi: ['pos\nVERDICT: DISAGREE'], deepseek: ['ERROR'] });
    await expect(
      runDebate(config, { prompt: 'q', models: ['kimi', 'deepseek'], participate: false, maxRounds: 5 })
    ).rejects.toMatchObject({ code: 'NO_QUORUM' });
  });

  it('mid-debate error excludes the judge from consensus; attrition below 2 ends debate', async () => {
    scriptProviders({
      kimi: ['a\nVERDICT: DISAGREE', 'ERROR'],
      deepseek: ['b\nVERDICT: DISAGREE', 'c\nVERDICT: AGREE'],
      mimo: ['d\nVERDICT: DISAGREE', 'ERROR'],
    });
    const p = await runDebate(config, { prompt: 'q', models: ['kimi', 'deepseek', 'mimo'], participate: false, maxRounds: 5 });
    expect(p.status).toBe('attrition');
    // errored judges keep round-1 turns in the transcript record
    expect(p.turns.filter((t) => t.provider === 'kimi' && t.status === 'success')).toHaveLength(1);
  });

  it('participate: pauses at the caller slot with caller last in round 1', async () => {
    scriptProviders({
      kimi: ['a\nVERDICT: DISAGREE'],
      deepseek: ['b\nVERDICT: DISAGREE'],
    });
    const p = await runDebate(config, { prompt: 'q', models: ['kimi', 'deepseek'], participate: true, maxRounds: 5 });
    expect(p.status).toBe('awaiting-caller');
    expect(p.nextTurn).toEqual({ round: 1, participant: CALLER });
    expect(p.turns).toHaveLength(2); // both judges spoke first
  });

  it('participate: resume continues mid-round and caller verdict gates consensus', async () => {
    scriptProviders({
      kimi: ['r2 kimi\nVERDICT: AGREE'],
      deepseek: ['r2 ds\nVERDICT: AGREE'],
    });
    const prior = [
      { round: 1, provider: 'kimi', model: 'kimi-m', status: 'success' as const, response: 'a\nVERDICT: AGREE', verdict: 'agree' as const },
      { round: 1, provider: 'deepseek', model: 'ds-m', status: 'success' as const, response: 'b\nVERDICT: AGREE', verdict: 'agree' as const },
      { round: 1, provider: CALLER, model: CALLER, status: 'success' as const, response: 'me\nVERDICT: DISAGREE', verdict: 'disagree' as const },
    ];
    // caller disagreed in round 1, so round 2 runs; round 2 order is deepseek, caller, kimi
    const p = await runDebate(
      config,
      { prompt: 'q', models: ['kimi', 'deepseek'], participate: true, maxRounds: 5 },
      { turns: prior, nextTurn: { round: 2, participant: 'deepseek' } }
    );
    expect(p.status).toBe('awaiting-caller');
    expect(p.nextTurn).toEqual({ round: 2, participant: CALLER });
  });

  it('participate: NO_QUORUM is still enforced when round 1 pauses at the caller slot', async () => {
    scriptProviders({ kimi: ['pos\nVERDICT: DISAGREE'], deepseek: ['ERROR'] });
    await expect(
      runDebate(config, { prompt: 'q', models: ['kimi', 'deepseek'], participate: true, maxRounds: 5 })
    ).rejects.toMatchObject({ code: 'NO_QUORUM' });
  });

  it('resume at a round boundary checks consensus for the completed prior round before starting a new round', async () => {
    // All three participants agreed in round 1's final recorded turns, but the
    // caller's agreeing turn is the one that just got appended by the caller
    // (resume.nextTurn points at round 2's first speaker). The engine must
    // detect consensus for round 1 on entry rather than launching round 2.
    scriptProviders({ kimi: [], deepseek: [] });
    const prior = [
      { round: 1, provider: 'kimi', model: 'kimi-m', status: 'success' as const, response: 'a\nVERDICT: AGREE', verdict: 'agree' as const },
      { round: 1, provider: 'deepseek', model: 'ds-m', status: 'success' as const, response: 'b\nVERDICT: AGREE', verdict: 'agree' as const },
      { round: 1, provider: CALLER, model: CALLER, status: 'success' as const, response: 'me\nVERDICT: AGREE', verdict: 'agree' as const },
    ];
    const roundTwoFirstSpeaker = roundOrder(['kimi', 'deepseek', CALLER], 2)[0];
    const p = await runDebate(
      config,
      { prompt: 'q', models: ['kimi', 'deepseek'], participate: true, maxRounds: 5 },
      { turns: prior, nextTurn: { round: 2, participant: roundTwoFirstSpeaker } }
    );
    expect(p.status).toBe('consensus');
    expect(p.turns).toHaveLength(3);
  });
});
