import type { CapturedObservation, HttpErrorSignal } from "@ui-rabbit/engine";
import { parseAriaSnapshot } from "@ui-rabbit/engine";
import type { Page } from "playwright";

export interface CaptureHandle {
  /** Clears buffers — call immediately before each navigation so a capture
   * reflects only that route visit's events, not prior ones. */
  reset(): void;
  read(): { consoleErrors: string[]; httpErrors: HttpErrorSignal[] };
}

/** Registers signal listeners once per page (driver-spec §3): console errors,
 * uncaught exceptions, and 4xx/5xx responses. */
export function attachCapture(page: Page): CaptureHandle {
  let consoleErrors: string[] = [];
  let httpErrors: HttpErrorSignal[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400) {
      httpErrors.push({ method: response.request().method(), url: response.url(), status });
    }
  });

  return {
    reset() {
      consoleErrors = [];
      httpErrors = [];
    },
    read() {
      return { consoleErrors: [...consoleErrors], httpErrors: [...httpErrors] };
    },
  };
}

/** Assembles one engine-ready `CapturedObservation` (driver-spec §3) — the driver's
 * only contract obligation. No parallel type: this object shape is the engine's own
 * `CapturedObservation` from packages/engine/src/types.ts. */
export async function captureObservation(page: Page, handle: CaptureHandle): Promise<CapturedObservation> {
  const ariaSnapshot = await page.ariaSnapshot({ boxes: true });
  const documentTitle = await page.title();
  const tree = parseAriaSnapshot(ariaSnapshot);
  const { consoleErrors, httpErrors } = handle.read();

  const observation: CapturedObservation = {
    url: page.url(),
    ariaSnapshot,
    documentTitle,
    isBlank: tree.children.length === 0,
  };
  if (consoleErrors.length > 0) observation.consoleErrors = consoleErrors;
  if (httpErrors.length > 0) observation.httpErrors = httpErrors;

  return observation;
}
