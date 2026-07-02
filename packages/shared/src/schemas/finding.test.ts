import { describe, expect, it } from "vitest";
import { FindingSchema } from "./finding.js";

describe("FindingSchema", () => {
  it("parses a valid finding", () => {
    const result = FindingSchema.parse({
      id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      runId: "run-1",
      screenId: "screen-1",
      type: "CONSOLE_ERROR",
      evidence: { consoleMessages: ["TypeError: x is undefined"] },
      dedupKey: "dedup-1",
      status: "NEW",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.type).toBe("CONSOLE_ERROR");
  });

  it("rejects an invalid finding", () => {
    expect(() =>
      FindingSchema.parse({
        id: "not-a-uuid",
        runId: "run-1",
        screenId: "screen-1",
        type: "NOT_A_TYPE",
        evidence: {},
        dedupKey: "dedup-1",
        status: "NEW",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow();
  });
});
