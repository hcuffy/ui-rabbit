import type { CharterPlan } from "./types.js";

/** Charter-scripted exploration (driver-spec §4, settled decision: LLM is the judge,
 * not the navigator). A charter string maps to a fixed, known route list — no
 * LLM-driven roaming at D3. */
export function resolveCharter(charter: string): CharterPlan {
  if (/location/i.test(charter)) {
    return {
      name: "locations-flow",
      steps: [{ kind: "navigate", path: "/fleet/auth/platform/locations" }],
    };
  }

  throw new Error(`charter-scripted only — no LLM-driven exploration yet: "${charter}"`);
}
