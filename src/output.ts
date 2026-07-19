import type { CouncilOutput, JudgeResult } from './types.js';

export function renderTOON(output: CouncilOutput): string {
  const lines: string[] = [];
  lines.push(`council[${output.mode}]: "${previewPrompt(output.prompt)}"`);
  lines.push(`judges: ${output.availableCount} of ${output.totalCount} responded`);

  lines.push(`judges[${output.judges.length}]{provider,model,status,verdict}:`);
  for (const judge of output.judges) {
    const verdict =
      judge.status === 'success'
        ? firstLine(judge.response ?? '')
        : judge.error?.message ?? 'unavailable';
    lines.push(`  ${judge.provider},${judge.model},${judge.status},${escapeComma(verdict)}`);
  }

  const skipped = output.judges.filter((j) => j.status !== 'success');
  if (skipped.length > 0) {
    lines.push(`skipped[${skipped.length}]:`);
    for (const judge of skipped) {
      lines.push(`  ${judge.provider}: ${judge.error?.message ?? 'unavailable'}`);
    }
  }

  if (output.warnings && output.warnings.length > 0) {
    lines.push(`warnings[${output.warnings.length}]:`);
    for (const w of output.warnings) {
      lines.push(`  ${w}`);
    }
  }

  lines.push('synthesis:');
  for (const line of output.synthesis.split('\n')) {
    lines.push(`  ${line}`);
  }

  const help: string[] = [];
  if (skipped.length > 0) {
    help.push('Run `npx -y council-axi setup` to check provider authentication');
    const responding = output.judges.filter((j) => j.status === 'success').map((j) => j.provider);
    if (responding.length > 0) {
      help.push(`Run \`npx -y council-axi ${output.mode} "<prompt>" --models ${responding.join(',')}\` to use only responding judges`);
    }
  } else {
    const providers = output.judges.map((j) => j.provider).join(',');
    help.push(`Run \`npx -y council-axi ${output.mode} "<prompt>" --models ${providers}\``);
  }
  lines.push(`help[${help.length}]:`);
  for (const h of help) {
    lines.push(`  ${h}`);
  }

  return lines.join('\n');
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function escapeComma(text: string): string {
  return text.replace(/,/g, '\\,');
}

// Echo only a short preview of the prompt. A review often embeds an entire
// artifact (a 71KB plan, say), and dumping it back verbatim on this line made
// the prompt the bulk of the output.
function previewPrompt(text: string): string {
  const PREVIEW_LEN = 200;
  const normalized = text.replace(/\s+/g, ' ').replace(/"/g, '\\"').trim();
  if (normalized.length <= PREVIEW_LEN) return normalized;
  return `${normalized.slice(0, PREVIEW_LEN)}... (${normalized.length} chars total)`;
}
