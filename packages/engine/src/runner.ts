import { randomUUID } from "node:crypto";
import type { Baseline, Finding } from "@ui-rabbit/shared";
import { computeDedupKey } from "./dedup.js";
import { deriveFingerprint } from "./fingerprint.js";
import { runJudge, type JudgeRunOptions, type JudgeVerdict } from "./judge.js";
import { runOracle } from "./oracle.js";
import { deriveScreenId } from "./screenId.js";
import type { EngineLoopInput, EngineLoopOutput, FindingDraft } from "./types.js";

/** Tracks LLM spend across the whole `runEngineLoop` call (judge-spec §7) —
 * once either cap is hit, remaining divergences skip the judge entirely. */
class BudgetTracker {
  llmCallsUsed = 0;
  costUsd = 0;

  constructor(
    private readonly maxLlmCalls: number,
    private readonly maxUsdPerRun: number,
  ) {}

  exhausted(): boolean {
    return this.llmCallsUsed >= this.maxLlmCalls || this.costUsd >= this.maxUsdPerRun;
  }

  record(llmCallsUsed: number, costUsd: number): void {
    this.llmCallsUsed += llmCallsUsed;
    this.costUsd += costUsd;
  }
}

interface BuildFindingContext {
  charter: string;
  baselineAriaSnapshotMasked: string;
  judge: JudgeRunOptions;
  budget: BudgetTracker;
}

async function judgeDivergence(draft: FindingDraft, ctx: BuildFindingContext): Promise<JudgeVerdict & { llmCallsUsed: number; costUsd: number }> {
  if (ctx.budget.exhausted()) {
    return {
      verdict: "NEEDS_HUMAN",
      severity: "MEDIUM",
      reasoning: "LLM budget cap reached for this run; not judged.",
      confidence: 0,
      llmCallsUsed: 0,
      costUsd: 0,
    };
  }

  const result = await runJudge(
    {
      charter: ctx.charter,
      screenId: draft.screenId,
      baselineAriaSnapshotMasked: ctx.baselineAriaSnapshotMasked,
      currentAriaSnapshotMasked: draft.evidence.ariaSnapshot ?? "",
    },
    ctx.judge,
  );
  ctx.budget.record(result.llmCallsUsed, result.costUsd);
  return result;
}

async function buildFinding(
  draft: FindingDraft,
  dedupKey: string,
  runId: string,
  now: Date,
  ctx: BuildFindingContext,
): Promise<Finding> {
  const isDivergence = draft.type === "STATE_DIVERGENCE";
  const judged = isDivergence ? await judgeDivergence(draft, ctx) : undefined;

  return {
    id: randomUUID(),
    runId,
    screenId: draft.screenId,
    type: draft.type,
    verdict: judged?.verdict,
    severity: judged?.severity,
    reasoning: judged?.reasoning,
    confidence: judged?.confidence,
    evidence: draft.evidence,
    dedupKey,
    status: "NEW",
    createdAt: now,
    updatedAt: now,
  };
}

/** Algorithm C (engine-spec §5): runner loop. No Playwright, no Mongo — but
 * makes real judge calls (D5) for STATE_DIVERGENCE drafts, so this is async.
 * Caller (D4 backend) owns persistence of the returned baselines/findings. */
export async function runEngineLoop(input: EngineLoopInput): Promise<EngineLoopOutput> {
  const now = new Date();
  const baselineByScreen = new Map(input.existingBaselines.map((b) => [b.screenId, b]));
  const findingByDedupKey = new Map(input.existingFindings.map((f) => [f.dedupKey, f]));
  const budget = new BudgetTracker(input.maxLlmCalls ?? Infinity, input.maxUsdPerRun ?? Infinity);

  const newBaselines: Baseline[] = [];
  const findings: Finding[] = [];
  // Accumulated across ALL observations, swept once after the loop — a screen
  // observed twice in one run must not clobber (or duplicate) its own sweep.
  const dedupKeysByScreen = new Map<string, Set<string>>();

  for (const observation of input.observations) {
    const { screenId } = deriveScreenId(observation);
    const { ariaSnapshotMasked, fingerprint } = deriveFingerprint(observation.ariaSnapshot);

    const drafts: FindingDraft[] = runOracle(observation, screenId);

    const existingBaseline = baselineByScreen.get(screenId);
    if (!existingBaseline) {
      const learned: Baseline = { screenId, fingerprint, ariaSnapshotMasked, capturedAt: now, runId: input.runId };
      newBaselines.push(learned);
      // A screen revisited later in this run compares against what it just
      // learned — never learns a second baseline for the same screenId
      // (persistence is keyed by screenId; a duplicate would silently
      // last-write-win and falsely diverge on the next run).
      baselineByScreen.set(screenId, learned);
    } else if (existingBaseline.fingerprint !== fingerprint) {
      drafts.push({
        screenId,
        type: "STATE_DIVERGENCE",
        evidence: { ariaSnapshot: ariaSnapshotMasked },
        maskedSignature: fingerprint,
      });
    }

    const ctx: BuildFindingContext = {
      charter: input.charter,
      baselineAriaSnapshotMasked: existingBaseline?.ariaSnapshotMasked ?? "",
      judge: input.judge,
      budget,
    };

    const thisScreenDedupKeys = dedupKeysByScreen.get(screenId) ?? new Set<string>();
    dedupKeysByScreen.set(screenId, thisScreenDedupKeys);
    for (const draft of drafts) {
      const dedupKey = computeDedupKey(draft);
      thisScreenDedupKeys.add(dedupKey);

      const existing = findingByDedupKey.get(dedupKey);
      if (existing) {
        findings.push({ ...existing, status: "RECURRING", verdict: "KNOWN", runId: input.runId, updatedAt: now });
      } else {
        findings.push(await buildFinding(draft, dedupKey, input.runId, now, ctx));
      }
    }
  }

  // RESOLVED sweep — once per distinct observed screen, against the run-wide
  // dedupKey set for that screen (engine-spec §5 C.3).
  for (const [screenId, seenDedupKeys] of dedupKeysByScreen) {
    const openPrior = input.existingFindings.filter(
      (f) => f.screenId === screenId && (f.status === "NEW" || f.status === "RECURRING"),
    );
    for (const prior of openPrior) {
      if (!seenDedupKeys.has(prior.dedupKey)) {
        findings.push({ ...prior, status: "RESOLVED", runId: input.runId, updatedAt: now });
      }
    }
  }

  return { baselines: newBaselines, findings, llmCallsUsed: budget.llmCallsUsed, costUsd: budget.costUsd };
}
