import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../src/providers/openai-compatible.js';

const config = {
  name: 'test',
  displayName: 'Test Provider',
  apiKey: 'sk-test',
  baseURL: 'https://test.example/v1',
  model: 'test-model',
};

describe('OpenAICompatibleProvider', () => {
  it('returns chat content', async () => {
    const provider = new OpenAICompatibleProvider(config);
    vi.spyOn(provider['client'].chat.completions, 'create').mockResolvedValue({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    } as any);

    const result = await provider.chat({ prompt: 'hi', model: 'test-model' });

    expect(result.content).toBe('hello');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('captures reasoning_content and defaults max_tokens high', async () => {
    const provider = new OpenAICompatibleProvider(config);
    const create = vi.spyOn(provider['client'].chat.completions, 'create').mockResolvedValue({
      choices: [{ message: { content: 'answer', reasoning_content: 'thinking' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as any);

    const result = await provider.chat({ prompt: 'hi', model: 'test-model' });

    expect(result.content).toBe('answer');
    expect(result.reasoning).toBe('thinking');
    expect(create.mock.calls[0][0].max_tokens).toBe(32768);
  });

  it('honors a per-provider maxTokens override', async () => {
    const provider = new OpenAICompatibleProvider({ ...config, maxTokens: 65536 });
    const create = vi.spyOn(provider['client'].chat.completions, 'create').mockResolvedValue({
      choices: [{ message: { content: 'answer' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as any);

    await provider.chat({ prompt: 'hi', model: 'test-model' });

    expect(create.mock.calls[0][0].max_tokens).toBe(65536);
  });

  it('propagates API errors as rejections', async () => {
    const provider = new OpenAICompatibleProvider(config);

    vi.spyOn(provider['client'].chat.completions, 'create').mockRejectedValue(
      new Error('rate limit')
    );

    await expect(provider.chat({ prompt: 'hi', model: 'test-model' })).rejects.toThrow('rate limit');
  });
});

describe('temperature handling', () => {
  const mockCreate = (provider: OpenAICompatibleProvider) =>
    vi.spyOn(provider['client'].chat.completions, 'create').mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    } as any);

  it('omits temperature entirely when nothing is configured', async () => {
    const provider = new OpenAICompatibleProvider(config);
    const create = mockCreate(provider);
    await provider.chat({ prompt: 'hi', model: 'test-model' });
    expect('temperature' in create.mock.calls[0][0]).toBe(false);
  });

  it('sends the provider-config temperature when set', async () => {
    const provider = new OpenAICompatibleProvider({ ...config, temperature: 1 });
    const create = mockCreate(provider);
    await provider.chat({ prompt: 'hi', model: 'test-model' });
    expect(create.mock.calls[0][0].temperature).toBe(1);
  });

  it('call option temperature wins over provider config', async () => {
    const provider = new OpenAICompatibleProvider({ ...config, temperature: 1 });
    const create = mockCreate(provider);
    await provider.chat({ prompt: 'hi', model: 'test-model', temperature: 0.2 });
    expect(create.mock.calls[0][0].temperature).toBe(0.2);
  });
});
