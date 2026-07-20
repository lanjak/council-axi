import OpenAI from 'openai';
import { LLMProvider, ChatOptions, ChatResult, AuthResult, ProviderCapabilities } from './base.js';
import type { ProviderConfig } from '../types.js';

// Reasoning models spend a large share of their completion budget on hidden
// thinking tokens, so a low cap truncates the visible answer mid-sentence.
// mimo-v2.5-pro and deepseek-v4-pro both support 65536; default generously and
// let ${PREFIX}_MAX_TOKENS override per provider.
const DEFAULT_MAX_TOKENS = 32768;

export class OpenAICompatibleProvider extends LLMProvider {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  protected client: OpenAI;

  constructor(config: ProviderConfig) {
    super(config);
    this.name = config.name ?? 'unknown';
    this.displayName = config.displayName ?? config.name ?? 'Unknown Provider';
    this.capabilities = { supportsReasoning: false, supportsJsonMode: true };
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  async checkAuth(): Promise<AuthResult> {
    if (!this.config.baseURL) {
      return {
        available: true,
        authenticated: false,
        detail: `${this.displayName} base URL is not set`,
      };
    }
    if (!this.config.apiKey) {
      return {
        available: true,
        authenticated: false,
        detail: `${this.displayName} API key is not set`,
      };
    }
    return { available: true, authenticated: true, detail: `${this.displayName} API key is set` };
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: options.prompt });

    // Temperature is opt-in (call option or <PREFIX>_TEMPERATURE env): some
    // endpoints reject any value but their own default (kimi k3 only accepts
    // 1), so when nothing is configured the field is omitted entirely.
    const temperature = options.temperature ?? this.config.temperature;
    const completion = await this.client.chat.completions.create({
      model: options.model,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      response_format: options.jsonMode ? { type: 'json_object' } : undefined,
    });

    const choice = completion.choices[0];
    const content = choice?.message?.content ?? '';
    // Reasoning models (mimo-v2.5-pro, deepseek-v4-pro) return their chain of
    // thought in a non-standard `reasoning_content` field the SDK doesn't type.
    const reasoning =
      (choice?.message as { reasoning_content?: string } | undefined)?.reasoning_content ?? undefined;
    const usage = completion.usage
      ? {
          inputTokens: completion.usage.prompt_tokens,
          outputTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined;

    return { content, reasoning, usage };
  }
}
