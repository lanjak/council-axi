import { loadConfig } from '../config.js';
import { runCouncil } from '../council.js';
import { synthesize } from '../chairman.js';
import { renderTOON } from '../output.js';
import { CouncilError } from '../errors.js';
import { assembleArtifacts, formatArtifactPreamble } from '../artifacts.js';
import { readStdinPayload } from '../stdin.js';

export interface ArtifactOptions {
  file?: string[];
  diff?: string | boolean;
  stdin?: boolean;
}

export async function reviewCommand(
  prompt: string,
  options: { models?: string } & ArtifactOptions
): Promise<void> {
  const config = loadConfig();
  const models = parseModels(options.models, config.providers);
  const fullPrompt = await buildPrompt(prompt, options);

  const judges = await runCouncil(config, { prompt: fullPrompt.text, mode: 'review', models });
  const availableCount = judges.filter((j) => j.status === 'success').length;

  if (availableCount === 0) {
    throw new CouncilError('All providers unavailable', 'NO_QUORUM');
  }

  const synthesis = synthesize({ prompt: fullPrompt.text, mode: 'review', models }, judges);
  const output = {
    prompt: fullPrompt.text,
    mode: 'review' as const,
    judges,
    synthesis,
    availableCount,
    totalCount: models.length,
    warnings: fullPrompt.warnings,
  };

  console.log(renderTOON(output));
}

export async function buildPrompt(
  prompt: string,
  options: ArtifactOptions
): Promise<{ text: string; warnings: string[] }> {
  if (options.stdin && process.stdin.isTTY) {
    throw new CouncilError(
      '--stdin given but stdin is a terminal; pipe content or omit the flag',
      'STDIN_TTY'
    );
  }

  const bundle = assembleArtifacts({
    files: options.file,
    diff: options.diff === undefined ? undefined : { range: typeof options.diff === 'string' ? options.diff : undefined },
    stdin: options.stdin ? await readStdinPayload() : undefined,
  });

  const text = bundle.blocks.length > 0
    ? formatArtifactPreamble(bundle) + prompt
    : prompt;

  return { text, warnings: bundle.warnings };
}

function parseModels(modelsOption: string | undefined, providers: Record<string, unknown>): string[] {
  if (modelsOption) {
    return modelsOption.split(',').map((m) => m.trim());
  }
  const configured = Object.keys(providers);
  if (configured.length === 0) {
    throw new CouncilError('No providers configured. Set COUNCIL_PROVIDERS or pass --models.', 'NO_PROVIDERS');
  }
  return configured;
}
