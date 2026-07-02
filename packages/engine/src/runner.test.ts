import type { Baseline, Finding } from "@ui-rabbit/shared";
import { describe, expect, it } from "vitest";
import type { AnthropicLike, AnthropicMessageResponse } from "./judge.js";
import { runEngineLoop } from "./runner.js";
import type { CapturedObservation, EngineLoopInput } from "./types.js";

const URL = "https://dev.rabbit.example/fleet/auth/platform/locations";

function observation(overrides: Partial<CapturedObservation> = {}): CapturedObservation {
  return { url: URL, ariaSnapshot: '- heading "Locations" [level=1]', ...overrides };
}

/** Asserts the judge is never called — used by tests where no STATE_DIVERGENCE
 * draft should ever reach the judge. */
function throwingJudgeClient(): AnthropicLike {
  return {
    messages: {
      create: () => {
        throw new Error("judge should not be called in this test");
      },
    },
  };
}

function verdictClient(verdict: { verdict: string; severity: string; reasoning: string; confidence: number }): AnthropicLike {
  const response: AnthropicMessageResponse = {
    content: [{ type: "tool_use", name: "submit_verdict", input: verdict }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  return { messages: { create: () => Promise.resolve(response) } };
}

function loopInput(overrides: Partial<EngineLoopInput> = {}): EngineLoopInput {
  return {
    runId: "run-1",
    charter: "test the locations flow",
    observations: [],
    existingBaselines: [],
    existingFindings: [],
    judge: { clientFactory: () => throwingJudgeClient() },
    ...overrides,
  };
}

describe("runEngineLoop — run-1-learns / run-2-flags (engine-spec §5 C.3, §8 done criteria)", () => {
  it("run 1: no baseline yet -> writes a baseline, records oracle findings, no divergence", async () => {
    const output = await runEngineLoop(
      loopInput({ observations: [observation({ consoleErrors: ["TypeError: x is undefined at app.js:1:1"] })] }),
    );

    expect(output.baselines).toHaveLength(1);
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]?.type).toBe("CONSOLE_ERROR");
    expect(output.findings[0]?.status).toBe("NEW");
    expect(output.llmCallsUsed).toBe(0);
    expect(output.costUsd).toBe(0);
  });

  it("run 2: matching baseline -> free suppression, no divergence finding", async () => {
    const run1 = await runEngineLoop(loopInput({ runId: "run-1", observations: [observation()] }));

    const run2 = await runEngineLoop(
      loopInput({
        runId: "run-2",
        observations: [observation()],
        existingBaselines: run1.baselines,
        existingFindings: run1.findings,
      }),
    );

    expect(run2.baselines).toHaveLength(0);
    expect(run2.findings.filter((f) => f.type === "STATE_DIVERGENCE")).toHaveLength(0);
    expect(run2.llmCallsUsed).toBe(0);
  });

  it("run 2: mismatched fingerprint -> divergence finding via the real judge call (mocked client)", async () => {
    const run1 = await runEngineLoop(loopInput({ runId: "run-1", observations: [observation()] }));

    const run2 = await runEngineLoop(
      loopInput({
        runId: "run-2",
        observations: [observation({ ariaSnapshot: '- heading "Vehicles" [level=1]\n- text "extra"' })],
        existingBaselines: run1.baselines,
        existingFindings: run1.findings,
        judge: {
          clientFactory: () =>
            verdictClient({ verdict: "REGRESSION", severity: "HIGH", reasoning: "heading changed unexpectedly", confidence: 0.9 }),
        },
      }),
    );

    const divergence = run2.findings.find((f) => f.type === "STATE_DIVERGENCE");
    expect(divergence).toBeDefined();
    expect(divergence?.status).toBe("NEW");
    expect(divergence?.verdict).toBe("REGRESSION");
    expect(run2.llmCallsUsed).toBe(1);
    expect(run2.costUsd).toBeGreaterThan(0);
  });

  it("run 2: same issue recurring -> RECURRING status, verdict KNOWN (suppressed from the new surface)", async () => {
    const errorMessage = "TypeError: x is undefined at app.js:1:1";
    const run1 = await runEngineLoop(
      loopInput({ runId: "run-1", observations: [observation({ consoleErrors: [errorMessage] })] }),
    );

    const run2 = await runEngineLoop(
      loopInput({
        runId: "run-2",
        observations: [observation({ consoleErrors: [errorMessage] })],
        existingBaselines: run1.baselines,
        existingFindings: run1.findings,
      }),
    );

    const consoleFinding = run2.findings.find((f) => f.type === "CONSOLE_ERROR");
    expect(consoleFinding?.status).toBe("RECURRING");
    expect(consoleFinding?.verdict).toBe("KNOWN");
  });

  it("run 2: a previously-open finding no longer present -> RESOLVED", async () => {
    const run1 = await runEngineLoop(
      loopInput({
        runId: "run-1",
        observations: [observation({ consoleErrors: ["TypeError: x is undefined at app.js:1:1"] })],
      }),
    );

    const run2 = await runEngineLoop(
      loopInput({
        runId: "run-2",
        observations: [observation()],
        existingBaselines: run1.baselines,
        existingFindings: run1.findings,
      }),
    );

    const resolved = run2.findings.find((f) => f.type === "CONSOLE_ERROR");
    expect(resolved?.status).toBe("RESOLVED");
  });

  it("run 2: per-run LLM cap stops calling the judge; remaining divergences become NEEDS_HUMAN (judge-spec §7/§8)", async () => {
    const urlA = "https://dev.rabbit.example/fleet/auth/platform/locations";
    const urlB = "https://dev.rabbit.example/fleet/auth/platform/vehicles";

    const run1 = await runEngineLoop(
      loopInput({
        runId: "run-1",
        observations: [
          observation({ url: urlA, ariaSnapshot: '- heading "Locations" [level=1]' }),
          observation({ url: urlB, ariaSnapshot: '- heading "Vehicles" [level=1]' }),
        ],
      }),
    );

    const run2 = await runEngineLoop(
      loopInput({
        runId: "run-2",
        maxLlmCalls: 1,
        judge: {
          clientFactory: () => verdictClient({ verdict: "REGRESSION", severity: "HIGH", reasoning: "changed", confidence: 0.9 }),
        },
        observations: [
          observation({ url: urlA, ariaSnapshot: '- heading "Locations" [level=1]\n- text "changed-a"' }),
          observation({ url: urlB, ariaSnapshot: '- heading "Vehicles" [level=1]\n- text "changed-b"' }),
        ],
        existingBaselines: run1.baselines,
        existingFindings: run1.findings,
      }),
    );

    const divergences = run2.findings.filter((f) => f.type === "STATE_DIVERGENCE");
    expect(divergences).toHaveLength(2);
    expect(divergences.filter((f) => f.verdict === "REGRESSION")).toHaveLength(1);
    expect(divergences.filter((f) => f.verdict === "NEEDS_HUMAN")).toHaveLength(1);
    expect(run2.llmCallsUsed).toBe(1);
  });
});

describe("runEngineLoop — hash-route identity + in-run baseline map (audit fix 3)", () => {
  const HASH_A = "https://dev.rabbit.example/#/locations";
  const HASH_B = "https://dev.rabbit.example/#/settings";

  it("two distinct hash routes learn two independent baselines; unchanged re-run diverges on neither", async () => {
    const run1 = await runEngineLoop(
      loopInput({
        runId: "run-1",
        observations: [
          observation({ url: HASH_A, ariaSnapshot: '- heading "Locations" [level=1]' }),
          observation({ url: HASH_B, ariaSnapshot: '- heading "Settings" [level=1]' }),
        ],
      }),
    );
    expect(run1.baselines).toHaveLength(2);

    const run2 = await runEngineLoop(
      loopInput({
        runId: "run-2",
        observations: [
          observation({ url: HASH_A, ariaSnapshot: '- heading "Locations" [level=1]' }),
          observation({ url: HASH_B, ariaSnapshot: '- heading "Settings" [level=1]' }),
        ],
        existingBaselines: run1.baselines,
        existingFindings: run1.findings,
      }),
    );
    expect(run2.baselines).toHaveLength(0);
    expect(run2.findings.filter((f) => f.type === "STATE_DIVERGENCE")).toHaveLength(0);
  });

  it("a screen observed twice in one run learns exactly one baseline and never self-diverges", async () => {
    const output = await runEngineLoop(
      loopInput({
        observations: [observation(), observation()],
      }),
    );
    expect(output.baselines).toHaveLength(1);
    expect(output.findings.filter((f) => f.type === "STATE_DIVERGENCE")).toHaveLength(0);
    expect(output.llmCallsUsed).toBe(0);
  });

  it("no dedup bleed across hash screens: the same console error on #/a and #/b is two NEW findings", async () => {
    const errorMessage = "TypeError: x is undefined at app.js:1:1";
    const output = await runEngineLoop(
      loopInput({
        observations: [
          observation({ url: HASH_A, consoleErrors: [errorMessage] }),
          observation({ url: HASH_B, consoleErrors: [errorMessage] }),
        ],
      }),
    );
    const consoleFindings = output.findings.filter((f) => f.type === "CONSOLE_ERROR");
    expect(consoleFindings).toHaveLength(2);
    expect(consoleFindings.every((f) => f.status === "NEW")).toBe(true);
    expect(new Set(consoleFindings.map((f) => f.dedupKey)).size).toBe(2);
  });

  it("no resolve bleed: an open finding on #/a stays untouched by a run observing only #/b", async () => {
    const run1 = await runEngineLoop(
      loopInput({
        runId: "run-1",
        observations: [observation({ url: HASH_A, consoleErrors: ["TypeError: x is undefined at app.js:1:1"] })],
      }),
    );

    const run2 = await runEngineLoop(
      loopInput({
        runId: "run-2",
        observations: [observation({ url: HASH_B, ariaSnapshot: '- heading "Settings" [level=1]' })],
        existingBaselines: run1.baselines,
        existingFindings: run1.findings,
      }),
    );
    // #/a wasn't observed — its open finding must not be swept RESOLVED.
    expect(run2.findings.filter((f) => f.status === "RESOLVED")).toHaveLength(0);
  });

  it("a screen observed twice emits no duplicate RESOLVED entries for a prior finding", async () => {
    const run1 = await runEngineLoop(
      loopInput({
        runId: "run-1",
        observations: [observation({ consoleErrors: ["TypeError: x is undefined at app.js:1:1"] })],
      }),
    );

    const run2 = await runEngineLoop(
      loopInput({
        runId: "run-2",
        observations: [observation(), observation()],
        existingBaselines: run1.baselines,
        existingFindings: run1.findings,
      }),
    );
    const resolved = run2.findings.filter((f) => f.status === "RESOLVED");
    expect(resolved).toHaveLength(1); // once, not once per observation
  });
});

describe("runEngineLoop — type wiring sanity", () => {
  it("accepts plain Baseline/Finding arrays from the shared schema (no engine-only shapes leak)", async () => {
    const baselines: Baseline[] = [];
    const findings: Finding[] = [];
    const output = await runEngineLoop(loopInput({ existingBaselines: baselines, existingFindings: findings }));
    expect(output.baselines).toEqual([]);
    expect(output.findings).toEqual([]);
  });
});
