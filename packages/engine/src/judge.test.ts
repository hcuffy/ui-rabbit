import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SONNET_MODEL, runJudge, type AnthropicLike, type AnthropicMessageResponse } from "./judge.js";

function toolUseResponse(input: unknown, usage = { input_tokens: 100, output_tokens: 50 }): AnthropicMessageResponse {
  return { content: [{ type: "tool_use", name: "submit_verdict", input }], usage };
}

function fakeClient(responses: AnthropicMessageResponse[]): AnthropicLike {
  const queue = [...responses];
  return {
    messages: {
      create: () => {
        const next = queue.shift();
        if (!next) throw new Error("fakeClient: no more canned responses");
        return Promise.resolve(next);
      },
    },
  };
}

const BASE_INPUT = {
  charter: "test the locations flow",
  screenId: "screen-1",
  baselineAriaSnapshotMasked: '- heading "Locations" [level=1]',
  currentAriaSnapshotMasked: '- heading "Locations" [level=1]\n- text "extra"',
};

describe("runJudge (judge-spec §4/§6/§8) — mocked SDK client, no real API in CI", () => {
  it("a confident REGRESSION verdict from Sonnet is used directly, no escalation", async () => {
    const client = fakeClient([
      toolUseResponse({ verdict: "REGRESSION", severity: "HIGH", reasoning: "unexpected text appeared", confidence: 0.9 }),
    ]);
    const result = await runJudge(BASE_INPUT, { clientFactory: () => client });

    expect(result.verdict).toBe("REGRESSION");
    expect(result.llmCallsUsed).toBe(1);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("low-confidence Sonnet escalates to Opus; a confident Opus verdict is used directly", async () => {
    const client = fakeClient([
      toolUseResponse({ verdict: "INTENDED_CHANGE", severity: "LOW", reasoning: "low conf", confidence: 0.2 }),
      toolUseResponse({ verdict: "INTENDED_CHANGE", severity: "LOW", reasoning: "confident on review", confidence: 0.8 }),
    ]);
    const result = await runJudge(BASE_INPUT, { clientFactory: () => client });

    expect(result.verdict).toBe("INTENDED_CHANGE");
    expect(result.llmCallsUsed).toBe(2);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("low-confidence Sonnet escalates to Opus; still-low Opus confidence -> NEEDS_HUMAN, keeping Opus's real confidence number (not zeroed)", async () => {
    const client = fakeClient([
      toolUseResponse({ verdict: "REGRESSION", severity: "LOW", reasoning: "low conf", confidence: 0.1 }),
      toolUseResponse({ verdict: "REGRESSION", severity: "LOW", reasoning: "still unsure", confidence: 0.35 }),
    ]);
    const result = await runJudge(BASE_INPUT, { clientFactory: () => client });

    expect(result.verdict).toBe("NEEDS_HUMAN");
    expect(result.llmCallsUsed).toBe(2);
    // Audit #10: a real-but-low number from the model is more informative than a
    // hard zero — distinguishes "the model was unsure" from the separate "no
    // parseable verdict at all" / infra-failure paths, which DO zero it (see the
    // two tests immediately below and the infra/auth describe block).
    expect(result.confidence).toBe(0.35);
  });

  it("malformed tool input -> NEEDS_HUMAN, never throws, NOT flagged as an infra failure", async () => {
    const client = fakeClient([toolUseResponse({ verdict: "REGRESSION" })]);
    const result = await runJudge(BASE_INPUT, { clientFactory: () => client });

    expect(result.verdict).toBe("NEEDS_HUMAN");
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain("no parseable verdict");
    expect(result.reasoning).not.toContain("infra/auth error");
  });

  it("refused/empty response -> NEEDS_HUMAN, never throws, NOT flagged as an infra failure", async () => {
    const client = fakeClient([{ content: [], usage: { input_tokens: 50, output_tokens: 0 } }]);
    const result = await runJudge(BASE_INPUT, { clientFactory: () => client });

    expect(result.verdict).toBe("NEEDS_HUMAN");
    expect(result.reasoning).toContain("no parseable verdict");
    expect(result.reasoning).not.toContain("infra/auth error");
  });

  describe("infra/auth failures (judge-spec follow-up) — must never masquerade as model caution", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("a thrown network error -> NEEDS_HUMAN, flagged distinctly, costs nothing, logged loudly", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const client: AnthropicLike = {
        messages: {
          create: () => {
            throw new Error("network down");
          },
        },
      };
      const result = await runJudge(BASE_INPUT, { clientFactory: () => client });

      expect(result.verdict).toBe("NEEDS_HUMAN");
      expect(result.costUsd).toBe(0);
      expect(result.llmCallsUsed).toBe(1);
      expect(result.reasoning).toContain("infra/auth error");
      expect(result.reasoning).toContain("network down");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain("infra/auth error");
    });

    it("a missing/invalid API key error is flagged distinctly, not as model caution", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const client: AnthropicLike = {
        messages: {
          create: () => {
            throw new Error("401 authentication_error: invalid x-api-key");
          },
        },
      };
      const result = await runJudge(BASE_INPUT, { clientFactory: () => client });

      expect(result.verdict).toBe("NEEDS_HUMAN");
      expect(result.reasoning).toContain("infra/auth error");
      expect(result.reasoning).toContain("invalid x-api-key");
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("an infra failure on the Opus escalation call is flagged distinctly too", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      let calls = 0;
      const client: AnthropicLike = {
        messages: {
          create: () => {
            calls += 1;
            if (calls === 1) {
              return Promise.resolve(
                toolUseResponse({ verdict: "REGRESSION", severity: "LOW", reasoning: "low conf", confidence: 0.1 }),
              );
            }
            throw new Error("rate limited");
          },
        },
      };
      const result = await runJudge(BASE_INPUT, { clientFactory: () => client });

      expect(result.verdict).toBe("NEEDS_HUMAN");
      expect(result.llmCallsUsed).toBe(2);
      expect(result.reasoning).toContain("Escalated to Opus");
      expect(result.reasoning).toContain("infra/auth error");
      expect(result.reasoning).toContain("rate limited");
    });
  });

  it("uses the pinned default Sonnet model and only escalates on low confidence", async () => {
    const seenModels: string[] = [];
    const client: AnthropicLike = {
      messages: {
        create: (params) => {
          seenModels.push(params.model);
          return Promise.resolve(toolUseResponse({ verdict: "REGRESSION", severity: "HIGH", reasoning: "x", confidence: 0.9 }));
        },
      },
    };
    await runJudge(BASE_INPUT, { clientFactory: () => client });
    expect(seenModels).toEqual([DEFAULT_SONNET_MODEL]);
  });
});
