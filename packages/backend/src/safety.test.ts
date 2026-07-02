import { describe, expect, it } from "vitest";
import {
  assertAllowedUrl,
  assertNotDestructive,
  assertNotProdUrl,
  DEFAULT_DESTRUCTIVE_PATTERNS,
  parseAllowedDomains,
  parseProdUrlPatterns,
  SafetyViolation,
} from "./safety.js";

describe("assertAllowedUrl (safety-spec §3)", () => {
  it("passes for a host on the allowlist", () => {
    expect(() => assertAllowedUrl("https://dev.rabbit.example/path", ["dev.rabbit.example"])).not.toThrow();
  });

  it("throws SafetyViolation for a host not on the allowlist", () => {
    expect(() => assertAllowedUrl("https://other.example", ["dev.rabbit.example"])).toThrow(SafetyViolation);
  });

  it("never substring-matches — a lookalike host must not pass", () => {
    expect(() => assertAllowedUrl("https://evil-rabbit.com", ["rabbit.com"])).toThrow(SafetyViolation);
    expect(() => assertAllowedUrl("https://rabbit.com.evil.com", ["rabbit.com"])).toThrow(SafetyViolation);
  });

  it("is case-insensitive on the host", () => {
    expect(() => assertAllowedUrl("https://DEV.rabbit.Example", ["dev.rabbit.example"])).not.toThrow();
  });

  it("matches host+port, not just hostname", () => {
    expect(() => assertAllowedUrl("http://localhost:5055", ["localhost:5055"])).not.toThrow();
    expect(() => assertAllowedUrl("http://localhost:9999", ["localhost:5055"])).toThrow(SafetyViolation);
  });

  it("an empty allowlist refuses everything (fail-closed)", () => {
    expect(() => assertAllowedUrl("https://dev.rabbit.example", [])).toThrow(SafetyViolation);
  });

  it("the thrown violation carries the ALLOWLIST guard name", () => {
    try {
      assertAllowedUrl("https://other.example", ["dev.rabbit.example"]);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SafetyViolation);
      expect((error as SafetyViolation).guard).toBe("ALLOWLIST");
    }
  });
});

describe("assertNotProdUrl (safety-spec §4)", () => {
  const prodPatterns = [/^app\.rabbit\.com$/i, /^rabbit\.com$/i];

  it("passes for a dev/staging host", () => {
    expect(() => assertNotProdUrl("https://dev.rabbit.example", prodPatterns)).not.toThrow();
  });

  it("throws for a host matching a prod pattern, even if it would be allowlisted", () => {
    expect(() => assertNotProdUrl("https://app.rabbit.com", prodPatterns)).toThrow(SafetyViolation);
  });

  it("an empty pattern list refuses nothing (allowlist stays authoritative)", () => {
    expect(() => assertNotProdUrl("https://app.rabbit.com", [])).not.toThrow();
  });
});

describe("assertNotDestructive (safety-spec §5)", () => {
  it("throws for Delete/Pay/Confirm-style accessible names on actionable roles", () => {
    expect(() => assertNotDestructive({ role: "button", accessibleName: "Delete" })).toThrow(SafetyViolation);
    expect(() => assertNotDestructive({ role: "link", accessibleName: "Pay now" })).toThrow(SafetyViolation);
    expect(() => assertNotDestructive({ role: "button", accessibleName: "Confirm" })).toThrow(SafetyViolation);
    expect(() => assertNotDestructive({ role: "button", accessibleName: "Place order" })).toThrow(SafetyViolation);
  });

  it("matches on word boundary, not substring", () => {
    // "Paying" contains "pay" but isn't the word "pay".
    expect(() => assertNotDestructive({ role: "button", accessibleName: "Paying customers" })).not.toThrow();
    // "Removable" contains "remove" but isn't the word "remove".
    expect(() => assertNotDestructive({ role: "button", accessibleName: "Removable storage" })).not.toThrow();
  });

  it("benign labels pass", () => {
    expect(() => assertNotDestructive({ role: "link", accessibleName: "Main Warehouse" })).not.toThrow();
    expect(() => assertNotDestructive({ role: "button", accessibleName: "View details" })).not.toThrow();
  });

  it("only guards actionable roles (button/link) — a heading is never a mutating action", () => {
    expect(() => assertNotDestructive({ role: "heading", accessibleName: "Delete confirmation" })).not.toThrow();
  });

  it("accepts a custom pattern list, defaulting to DEFAULT_DESTRUCTIVE_PATTERNS", () => {
    expect(() => assertNotDestructive({ role: "button", accessibleName: "Launch" }, ["launch"])).toThrow(
      SafetyViolation,
    );
    expect(DEFAULT_DESTRUCTIVE_PATTERNS).toContain("delete");
  });
});

describe("parseAllowedDomains / parseProdUrlPatterns (env parsing)", () => {
  it("parses a comma-separated, trimmed, lowercased host list", () => {
    expect(parseAllowedDomains(" Dev.Example.com , localhost:5055 ")).toEqual(["dev.example.com", "localhost:5055"]);
  });

  it("an unset env value parses to an empty list", () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
  });

  it("parses a comma-separated regex list", () => {
    const patterns = parseProdUrlPatterns("^app\\.example\\.com$,^example\\.com$");
    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.test("app.example.com")).toBe(true);
  });
});
