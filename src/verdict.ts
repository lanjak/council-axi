import type { Verdict } from './types.js';

const TAG = /^VERDICT:\s*(AGREE|DISAGREE)\s*$/i;

// Missing or malformed tags count as disagree: fail safe toward continuing
// the debate, never toward false consensus.
export function parseVerdict(text: string): Verdict {
  for (const line of text.split('\n').reverse()) {
    const m = TAG.exec(line.trim());
    if (m) return m[1].toLowerCase() as Verdict;
  }
  return 'disagree';
}
