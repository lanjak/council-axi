import { loadConfig, listProviders } from '../config.js';
import { readStdinPayload } from '../stdin.js';
import { parseHookPayload } from '../hooks/payload.js';
import { resolveSessionKey, recordEdit, pendingEdits, clearSession } from '../hooks/state.js';
import { synthesize } from '../chairman.js';
import { runCouncil } from '../council.js';
import { assembleArtifacts, formatArtifactPreamble } from '../artifacts.js';
import { decideGate } from '../hooks/gate.js';
import { parseCapBytesOverride } from './review.js';

const GATE_SYSTEM_PROMPT = `You are one judge on a review council gating completion of a coding task. Review the diff of uncommitted changes. Be adversarial: look for bugs, security issues, broken contracts, missing tests. End your response with a final line of exactly one of:
VERDICT: pass
VERDICT: concerns
VERDICT: fail
Use fail only for issues that must be fixed before this work is acceptable.`;

const EVENTS = ['session-start', 'post-edit', 'stop'] as const;
type HookEvent = (typeof EVENTS)[number];

export async function hookCommand(
  event: string | undefined,
  options: { payload?: string }
): Promise<void> {
  if (!event || !EVENTS.includes(event as HookEvent)) {
    console.error(
      `council-axi hook: unknown event "${event ?? '(none)'}"\navailable events: ${EVENTS.join(', ')}`
    );
    process.exitCode = 1;
    return;
  }

  const rawPayload = options.payload ?? (await readStdinPayload());

  switch (event as HookEvent) {
    case 'session-start':
      return sessionStart(rawPayload);
    case 'post-edit':
      return postEdit(rawPayload);
    case 'stop':
      return stop(rawPayload);
  }
}

async function sessionStart(_rawPayload: string): Promise<void> {
  try {
    const config = loadConfig();
    const providers = listProviders(config);
    if (providers.length === 0) {
      return; // nothing configured: stay silent, exit 0
    }
    console.log(`council[available]: providers ${providers.join(',')} | review gate active`);
    console.log('help: run `council-axi review "<question>" --diff` for a council review');
  } catch {
    // A context hook must never break session startup.
  }
}

async function postEdit(rawPayload: string): Promise<void> {
  try {
    const payload = parseHookPayload(rawPayload);
    const cwd = payload.cwd ?? process.cwd();
    const key = resolveSessionKey(payload);
    for (const file of payload.files ?? []) {
      recordEdit(key, file, cwd);
    }
  } catch (err) {
    console.error(`council-axi hook post-edit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function safelyClearSession(key: string): void {
  try {
    clearSession(key);
  } catch {
    // Best-effort cleanup only. The block/pass decision (exit code, stdout
    // synthesis, stderr summary) is already final at this point - a failed
    // cleanup must never reclassify it as fail-open.
  }
}

async function stop(rawPayload: string): Promise<void> {
  const payload = parseHookPayload(rawPayload);
  const key = resolveSessionKey(payload, () => {}); // stop stays quiet; post-edit already warned

  let edits: string[];
  try {
    edits = pendingEdits(key);
  } catch {
    process.exitCode = 0;
    return;
  }
  if (edits.length === 0) {
    process.exitCode = 0;
    return; // zero-cost pass-through
  }

  try {
    const config = loadConfig();
    const models = listProviders(config);
    if (models.length === 0) {
      console.log('council[gate_error]: no providers configured - gate inert');
      process.exitCode = 0;
      return;
    }

    const bundle = assembleArtifacts({
      diff: { paths: edits },
      cwd: payload.cwd ?? process.cwd(),
      capBytes: parseCapBytesOverride(),
    });

    if (bundle.blocks.length === 0) {
      // Edits were pending but produced no diff content (e.g. already
      // committed) - there is nothing to review, so treat this the same as
      // the no-pending-edits case, but the pending edits WERE reviewed (as
      // "nothing to flag"), so clear the state instead of leaving it stale.
      process.exitCode = 0;
      safelyClearSession(key);
      return;
    }

    const warningsSuffix = bundle.warnings.length > 0 ? ` (warnings: ${bundle.warnings.length})` : '';

    const prompt =
      formatArtifactPreamble(bundle) +
      `Review the above uncommitted changes to these files: ${edits.join(', ')}`;

    const judges = await runCouncil(config, {
      prompt,
      mode: 'review',
      models,
      systemPrompt: GATE_SYSTEM_PROMPT,
    });

    const decision = decideGate(judges);

    if (decision.outcome === 'fail-open') {
      console.log(
        `council[gate_error]: ${decision.reason} - gate failed open, edits kept for re-review${warningsSuffix}`
      );
      process.exitCode = 0;
      return; // state NOT cleared
    }

    const synthesis = synthesize(
      { prompt, mode: 'review', models, systemPrompt: GATE_SYSTEM_PROMPT },
      judges
    );

    if (decision.outcome === 'block') {
      console.log(synthesis);
      console.error(`council-axi gate: blocked - ${decision.reason}${warningsSuffix}`);
      process.exitCode = 2;
      safelyClearSession(key);
      return;
    }

    console.log(`council[gate]: pass - ${decision.reason}${warningsSuffix}`);
    process.exitCode = 0;
    safelyClearSession(key);
  } catch (err) {
    console.log(
      `council[gate_error]: ${err instanceof Error ? err.message : String(err)} - gate failed open, edits kept for re-review`
    );
    process.exitCode = 0; // fail open, state kept
  }
}
