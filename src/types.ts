export interface JudgeResult {
  provider: string;
  model: string;
  status: 'success' | 'error' | 'skipped';
  response?: string;
  reasoning?: string;
  error?: { message: string; code?: string };
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface CouncilRequest {
  prompt: string;
  mode: 'review' | 'plan';
  models: string[];
  systemPrompt?: string;
}

export interface CouncilOutput {
  prompt: string;
  mode: 'review' | 'plan';
  judges: JudgeResult[];
  synthesis: string;
  availableCount: number;
  totalCount: number;
  warnings?: string[];
}

export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseURL: string;
  model?: string;
  displayName: string;
  maxTokens?: number;
  temperature?: number;
}

export type Verdict = 'agree' | 'disagree';

export interface DebateTurn extends JudgeResult {
  round: number;
  verdict?: Verdict; // parsed from trailing tag; absent if the turn errored
}

export interface DebateRound {
  round: number;
  turns: DebateTurn[];
}

export interface DebateOutput {
  prompt: string;
  mode: 'debate';
  rounds: DebateRound[]; // always complete, regardless of --full
  consensus: boolean;
  totalRounds: number; // rounds actually run (a partial final round counts)
  maxRounds: number;
  judges: DebateTurn[]; // final turn per participant that survived round 1
  synthesis: string;
  availableCount: number;
  totalCount: number;
  warnings?: string[];
}

export interface DebateSession {
  id: string;
  createdAt: string; // ISO timestamp, drives 24h expiry
  prompt: string; // artifact-expanded text
  models: string[]; // rotation list order; includes 'caller' last
  maxRounds: number;
  turns: DebateTurn[]; // flat, in speaking order
  nextTurn: { round: number; participant: string; order: string[] }; // order is the frozen speaking order for `round`
  warnings?: string[];
}
