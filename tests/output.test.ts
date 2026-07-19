import { describe, it, expect } from 'vitest';
import { renderTOON } from '../src/output.js';
import type { CouncilOutput } from '../src/types.js';

const sample: CouncilOutput = {
  prompt: 'Should we ship?',
  mode: 'review',
  judges: [
    { provider: 'kimi', model: 'kimi-k3', status: 'success', response: 'Yes' },
    { provider: 'deepseek', model: 'deepseek-v4-pro', status: 'error', error: { message: 'rate limit' } },
  ],
  synthesis: 'Yes',
  availableCount: 1,
  totalCount: 2,
};

describe('output', () => {
  it('renders TOON output with judge list', () => {
    const toon = renderTOON(sample);
    expect(toon).toContain('council[review]: "Should we ship?"');
    expect(toon).toContain('judges: 1 of 2 responded');
    expect(toon).toContain('kimi,kimi-k3,success,Yes');
    expect(toon).toContain('deepseek,deepseek-v4-pro,error,rate limit');
    expect(toon).toContain('help[');
  });

  it('previews a long prompt instead of echoing it in full', () => {
    const bigPrompt = 'x'.repeat(5000);
    const toon = renderTOON({ ...sample, prompt: bigPrompt });
    const header = toon.split('\n')[0];
    expect(header.length).toBeLessThan(300);
    expect(header).toContain('(5000 chars total)');
    expect(toon).not.toContain('x'.repeat(1000));
  });

  it('renders warnings when present', () => {
    const toon = renderTOON({ ...sample, warnings: ['not found: x.md', 'omitted (cap): y.md'] });
    expect(toon).toContain('warnings[2]:');
    expect(toon).toContain('not found: x.md');
  });
});
