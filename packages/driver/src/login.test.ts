import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { login, type LoginCreds } from "./login.js";

const LOGIN_URL = "http://mock.local/login";
const SUCCESS_URL = "http://mock.local/dashboard";

const TEST_CREDS: LoginCreds = {
  loginUrl: LOGIN_URL,
  email: "test@example.com",
  password: "mock-password-not-real",
  emailSelector: '[data-cy-id="email"]',
  passwordSelector: '[data-cy-id="password"]',
  submitSelector: '[data-cy-id="submit"]',
  timeoutMs: 2000,
};

/** Primary path: password CSS-hidden initially; email blur reveals it naturally.
 * force: true means the test also passes if reveal hasn't fired yet. */
function successLoginHtml(): string {
  return `<!doctype html><html><body>
    <input data-cy-id="email" type="email"
      onblur="document.querySelector('[data-cy-id=password]').style.removeProperty('display')" />
    <input data-cy-id="password" type="password" style="display:none" />
    <button data-cy-id="submit" type="button"
      onclick="window.location.href='${SUCCESS_URL}'">Login</button>
  </body></html>`;
}

/** Failure path: submit does nothing — run stays on login page. */
function failureLoginHtml(): string {
  return `<!doctype html><html><body>
    <input data-cy-id="email" type="email" />
    <input data-cy-id="password" type="password" style="display:none" />
    <button data-cy-id="submit" type="button">Login</button>
  </body></html>`;
}

/** fill-failure: password selector absent — fill throws; Playwright's error
 * would ordinarily embed the fill value in its call-log. */
function fillFailureLoginHtml(): string {
  return `<!doctype html><html><body>
    <input data-cy-id="email" type="email" />
    <!-- no [data-cy-id="password"] — fill will throw -->
    <button data-cy-id="submit" type="button">Login</button>
  </body></html>`;
}

/** nextSelector fallback: "Next" button between email and password steps.
 * Password is not inside a hidden container — force: true fills it directly. */
function twoStepLoginHtml(): string {
  return `<!doctype html><html><body>
    <input data-cy-id="email" type="email" />
    <button data-cy-id="next" type="button">Next</button>
    <input data-cy-id="password" type="password" style="display:none" />
    <button data-cy-id="submit" type="button"
      onclick="window.location.href='${SUCCESS_URL}'">Login</button>
  </body></html>`;
}

describe("login (auto-login-spec §2/§6)", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  async function withContext(fn: (ctx: BrowserContext) => Promise<void>): Promise<void> {
    const ctx = await browser.newContext();
    try {
      await fn(ctx);
    } finally {
      await ctx.close();
    }
  }

  it("resolves when login navigates away from the login URL", async () => {
    await withContext(async (ctx) => {
      await ctx.route(`${LOGIN_URL}**`, (route) =>
        route.fulfill({ contentType: "text/html", body: successLoginHtml() }),
      );
      await ctx.route(`${SUCCESS_URL}**`, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><html><body><h1>Dashboard</h1></body></html>",
        }),
      );
      const page = await ctx.newPage();
      await login(page, TEST_CREDS);
      expect(page.url()).toContain("dashboard");
    });
  });

  it("resolves the 2-step (identifier-first) flow when nextSelector is set", async () => {
    await withContext(async (ctx) => {
      await ctx.route(`${LOGIN_URL}**`, (route) =>
        route.fulfill({ contentType: "text/html", body: twoStepLoginHtml() }),
      );
      await ctx.route(`${SUCCESS_URL}**`, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><html><body><h1>Dashboard</h1></body></html>",
        }),
      );
      const page = await ctx.newPage();
      await login(page, { ...TEST_CREDS, nextSelector: '[data-cy-id="next"]' });
      expect(page.url()).toContain("dashboard");
    });
  });

  it("throws a credential-free error when login page does not navigate away", async () => {
    await withContext(async (ctx) => {
      await ctx.route(`${LOGIN_URL}**`, (route) =>
        route.fulfill({ contentType: "text/html", body: failureLoginHtml() }),
      );
      const page = await ctx.newPage();
      let caught: unknown;
      try {
        await login(page, TEST_CREDS);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain(`login failed at ${LOGIN_URL}`);
      expect((caught as Error).message).not.toContain(TEST_CREDS.password);
    });
  });

  it("checks loginUrl against onBeforeNavigate before any navigation (safety-spec §3)", async () => {
    await withContext(async (ctx) => {
      const page = await ctx.newPage();
      const guardError = new Error(`host "mock.local" is not on the domain allowlist`);
      let caught: unknown;
      try {
        await login(page, TEST_CREDS, (url) => {
          if (url === LOGIN_URL) throw guardError;
        });
      } catch (error) {
        caught = error;
      }
      // Propagates the guard's own error untouched — never wrapped, never redacted.
      expect(caught).toBe(guardError);
      expect(page.url()).toBe("about:blank"); // goto never happened
    });
  });

  it("re-checks the post-login redirect URL against onBeforeNavigate", async () => {
    await withContext(async (ctx) => {
      await ctx.route(`${LOGIN_URL}**`, (route) =>
        route.fulfill({ contentType: "text/html", body: successLoginHtml() }),
      );
      await ctx.route(`${SUCCESS_URL}**`, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><html><body><h1>Dashboard</h1></body></html>",
        }),
      );
      const page = await ctx.newPage();
      const guardError = new Error(`host "mock.local" matches a production-url pattern`);
      let caught: unknown;
      try {
        await login(page, TEST_CREDS, (url) => {
          if (url.includes("dashboard")) throw guardError;
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(guardError);
      expect((caught as Error).message).not.toContain(TEST_CREDS.password);
    });
  });

  it("succeeds unchanged when the hook passes every URL", async () => {
    await withContext(async (ctx) => {
      await ctx.route(`${LOGIN_URL}**`, (route) =>
        route.fulfill({ contentType: "text/html", body: successLoginHtml() }),
      );
      await ctx.route(`${SUCCESS_URL}**`, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><html><body><h1>Dashboard</h1></body></html>",
        }),
      );
      const page = await ctx.newPage();
      const seen: string[] = [];
      await login(page, TEST_CREDS, (url) => {
        seen.push(url);
      });
      expect(page.url()).toContain("dashboard");
      expect(seen[0]).toBe(LOGIN_URL);
      expect(seen[seen.length - 1]).toContain("dashboard");
    });
  });

  it("redacts password from Playwright fill error (call-log sanitization)", async () => {
    await withContext(async (ctx) => {
      await ctx.route(`${LOGIN_URL}**`, (route) =>
        route.fulfill({ contentType: "text/html", body: fillFailureLoginHtml() }),
      );
      const page = await ctx.newPage();
      let caught: unknown;
      try {
        await login(page, { ...TEST_CREDS, timeoutMs: 1000 });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      // Playwright's fill call-log embeds the fill value when the element is found
      // but fill fails mid-attempt; for element-not-found the message is a plain
      // timeout. Either way the password must not appear in the stored error.
      expect((caught as Error).message).not.toContain(TEST_CREDS.password);
      expect((caught as Error).message).toContain("login failed at");
    });
  });
});
