import { findFirstNode, parseAriaSnapshot, type CapturedObservation } from "@ui-rabbit/engine";
import type { Browser, BrowserContext } from "playwright";
import { attachCapture, captureObservation } from "./capture.js";
import { resolveCharter } from "./charter.js";
import { login, type LoginCreds } from "./login.js";

/** safety-spec §5 — the shape `onBeforeAction` receives. Not a forked type: this
 * is the driver's own minimal description of "what's about to be clicked", not a
 * copy of anything in `safety.ts` (the driver never imports that module). */
export interface ActionDescriptor {
  role: string;
  accessibleName: string;
}

export interface ExploreOptions {
  charter: string;
  baseUrl: string;
  /** Caller-launched (CLI today; the D4 backend launches it in-process later). */
  browser: Browser;
  /** auto-login-spec §3 — when set, logs in fresh before charter steps and
   * ignores storageState (auto-login takes precedence). */
  loginCreds?: LoginCreds;
  /** Fallback auth seam — used only when loginCreds is absent. */
  storageState?: string;
  /** Mock/test hook only — installs `context.route()` fulfillment before navigation. */
  installRoutes?: (context: BrowserContext) => Promise<void>;
  /** safety-spec §3/§8 — called with the fully-resolved target URL before every
   * navigation, including `clickFirstLink` destinations. Throws to abort the run;
   * the driver doesn't own the rule, it just calls whatever's injected (the
   * backend orchestrator wires this to `packages/backend/src/safety.ts` in
   * production). Unset = no check (e.g. the CLI's local-mock-only demo). */
  onBeforeNavigate?: (url: string) => Promise<void> | void;
  /** safety-spec §5/§8 — called with the element's role + accessible name before
   * every mutating action. Throws to abort the run. */
  onBeforeAction?: (action: ActionDescriptor) => Promise<void> | void;
  /** safety-spec §6 — graceful step budget, not a guard: truncates the charter's
   * step list rather than throwing, so the run completes with what it captured. */
  maxSteps?: number;
}

/** Charter-scripted exploration (driver-spec §3/§4/§7): one isolated context per run,
 * one page, walk the charter's fixed route list, capture each state. */
export async function explore(options: ExploreOptions): Promise<CapturedObservation[]> {
  const plan = resolveCharter(options.charter);
  const steps = options.maxSteps !== undefined ? plan.steps.slice(0, options.maxSteps) : plan.steps;
  // auto-login-spec §3: loginCreds takes precedence — start fresh (no storageState).
  const useStorageState = options.loginCreds === undefined && options.storageState !== undefined;
  const context = await options.browser.newContext(
    useStorageState ? { storageState: options.storageState } : {},
  );

  try {
    if (options.installRoutes) await options.installRoutes(context);

    const page = await context.newPage();
    const handle = attachCapture(page);

    // auto-login-spec §2 — login before charter steps; throws on failure so the
    // run fails before any unauthenticated page is captured. The same injected
    // safety hook guards the login URL and the post-login redirect (safety-spec §3).
    if (options.loginCreds) {
      await login(page, options.loginCreds, options.onBeforeNavigate);
    }

    const observations: CapturedObservation[] = [];

    for (const step of steps) {
      handle.reset();
      if (step.kind === "navigate") {
        const url = `${options.baseUrl}${step.path}`;
        await options.onBeforeNavigate?.(url);
        await page.goto(url);
      } else {
        // safety-spec §5 — derive the accessible name from the same aria-snapshot
        // parsing the rest of the engine trusts, not `textContent()`: an icon-only
        // element with an `aria-label` (and empty text content) would otherwise
        // slip the destructive-action guard entirely.
        const snapshot = await page.ariaSnapshot();
        const tree = parseAriaSnapshot(snapshot);
        const firstLink = findFirstNode(tree, (node) => node.role === "link");
        const accessibleName = firstLink?.name ?? "";
        await options.onBeforeAction?.({ role: "link", accessibleName });

        const link = page.getByRole("link").first();
        const href = await link.getAttribute("href");
        if (href) {
          const resolvedUrl = new URL(href, page.url()).toString();
          await options.onBeforeNavigate?.(resolvedUrl);
        }
        await link.click();
      }
      await page.waitForLoadState("networkidle");
      observations.push(await captureObservation(page, handle));
    }

    return observations;
  } finally {
    await context.close();
  }
}
