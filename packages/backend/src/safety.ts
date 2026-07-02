/** safety-spec §8 — pure guard functions, no IO. Consumed by the orchestrator
 * (pre-run allowlist/prod checks) and threaded into the driver as injected hooks
 * (per-navigation/per-action). The driver never imports this module — it only
 * calls whatever closure the orchestrator hands it, so the rules live in exactly
 * one place. Safety violations are decided: hard-fail (safety-spec §2). */

export type SafetyGuardName = "ALLOWLIST" | "PROD_URL" | "DESTRUCTIVE_ACTION";

export class SafetyViolation extends Error {
  readonly guard: SafetyGuardName;

  constructor(guard: SafetyGuardName, message: string) {
    super(message);
    this.name = "SafetyViolation";
    this.guard = guard;
  }
}

export interface ActionDescriptor {
  role: string;
  accessibleName: string;
}

/** safety-spec §3 — `ALLOWED_DOMAINS` is the authoritative gate. Comma-separated
 * host list; empty/unset means nothing is allowed (fail-closed, not fail-open). */
export function parseAllowedDomains(envValue: string | undefined): string[] {
  return (envValue ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** safety-spec §4 — explicit regex denylist, not the "lacks a dev marker"
 * heuristic variant of the [CONFIRM] proposal: a positive "looks like dev"
 * check risks false-negatives (refusing nothing) far more than this refuses
 * too much, and an explicit pattern is auditable. Comma-separated; unset means
 * no prod patterns configured — the allowlist (§3) stays the authoritative,
 * fail-closed gate regardless, so an empty list here is "no extra layer", not
 * "no gate at all". */
export function parseProdUrlPatterns(envValue: string | undefined): RegExp[] {
  return (envValue ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((pattern) => new RegExp(pattern, "i"));
}

/** safety-spec §5 — Delete/Pay/Confirm/Remove/Purchase-style. Matched on
 * accessible name, word-boundary, case-insensitive — never substring. */
export const DEFAULT_DESTRUCTIVE_PATTERNS: readonly string[] = [
  "delete",
  "remove",
  "pay",
  "purchase",
  "confirm",
  "cancel",
  "charge",
  "submit order",
  "place order",
];

/** safety-spec §5 [CONFIRM]: only actionable roles are guarded — a heading or
 * paragraph that happens to contain "delete" isn't a mutating action. */
const ACTIONABLE_ROLES = new Set(["button", "link"]);

function toWordBoundaryPattern(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

/** safety-spec §3 — pre-run AND per-navigation (including `clickFirstLink`
 * destinations). Matches on `URL.host` (hostname + port if present) — never a
 * substring check, so `evil-rabbit.com` can never pass a `rabbit.com`
 * allowlist entry. Throws `SafetyViolation` on trip; returns nothing on pass. */
export function assertAllowedUrl(url: string, allowedHosts: readonly string[]): void {
  const host = new URL(url).host.toLowerCase();
  const allowed = new Set(allowedHosts.map((entry) => entry.toLowerCase()));
  if (!allowed.has(host)) {
    throw new SafetyViolation("ALLOWLIST", `host "${host}" is not on the domain allowlist (url: ${url})`);
  }
}

/** safety-spec §4 — defense in depth over the allowlist; refuses even an
 * allowlisted host if it matches a configured prod pattern. */
export function assertNotProdUrl(url: string, prodUrlPatterns: readonly RegExp[]): void {
  const host = new URL(url).host.toLowerCase();
  const matched = prodUrlPatterns.find((pattern) => pattern.test(host));
  if (matched) {
    throw new SafetyViolation("PROD_URL", `host "${host}" matches a production-url pattern (${matched.source})`);
  }
}

/** safety-spec §5 — before any mutating action (a click on a button/link). */
export function assertNotDestructive(
  action: ActionDescriptor,
  destructivePatterns: readonly string[] = DEFAULT_DESTRUCTIVE_PATTERNS,
): void {
  if (!ACTIONABLE_ROLES.has(action.role)) return;

  const matched = destructivePatterns.find((phrase) => toWordBoundaryPattern(phrase).test(action.accessibleName));
  if (matched) {
    throw new SafetyViolation(
      "DESTRUCTIVE_ACTION",
      `action "${action.accessibleName}" (role: ${action.role}) matches destructive pattern "${matched}"`,
    );
  }
}
