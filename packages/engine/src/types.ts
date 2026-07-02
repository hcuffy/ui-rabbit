import type { Baseline, Finding } from "@ui-rabbit/shared";
import type { JudgeRunOptions } from "./judge.js";

/** Engine-internal driver->engine contract. Not in `shared` — shared is scoped to the
 * 4 named schemas (Finding/Run/AppMap/Baseline) per CLAUDE.md. Detection of *which*
 * console messages are errors / which responses are 4xx-5xx / blank-page heuristics
 * is the driver's job (D3); the engine only classifies already-filtered signals. */
export interface HttpErrorSignal {
  method: string;
  url: string;
  status: number;
}

export interface CapturedObservation {
  url: string;
  ariaSnapshot: string;
  documentTitle?: string;
  consoleErrors?: string[];
  httpErrors?: HttpErrorSignal[];
  isBlank?: boolean;
}

/** Pre-Finding candidate: enough to compute a dedupKey and, for divergences, to ask
 * the judge. Assembled into a full `Finding` only after dedup/status is resolved. */
export interface FindingDraft {
  screenId: string;
  type: Finding["type"];
  evidence: Finding["evidence"];
  maskedSignature: string;
}

export interface EngineLoopInput {
  runId: string;
  /** What this run was testing — passed to the judge as context (judge-spec §5). */
  charter: string;
  observations: CapturedObservation[];
  existingBaselines: Baseline[];
  existingFindings: Finding[];
  judge: JudgeRunOptions;
  /** Per-run LLM budget caps (judge-spec §7) — undefined means unlimited.
   * Once exceeded, remaining divergences in this run skip the judge call and
   * become `NEEDS_HUMAN` rather than stopping the run. */
  maxLlmCalls?: number;
  maxUsdPerRun?: number;
}

export interface EngineLoopOutput {
  baselines: Baseline[];
  findings: Finding[];
  llmCallsUsed: number;
  costUsd: number;
}
