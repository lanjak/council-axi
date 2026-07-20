import { describe, it, expect } from 'vitest';
import { loadConfig, listProviders } from '../src/config.js';

describe('config', () => {
  it('loads configured providers from COUNCIL_PROVIDERS', () => {
    const config = loadConfig({
      COUNCIL_PROVIDERS: 'openai,groq',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
      GROQ_API_KEY: 'groq-key',
      GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
      GROQ_MODEL: 'llama-3.1-70b',
    });

    expect(listProviders(config)).toEqual(['openai', 'groq']);
    expect(config.providers.openai.apiKey).toBe('openai-key');
    expect(config.providers.openai.baseURL).toBe('https://api.openai.com/v1');
    expect(config.providers.openai.model).toBe('gpt-4o');
    expect(config.providers.groq.model).toBe('llama-3.1-70b');
  });

  it('defaults to empty when COUNCIL_PROVIDERS is unset', () => {
    const config = loadConfig({});
    expect(listProviders(config)).toEqual([]);
  });

  it('uses display name override', () => {
    const config = loadConfig({
      COUNCIL_PROVIDERS: 'custom',
      CUSTOM_API_KEY: 'key',
      CUSTOM_BASE_URL: 'https://custom.example/v1',
      CUSTOM_MODEL: 'model',
      CUSTOM_DISPLAY_NAME: 'My Custom Provider',
    });

    expect(config.providers.custom.displayName).toBe('My Custom Provider');
  });

  it('reads a positive MAX_TOKENS override and ignores invalid values', () => {
    const config = loadConfig({
      COUNCIL_PROVIDERS: 'mimo,deepseek,bad',
      MIMO_API_KEY: 'k',
      MIMO_BASE_URL: 'https://api.xiaomimimo.com/v1',
      MIMO_MODEL: 'mimo-v2.5-pro',
      MIMO_MAX_TOKENS: '65536',
      DEEPSEEK_API_KEY: 'k',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      BAD_API_KEY: 'k',
      BAD_BASE_URL: 'https://bad.example/v1',
      BAD_MODEL: 'bad',
      BAD_MAX_TOKENS: 'not-a-number',
    });

    expect(config.providers.mimo.maxTokens).toBe(65536);
    expect(config.providers.deepseek.maxTokens).toBeUndefined();
    expect(config.providers.bad.maxTokens).toBeUndefined();
  });

  it('capitalizes provider key for display name when not overridden', () => {
    const config = loadConfig({
      COUNCIL_PROVIDERS: 'my_provider',
      MY_PROVIDER_API_KEY: 'key',
      MY_PROVIDER_BASE_URL: 'https://example.com/v1',
      MY_PROVIDER_MODEL: 'model',
    });

    expect(config.providers.my_provider.displayName).toBe('My_provider');
  });
});

describe('temperature env override', () => {
  it('parses <PREFIX>_TEMPERATURE and ignores invalid values', () => {
    const config = loadConfig({
      COUNCIL_PROVIDERS: 'kimi,mimo,bad',
      KIMI_API_KEY: 'k', KIMI_BASE_URL: 'https://x/v1', KIMI_MODEL: 'k3', KIMI_TEMPERATURE: '1',
      MIMO_API_KEY: 'k', MIMO_BASE_URL: 'https://x/v1', MIMO_MODEL: 'm',
      BAD_API_KEY: 'k', BAD_BASE_URL: 'https://x/v1', BAD_MODEL: 'b', BAD_TEMPERATURE: 'warm',
    });
    expect(config.providers.kimi.temperature).toBe(1);
    expect(config.providers.mimo.temperature).toBeUndefined();
    expect(config.providers.bad.temperature).toBeUndefined();
  });
});
