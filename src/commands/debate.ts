import { loadConfig } from '../config.js';
import { runDebate, roundOrder, activeParticipants, CALLER } from '../debate/loop.js';
import { buildDebateOutput, renderDebateTOON, renderDebatePaused } from '../debate/render.js';
import { cleanupExpired, newSessionId, saveSession, loadSession, deleteSession } from '../debate/session.js';
import { formatTranscript } from '../debate/prompts.js';
import { parseVerdict } from '../verdict.js';
import { readStdinPayload } from '../stdin.js';
import { CouncilError } from '../errors.js';
import { buildPrompt, type ArtifactOptions } from './review.js';
import type { DebateSession, DebateTurn } from '../types.js';

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
  if (models.length < 2) {
    throw new CouncilError('A debate needs at least 2 judges; configure more providers or widen --models', 'NO_QUORUM');
  }
  const maxRounds = parseMaxRounds(options.maxRounds);
  const fullPrompt = await buildPrompt(prompt, options);

  const progress = await runDebate(config, {
    prompt: fullPrompt.text,
    models,
    participate: options.participate === true,
    maxRounds,
  });

  if (progress.status === 'awaiting-caller') {
    const session: DebateSession = {
      id: newSessionId(),
      createdAt: new Date().toISOString(),
      prompt: fullPrompt.text,
      models: [...models, CALLER],
      maxRounds,
      turns: progress.turns,
      nextTurn: progress.nextTurn!,
      warnings: fullPrompt.warnings,
    };
    saveSession(session);
    console.log(renderPause(session));
    return;
  }

  const output = buildDebateOutput({
    prompt: fullPrompt.text,
    turns: progress.turns,
    consensus: progress.status === 'consensus',
    maxRounds,
    totalCount: options.participate ? models.length + 1 : models.length,
    warnings: fullPrompt.warnings,
  });
  console.log(renderDebateTOON(output, { full: options.full === true }));
}

function renderPause(session: DebateSession): string {
  const callerTurnIndexes = session.turns
    .map((t, i) => (t.provider === CALLER ? i : -1))
    .filter((i) => i >= 0);
  const lastCallerIdx = callerTurnIndexes.length > 0 ? callerTurnIndexes[callerTurnIndexes.length - 1] : -1;
  const seenTurns = session.turns.slice(0, lastCallerIdx + 1);
  const unseenTurns = session.turns.slice(lastCallerIdx + 1);
  const active = activeParticipants(session.models, session.turns);
  const order = roundOrder(active, session.nextTurn.round);
  return renderDebatePaused({
    sessionId: session.id,
    round: session.nextTurn.round,
    maxRounds: session.maxRounds,
    turnIndex: order.indexOf(CALLER) + 1,
    turnCount: order.length,
    unseenTurns,
    seenRounds: seenTurns.length > 0 ? new Set(seenTurns.map((t) => t.round)).size : 0,
    seenBytes: Buffer.byteLength(formatTranscript(seenTurns), 'utf8'),
  });
}

export async function debateTurnCommand(
  sessionId: string,
  response: string | undefined,
  options: { stdin?: boolean; full?: boolean }
): Promise<void> {
  const text = await readTurnText(response, options.stdin === true);
  const session = loadSession(sessionId);
  if (session.nextTurn.participant !== CALLER) {
    throw new CouncilError(
      `It is not the caller's turn in session ${sessionId}; the state file may be damaged. Run: council-axi debate abort ${sessionId}`,
      'NOT_YOUR_TURN'
    );
  }

  const callerTurn: DebateTurn = {
    round: session.nextTurn.round,
    provider: CALLER,
    model: CALLER,
    status: 'success',
    response: text,
    verdict: parseVerdict(text),
  };
  const turns = [...session.turns, callerTurn];

  const config = loadConfig();
  const judges = session.models.filter((m) => m !== CALLER);
  const next = participantAfterCaller(session, turns);
  const progress = await runDebate(
    config,
    { prompt: session.prompt, models: judges, participate: true, maxRounds: session.maxRounds },
    next ? { turns, nextTurn: next } : { turns, nextTurn: { round: session.maxRounds + 1, participant: CALLER } }
  );

  if (progress.status === 'awaiting-caller') {
    const updated: DebateSession = { ...session, turns: progress.turns, nextTurn: progress.nextTurn! };
    saveSession(updated);
    console.log(renderPause(updated));
    return;
  }

  deleteSession(sessionId);
  const output = buildDebateOutput({
    prompt: session.prompt,
    turns: progress.turns,
    consensus: progress.status === 'consensus',
    maxRounds: session.maxRounds,
    totalCount: session.models.length,
    warnings: session.warnings,
  });
  console.log(renderDebateTOON(output, { full: options.full === true }));
}

// The next speaker after the caller's turn: the participant after CALLER in
// the current round's order, or the opener of the next round when the caller
// closed this one. Returns undefined past maxRounds (engine will cap).
function participantAfterCaller(
  session: DebateSession,
  turns: DebateTurn[]
): { round: number; participant: string } | undefined {
  const active = activeParticipants(session.models, turns);
  const round = session.nextTurn.round;
  const order = roundOrder(active, round);
  const idx = order.indexOf(CALLER);
  if (idx >= 0 && idx < order.length - 1) {
    return { round, participant: order[idx + 1] };
  }
  if (round + 1 > session.maxRounds) return undefined;
  const nextOrder = roundOrder(active, round + 1);
  return { round: round + 1, participant: nextOrder[0] };
}

async function readTurnText(response: string | undefined, stdin: boolean): Promise<string> {
  if (stdin === (response !== undefined)) {
    throw new CouncilError('Provide the turn as an argument or via --stdin, not both/neither', 'BAD_ARG');
  }
  if (!stdin) return response as string;
  if (process.stdin.isTTY) {
    throw new CouncilError('--stdin given but stdin is a terminal; pipe content or omit the flag', 'STDIN_TTY');
  }
  return readStdinPayload();
}

export async function debateAbortCommand(sessionId: string): Promise<void> {
  deleteSession(sessionId);
  console.log(`session ${sessionId}: aborted (no-op if it did not exist)`);
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
  return configured;
}
