import type { BrowserContext } from "playwright";
import { renderLocationDetailHtml, renderLocationsListHtml, type MockSeed, type MockVariant } from "./pages.js";

const LIST_PATH = "/fleet/auth/platform/locations";
const DETAIL_PATH = /^\/fleet\/auth\/platform\/locations\/\d+$/;

/** Mock target via `context.route()` fulfillment (driver-spec §2, judgment call: chosen
 * over a real static server — no port management/flakiness in CI, and Playwright
 * fulfills routes before any real DNS/network attempt, so a fake origin is safe). */
export async function installMockTarget(
  context: BrowserContext,
  variant: MockVariant,
  seed: MockSeed,
): Promise<void> {
  await context.route(`**${LIST_PATH}**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname === LIST_PATH) {
      await route.fulfill({ contentType: "text/html", body: renderLocationsListHtml(variant, seed) });
      return;
    }

    if (DETAIL_PATH.test(pathname)) {
      await route.fulfill({ contentType: "text/html", body: renderLocationDetailHtml(seed) });
      return;
    }

    await route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });
}
