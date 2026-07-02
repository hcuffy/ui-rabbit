import type { Finding } from "@ui-rabbit/shared";

export interface ReproSpecInput {
  finding: Finding;
  url: string;
}

/** Repro-spec generator (driver-spec §5) — template module, decoupled from the driver
 * so a Cypress emitter could be added later without touching explore.ts. Re-derives
 * `deriveFingerprint` from a fresh capture rather than diffing raw text, so the repro
 * is robust to volatile-data drift (same masking pipeline, not a duplicate of it). */
export function generateReproSpec({ finding, url }: ReproSpecInput): string {
  const expectedMasked = finding.evidence.ariaSnapshot ?? "";

  return `import { expect, test } from "@playwright/test";
import { deriveFingerprint } from "@ui-rabbit/engine";

// Auto-generated repro for ${finding.type} finding ${finding.id} on screen ${finding.screenId}.
test("repro: ${finding.type} on screen ${finding.screenId}", async ({ page }) => {
  await page.goto(${JSON.stringify(url)});
  const ariaSnapshot = await page.ariaSnapshot({ boxes: true });
  const { ariaSnapshotMasked } = deriveFingerprint(ariaSnapshot);
  expect(ariaSnapshotMasked).toBe(${JSON.stringify(expectedMasked)});
});
`;
}
