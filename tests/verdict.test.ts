import { describe, it, expect } from 'vitest';
import { parseVerdict } from '../src/verdict.js';

describe('parseVerdict', () => {
  it('parses trailing AGREE', () => {
    expect(parseVerdict('I concur with kimi.\nVERDICT: AGREE')).toBe('agree');
  });
  it('parses trailing DISAGREE', () => {
    expect(parseVerdict('No.\nVERDICT: DISAGREE')).toBe('disagree');
  });
  it('is case-insensitive', () => {
    expect(parseVerdict('ok\nverdict: agree')).toBe('agree');
  });
  it('tolerates trailing whitespace', () => {
    expect(parseVerdict('ok\nVERDICT: AGREE   ')).toBe('agree');
  });
  it('last matching line wins', () => {
    expect(parseVerdict('VERDICT: AGREE\nchanged my mind\nVERDICT: DISAGREE')).toBe('disagree');
    expect(parseVerdict('VERDICT: DISAGREE\non reflection\nVERDICT: AGREE')).toBe('agree');
  });
  it('missing tag counts as disagree', () => {
    expect(parseVerdict('long reasoning, no tag')).toBe('disagree');
  });
  it('malformed tag counts as disagree', () => {
    expect(parseVerdict('VERDICT: MAYBE')).toBe('disagree');
    expect(parseVerdict('VERDICT AGREE')).toBe('disagree');
  });
  it('empty string counts as disagree', () => {
    expect(parseVerdict('')).toBe('disagree');
  });
});
