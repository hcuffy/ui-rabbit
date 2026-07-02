/** Local mock target — pure HTML-string builders (driver-spec §2). Mimics rabbit's
 * locations list + detail route shape. Invented structure — re-confirm against real
 * rabbit when that env is wired (driver-spec §9). */
export type MockVariant = "baseline" | "volatile-only" | "changed-regression";

export interface MockSeed {
  /** UUID-shaped — masked to <ID> by the engine. Varies freely across variants. */
  recordId: string;
  /** ISO-8601 — masked to <TIME> by the engine. Varies freely across variants. */
  timestamp: string;
  /** Plain number — engine-spec §7.4 preserves numbers verbatim, not masked.
   * Must stay IDENTICAL between baseline and volatile-only or it flags by design
   * (this is the one driver-spec §2 "result count" item that can't safely vary
   * at D3 without a number-masking change the engine doesn't have yet). */
  count: number;
}

const LOCATION_HREF = "/fleet/auth/platform/locations/1";
const LOCATION_NAME = "Main Warehouse";

function page(body: string): string {
  return `<!doctype html><html><head><title>rabbit</title></head><body>${body}</body></html>`;
}

export function renderLocationsListHtml(variant: MockVariant, seed: MockSeed): string {
  const addButton = variant === "changed-regression" ? "" : `<button type="button">Add Location</button>`;

  return page(`
    <h1>Locations</h1>
    <p>Last updated: ${seed.timestamp}</p>
    <p>${seed.count} locations found</p>
    <ul>
      <li><a href="${LOCATION_HREF}">${LOCATION_NAME}</a></li>
    </ul>
    ${addButton}
  `);
}

export function renderLocationDetailHtml(seed: MockSeed): string {
  return page(`
    <h1>${LOCATION_NAME}</h1>
    <p>ID: ${seed.recordId}</p>
    <p>Last updated: ${seed.timestamp}</p>
  `);
}
