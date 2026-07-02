import type { Page } from "playwright";

/** Strips all occurrences of secret from an error's message — prevents Playwright's
 * call-log from echoing fill values into Run.error or stderr. */
function redact(err: unknown, secret: string): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(msg.replaceAll(secret, "***"));
}

export interface LoginCreds {
  loginUrl: string;
  email: string;
  password: string;
  emailSelector: string;
  passwordSelector: string;
  submitSelector: string;
  /** Optional fallback for apps that require an explicit "Next" click between email
   * and password steps. The primary path (pressSequentially + blur + force fill)
   * covers most reveal-on-input flows without this. When set, it is clicked after
   * the email blur — no visibility wait before filling the password. */
  nextSelector?: string;
  /** Milliseconds to wait for navigation away from the login URL. Default: 10 000. */
  timeoutMs?: number;
}

/** auto-login-spec §2 — app-agnostic login: real keystrokes on the email field so
 * reveal-on-input/blur apps expose the password field naturally; force-fills the
 * password input without requiring it to be visible (covers CSS-hidden fields).
 * Waits for navigation away from loginUrl; throws a credential-free error on timeout.
 * Never logs or propagates the password.
 *
 * `onBeforeNavigate` is the same injected safety hook the rest of the driver uses
 * (safety-spec §3): checked against `loginUrl` before the goto, and against the
 * post-login landing URL after the redirect resolves (post-hoc by necessity — the
 * app chooses the redirect target). Both calls sit outside the redacting try
 * blocks: a `SafetyViolation` propagates untouched (guard messages carry hosts,
 * never the password). */
export async function login(
  page: Page,
  creds: LoginCreds,
  onBeforeNavigate?: (url: string) => Promise<void> | void,
): Promise<void> {
  const loginUrlObj = new URL(creds.loginUrl);
  const isOnLoginPage = (url: URL): boolean =>
    url.origin === loginUrlObj.origin && url.pathname === loginUrlObj.pathname;

  const timeout = creds.timeoutMs ?? 10_000;

  await onBeforeNavigate?.(creds.loginUrl);
  await page.goto(creds.loginUrl);

  // Real keystrokes fire input events so reveal-on-type apps show the password field;
  // blur fires blur events for reveal-on-blur apps.
  await page.locator(creds.emailSelector).pressSequentially(creds.email);
  await page.locator(creds.emailSelector).blur();

  // Optional fallback: explicit "Next" click for apps that need it.
  if (creds.nextSelector) {
    try {
      await page.locator(creds.nextSelector).click();
    } catch {
      throw new Error(`login failed at ${creds.loginUrl}`);
    }
  }

  // force: true bypasses the visibility check — fills a present-but-CSS-hidden
  // password input without waiting for it to become visible.
  // Playwright's fill error echoes the fill value in its call-log — redact before
  // the error reaches Run.error or stderr.
  try {
    await page.locator(creds.passwordSelector).fill(creds.password, { force: true, timeout });
  } catch (err) {
    throw new Error(`login failed at ${creds.loginUrl}: ${redact(err, creds.password).message}`);
  }

  try {
    await Promise.all([
      page.waitForURL((url) => !isOnLoginPage(url), { timeout }),
      page.locator(creds.submitSelector).click(),
    ]);
  } catch (err) {
    // waitForURL call-log may include recent fill values — redact before storing.
    throw new Error(`login failed at ${creds.loginUrl}: ${redact(err, creds.password).message}`);
  }

  // safety-spec §3 — the app picked the redirect target; re-check it like any
  // other visited URL. Outside the try above so the guard's error stays intact.
  await onBeforeNavigate?.(page.url());
}
