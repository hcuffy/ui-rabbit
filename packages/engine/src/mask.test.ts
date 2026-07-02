import { describe, expect, it } from "vitest";
import { maskErrorMessage, maskText } from "./mask.js";

describe("maskText — masking golden fixtures (engine-spec §6, §4 B.1/B.2)", () => {
  it("masks a pure ISO-8601 timestamp to <TIME>", () => {
    expect(maskText("2024-06-21T10:00:00Z")).toBe("<TIME>");
  });

  it("masks English relative time inline, preserving generic text as <TEXT>", () => {
    expect(maskText("Updated 2 hours ago")).toBe("<TIME> <TEXT>");
  });

  it("masks a pure UUID to <ID>", () => {
    expect(maskText("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")).toBe("<ID>");
  });

  it("preserves numbers while masking surrounding localized words (§7.4)", () => {
    expect(maskText("5 vehicles")).toBe("5 <TEXT>");
    expect(maskText("5 Fahrzeuge")).toBe("5 <TEXT>");
  });

  it("normalizes thousands-grouping so en and de formatting compare equal", () => {
    expect(maskText("1,000 vehicles")).toBe("1000 <TEXT>");
    expect(maskText("1.000 Fahrzeuge")).toBe("1000 <TEXT>");
  });

  it("collapses plain localized text (no numbers/ids/timestamps) to <TEXT>", () => {
    expect(maskText("Booking overview")).toBe("<TEXT>");
    expect(maskText("Buchungsübersicht")).toBe("<TEXT>");
  });

  it("known gap (engine-spec §4 B.1 [CONFIRM], deferred): relative time is English-only", () => {
    // "3 hours ago" in German falls through to number+text masking rather than <TIME>.
    // Flagged in the spec as a confirm-later item, not a D2 regression.
    expect(maskText("Vor 3 Stunden aktualisiert")).toBe("3 <TEXT>");
  });
});

describe("maskErrorMessage — dedup-signature masking (engine-spec §5 C.1)", () => {
  it("masks stack line:col and other numbers, unlike maskText", () => {
    const a = maskErrorMessage("TypeError: x is undefined at app.js:42:7");
    const b = maskErrorMessage("TypeError: x is undefined at app.js:108:3");
    expect(a).toBe(b);
    expect(a).toBe("TypeError: x is undefined at app.js:<LINE>:<COL>");
  });
});
