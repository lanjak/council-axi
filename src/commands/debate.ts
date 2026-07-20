import { loadConfig } from '../config.js';
import { runDebate } from '../debate/loop.js';
import { buildDebateOutput, renderDebateTOON } from '../debate/render.js';
import { cleanupExpired } from '../debate/session.js';
import { CouncilError } from '../errors.js';
import { buildPrompt, type ArtifactOptions } from './review.js';

export interface DebateCommandOptions extends ArtifactOptions {
  models?: string;
  maxRounds?: string;
  full?: boolean;
  participate?: boolean;
}

export async function debateCommand(prompt: string, options: DebateCommandOptions): Promise<void> {
  cleanupExpired();
  const config = loadConfig();
  const models = parseModels(options.models, config.providers);
  const maxRounds = parseMaxRounds(options.maxRounds);
  const fullPrompt = await buildPrompt(prompt, options);

  if (options.participate) {
    throw new CouncilError('--participate not yet available', 'NOT_IMPLEMENTED'); // replaced in Task 8
  }

  const progress = await runDebate(config, {
    prompt: fullPrompt.text,
    models,
    participate: false,
    maxRounds,
  });

  const output = buildDebateOutput({
    prompt: fullPrompt.text,
    turns: progress.turns,
    consensus: progress.status === 'consensus',
    maxRounds,
    totalCount: models.length,
    warnings: fullPrompt.warnings,
  });
  console.log(renderDebateTOON(output, { full: options.full === true }));
}

export function parseMaxRounds(raw: string | undefined): number {
  if (raw === undefined) return 5;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new CouncilError(`--max-rounds must be a positive integer, got "${raw}"`, 'BAD_ARG');
  }
  return n;
}

function parseModels(modelsOption: string | undefined, providers: Record<string, unknown>): string[] {
  if (modelsOption) {
    return modelsOption.split(',').map((m) => m.trim()).filter((m) => m.length > 0);
  }
  const configured = Object.keys(providers);
  if (configured.length === 0) {
    throw new CouncilError('No providers configured. Set COUNCIL_PROVIDERS or pass --models.', 'NO_PROVIDERS');
  }
  if (configured.length < 2) {
    throw new CouncilError('A debate needs at least 2 judges; configure more providers or widen --models', 'NO_QUORUM');
  }
  return configured;
}
