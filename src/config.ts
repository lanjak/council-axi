import type { ProviderConfig } from './types.js';

export interface CouncilConfig {
  providers: Record<string, ProviderConfig>;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): CouncilConfig {
  const providers: Record<string, ProviderConfig> = {};

  const configured = env.COUNCIL_PROVIDERS?.split(',').map((p) => p.trim()).filter(Boolean) ?? [];

  for (const provider of configured) {
    const prefix = provider.toUpperCase();
    const apiKey = env[`${prefix}_API_KEY`] ?? '';
    const baseURL = env[`${prefix}_BASE_URL`] ?? '';
    const model = env[`${prefix}_MODEL`];
    const displayName = env[`${prefix}_DISPLAY_NAME`] ?? capitalize(provider);
    const maxTokens = parsePositiveInt(env[`${prefix}_MAX_TOKENS`]);
    const temperature = parseTemperature(env[`${prefix}_TEMPERATURE`]);

    providers[provider] = {
      name: provider,
      apiKey,
      baseURL,
      model,
      displayName,
      maxTokens,
      temperature,
    };
  }

  return { providers };
}

function capitalize(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseTemperature(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function listProviders(config: CouncilConfig): string[] {
  return Object.keys(config.providers);
}

export function resolveModel(providerConfig: ProviderConfig): string | undefined {
  return providerConfig.model;
}
