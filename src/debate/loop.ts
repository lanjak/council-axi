import { loadProvider } from '../providers/index.js';
import { CouncilError } from '../errors.js';
import { parseVerdict } from '../verdict.js';
import { formatTranscript, openerPrompt, turnPrompt } from './prompts.js';
import type { CouncilConfig } from '../config.js';
import type { DebateTurn } from '../types.js';

export const CALLER = 'caller';

export interface DebateRunOptions {
  prompt: string;
  models: string[]; // judge provider keys; CALLER is appended by the engine
  participate: boolean;
  maxRounds: number;
}

export interface DebateProgress {
  turns: DebateTurn[];
  status: 'consensus' | 'cap' | 'attrition' | 'awaiting-caller';
  nextTurn?: { round: number; participant: string };
}

export function roundOrder(active: string[], round: number): string[] {
  const start = (round - 1) % active.length;
  return [...active.slice(start), ...active.slice(0, start)];
}

// A participant stays active while its latest recorded turn succeeded.
// The caller is always active once it has spoken (it cannot error).
export function activeParticipants(participants: string[], turns: DebateTurn[]): string[] {
  return participants.filter((p) => {
    if (p === CALLER) return true;
    const latest = [...turns].reverse().find((t) => t.provider === p);
    return latest === undefined || latest.status === 'success';
  });
}

function latestTurn(turns: DebateTurn[], provider: string): DebateTurn | undefined {
  return [...turns].reverse().find((t) => t.provider === provider);
}

function hasConsensus(roster: string[], turns: DebateTurn[]): boolean {
  const active = activeParticipants(roster, turns);
  if (active.length < 2) return false;
  return active.every((p) => latestTurn(turns, p)?.verdict === 'agree');
}

function checkRoundOneQuorum(round: number, roster: string[], turns: DebateTurn[]): void {
  if (round !== 1) return;
  const survivingJudges = activeParticipants(roster, turns).filter((p) => p !== CALLER);
  if (survivingJudges.length < 2) {
    throw new CouncilError('Fewer than 2 judges survived round 1', 'NO_QUORUM');
  }
}

export async function runDebate(
  config: CouncilConfig,
  opts: DebateRunOptions,
  resume?: { turns: DebateTurn[]; nextTurn: { round: number; participant: string } }
): Promise<DebateProgress> {
  const roster = opts.participate ? [...opts.models, CALLER] : [...opts.models];
  const turns: DebateTurn[] = resume ? [...resume.turns] : [];
  let round = resume ? resume.nextTurn.round : 1;

  // Resuming can land exactly on a round boundary: resume.nextTurn.round is
  // one past the last fully-recorded round (e.g. the caller turn that just
  // completed round 1 was appended, and nextTurn now points at round 2's
  // first speaker). In that case the completed prior round's consensus (and
  // cap) must be evaluated before any new turn runs, since no turn in the
  // new round has been asked for yet - the "round has just completed" check
  // that normally runs at the bottom of the loop body never got to run for
  // that prior round in this process.
  if (resume) {
    const priorRound = resume.nextTurn.round - 1;
    const roundIsComplete =
      priorRound >= 1 &&
      !turns.some((t) => t.round === resume.nextTurn.round) &&
      turns.some((t) => t.round === priorRound);
    if (roundIsComplete) {
      checkRoundOneQuorum(priorRound, roster, turns);
      if (hasConsensus(roster, turns)) {
        return { turns, status: 'consensus' };
      }
      const active = activeParticipants(roster, turns);
      if (active.length < 2) return { turns, status: 'attrition' };
      if (priorRound >= opts.maxRounds) return { turns, status: 'cap' };
    }
  }

  while (round <= opts.maxRounds) {
    const active = activeParticipants(roster, turns);
    if (active.length < 2) return { turns, status: 'attrition' };

    const order = roundOrder(active, round);
    const startIdx =
      resume && round === resume.nextTurn.round ? Math.max(order.indexOf(resume.nextTurn.participant), 0) : 0;

    for (let i = startIdx; i < order.length; i++) {
      const participant = order[i];
      // Skip anyone who already has a turn this round (resume replays a partial round).
      if (turns.some((t) => t.round === round && t.provider === participant)) continue;
      if (participant === CALLER) {
        // CALLER is always last in the roster, so every judge has already
        // taken its round-1 turn by the time we reach it here. Enforce
        // quorum now - otherwise, with participate:true, this check would
        // never run at all: the loop returns before ever reaching the
        // post-loop check below.
        checkRoundOneQuorum(round, roster, turns);
        return { turns, status: 'awaiting-caller', nextTurn: { round, participant: CALLER } };
      }
      turns.push(await judgeTurn(config, opts, roster.length, round, participant, turns));
    }

    checkRoundOneQuorum(round, roster, turns);

    const nowActive = activeParticipants(roster, turns);
    if (nowActive.length < 2) return { turns, status: 'attrition' };
    if (hasConsensus(roster, turns)) return { turns, status: 'consensus' };

    round += 1;
  }

  return { turns, status: 'cap' };
}

async function judgeTurn(
  config: CouncilConfig,
  opts: DebateRunOptions,
  judgeCount: number,
  round: number,
  providerKey: string,
  priorTurns: DebateTurn[]
): Promise<DebateTurn> {
  const providerConfig = config.providers[providerKey];

  if (!providerConfig) {
    return {
      round,
      provider: providerKey,
      model: 'unknown',
      status: 'skipped',
      error: { message: `No configuration for provider "${providerKey}"` },
    };
  }

  if (!providerConfig.model) {
    return {
      round,
      provider: providerKey,
      model: 'unknown',
      status: 'skipped',
      error: { message: `No model configured for provider "${providerKey}"` },
    };
  }

  if (!providerConfig.apiKey) {
    return {
      round,
      provider: providerKey,
      model: providerConfig.model,
      status: 'skipped',
      error: { message: `API key not set for ${providerKey}` },
    };
  }

  // The debate instructions (and, from round 2 on, the transcript) change on
  // every call, so they are the "prompt" (user message) the model responds
  // to. The original request stays constant across the whole debate, so it
  // travels as the "system" framing.
  const instructions =
    priorTurns.length === 0
      ? openerPrompt(judgeCount)
      : turnPrompt({
          judgeName: providerKey,
          judgeCount,
          round,
          maxRounds: opts.maxRounds,
          transcript: formatTranscript(priorTurns),
        });

  try {
    const result = await loadProvider(providerKey, providerConfig).chat({
      prompt: instructions,
      system: opts.prompt,
      model: providerConfig.model,
    });
    return {
      round,
      provider: providerKey,
      model: providerConfig.model,
      status: 'success',
      response: result.content,
      reasoning: result.reasoning,
      usage: result.usage,
      verdict: parseVerdict(result.content),
    };
  } catch (err) {
    return {
      round,
      provider: providerKey,
      model: providerConfig.model,
      status: 'error',
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}
