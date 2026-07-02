import { describe, expect, it } from "vitest";
import { BaselineSchema } from "./baseline.js";

describe("BaselineSchema", () => {
  it("parses a valid baseline", () => {
    const result = BaselineSchema.parse({
      screenId: "screen-1",
      fingerprint: "sha256:abc123",
      ariaSnapshotMasked: "heading: Bookings",
      capturedAt: new Date(),
      runId: "run-1",
    });
    expect(result.screenId).toBe("screen-1");
  });

  it("rejects a baseline missing required fields", () => {
    expect(() =>
      BaselineSchema.parse({
        screenId: "screen-1",
        capturedAt: new Date(),
        runId: "run-1",
      }),
    ).toThrow();
  });
});
