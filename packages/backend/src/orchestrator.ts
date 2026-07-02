import { deriveScreenId, runEngineLoop, type AnthropicLike, type CapturedObservation } from "@ui-rabbit/engine";
import { explore, generateReproSpec, type ActionDescriptor, type LoginCreds } from "@ui-rabbit/driver";
import type { AppMap, AppMapScreen, Finding, Run } from "@ui-rabbit/shared";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import type { AppMapRepo } from "./repos/appMapRepo.js";
import type { BaselineRepo } from "./repos/baselineRepo.js";
import type { FindingRepo } from "./repos/findingRepo.js";
import type { RunRepo } from "./repos/runRepo.js";
import { assertAllowedUrl, assertNotDestructive, assertNotProdUrl, DEFAULT_DESTRUCTIVE_PATTERNS } from "./safety.js";

export interface OrchestratorDeps {
  runRepo: RunRepo;
  findingRepo: FindingRepo;
  baselineRepo: BaselineRepo;
  appMapRepo: AppMapRepo;
  reproSpecDir: string;
  /** judge-spec §4 — lazy factory, not a constructed client: called only on the
   * first real judge use, so a run with no divergences never needs an API key.
   * Tests pass a factory returning a fake (no real API in CI). */
  judgeClientFactory: () => AnthropicLike;
  /** judge-spec §7 — per-run LLM budget caps; undefined means unlimited. */
  maxLlmCalls?: number;
  maxUsdPerRun?: number;
  /** safety-spec §3 — authoritative domain allowlist. Empty = nothing is allowed
   * (fail-closed). Checked pre-run against `targetBaseUrl` and per-navigation
   * (including `clickFirstLink` destinations) via the driver's injected hook. */
  allowedDomains: string[];
  /** safety-spec §4 — defense-in-depth prod-host denylist; empty = no extra check
   * (the allowlist above stays the authoritative gate regardless). */
  prodUrlPatterns: RegExp[];
  /** safety-spec §5 — defaults to `DEFAULT_DESTRUCTIVE_PATTERNS` when omitted. */
  destructivePatterns?: string[];
  /** safety-spec §6 — graceful step budget (not a guard); undefined = unlimited. */
  maxSteps?: number;
  /** auto-login-spec §2/§3 — when set, logs in fresh before each run's charter steps.
   * Takes precedence over storageState (§3: creds present → auto-login). */
  loginCreds?: LoginCreds;
  /** Fallback auth seam (driver-spec §7) — used only when loginCreds is absent.
   * Path to a Playwright storageState JSON; existence checked per-run. */
  storageState?: string;
  /** Mock/test hook only (mirrors driver's `ExploreOptions.installRoutes`) — installs
   * `context.route()` fulfillment before navigation. Unset in production (§4 step 2). */
  installRoutes?: (context: BrowserContext) => Promise<void>;
}

export interface StartRunInput {
  charter: string;
  targetBaseUrl: string;
}

/** Registry of in-flight background jobs (audit #8) — lets `waitForInFlightRuns`
 * give a graceful shutdown a bounded chance to let them reach a terminal status
 * before `closeMongo()` pulls the connection out from under them. `executeRun`
 * never rejects (its own try/catch guarantees that), so this never needs a
 * `.catch()` to avoid an unhandled rejection. */
const inFlightRuns = new Set<Promise<void>>();

/** Waits for all currently in-flight runs to finish, or `timeoutMs`, whichever
 * comes first — bounded, not unlimited, so a wedged run can't hang shutdown
 * forever. */
export async function waitForInFlightRuns(timeoutMs: number): Promise<void> {
  if (inFlightRuns.size === 0) return;
  const allDone = Promise.all([...inFlightRuns]);
  await Promise.race([allDone, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/** backend-spec §4 step 1 + §6 — persists `PENDING`, kicks the background job (which
 * catches all its own errors, §6), returns immediately so `POST /runs` stays responsive. */
export async function startRun(input: StartRunInput, deps: OrchestratorDeps): Promise<Run> {
  const run: Run = {
    id: randomUUID(),
    charter: input.charter,
    targetBaseUrl: input.targetBaseUrl,
    status: "PENDING",
    startedAt: new Date(),
    stepsUsed: 0,
    llmCallsUsed: 0,
    costUsd: 0,
  };
  await deps.runRepo.create(run);

  const job: Promise<void> = executeRun(run, deps).finally(() => {
    inFlightRuns.delete(job);
  });
  inFlightRuns.add(job);

  return run;
}

interface ScreenInfo {
  observation: CapturedObservation;
  screenId: string;
  normalizedUrl: string;
  headingAnchor: string;
}

async function persistAppMap(screens: ScreenInfo[], baseUrl: string, appMapRepo: AppMapRepo): Promise<void> {
  const existing = await appMapRepo.get();
  const knownScreenIds = new Set((existing?.screens ?? []).map((screen) => screen.screenId));
  const now = new Date();

  const discovered: AppMapScreen[] = [];
  for (const screen of screens) {
    if (knownScreenIds.has(screen.screenId)) continue;
    knownScreenIds.add(screen.screenId);
    discovered.push({
      screenId: screen.screenId,
      normalizedUrl: screen.normalizedUrl,
      headingAnchor: screen.headingAnchor,
      discoveredAt: now,
    });
  }

  if (!existing && discovered.length === 0) return;

  const appMap: AppMap = {
    id: existing?.id ?? randomUUID(),
    baseUrl,
    screens: [...(existing?.screens ?? []), ...discovered],
  };
  await appMapRepo.upsert(appMap);
}

/** §4 step 6 — gated on a confirmed REGRESSION verdict (judge-spec §9: flipped from
 * the D3/D4 STATE_DIVERGENCE+NEW placeholder now that the real judge produces
 * real verdicts). */
async function attachReproSpecs(
  findings: Finding[],
  screens: ScreenInfo[],
  reproSpecDir: string,
): Promise<Finding[]> {
  const urlByScreenId = new Map(screens.map((screen) => [screen.screenId, screen.observation.url]));
  const result: Finding[] = [];

  for (const finding of findings) {
    if (finding.verdict !== "REGRESSION") {
      result.push(finding);
      continue;
    }
    const url = urlByScreenId.get(finding.screenId);
    if (!url) {
      result.push(finding);
      continue;
    }

    await mkdir(reproSpecDir, { recursive: true });
    const reproSpecPath = join(reproSpecDir, `${finding.id}.spec.ts`);
    await writeFile(reproSpecPath, generateReproSpec({ finding, url }), "utf8");
    result.push({ ...finding, reproSpecPath });
  }

  return result;
}

async function runFailed(run: Run, deps: OrchestratorDeps, error: unknown): Promise<void> {
  try {
    await deps.runRepo.updateStatus(run.id, {
      status: "FAILED",
      finishedAt: new Date(),
      error: error instanceof Error ? error.message : String(error),
    });
  } catch (updateError) {
    // Last-resort guard (§6): even the failure write must not escape and crash Fastify.
    console.error("orchestrator: failed to persist FAILED status for run", run.id, updateError);
  }
}

/** §4 — the loop: launch browser -> explore -> engine -> persist. Never rejects; all
 * errors are caught and written to the run as FAILED (§6 "must never crash Fastify").
 * safety-spec §2: a `SafetyViolation` (allowlist/prod/destructive) is just another
 * thrown error here — it lands in the same catch and the same `Run.FAILED` write,
 * with the guard's own message as the reason. No separate code path needed. */
async function executeRun(run: Run, deps: OrchestratorDeps): Promise<void> {
  try {
    await deps.runRepo.updateStatus(run.id, { status: "RUNNING" });

    // safety-spec §3/§4 — pre-run: cheapest possible refusal, before any browser work.
    assertAllowedUrl(run.targetBaseUrl, deps.allowedDomains);
    assertNotProdUrl(run.targetBaseUrl, deps.prodUrlPatterns);
    // The login URL is a navigation target too — same pre-launch checks as the
    // target itself (the driver re-checks it per-navigation via the injected hook).
    if (deps.loginCreds) {
      assertAllowedUrl(deps.loginCreds.loginUrl, deps.allowedDomains);
      assertNotProdUrl(deps.loginCreds.loginUrl, deps.prodUrlPatterns);
    }

    const destructivePatterns = deps.destructivePatterns ?? DEFAULT_DESTRUCTIVE_PATTERNS;

    // auto-login-spec §3: loginCreds takes precedence; skip storageState resolution
    // entirely when creds are configured.
    let storageState: string | undefined;
    if (!deps.loginCreds && deps.storageState) {
      try {
        await access(deps.storageState);
        storageState = deps.storageState;
      } catch {
        // file absent — proceed unauthenticated
      }
    }

    const browser = await chromium.launch();
    let observations: CapturedObservation[];
    try {
      observations = await explore({
        charter: run.charter,
        baseUrl: run.targetBaseUrl,
        browser,
        loginCreds: deps.loginCreds,
        storageState,
        installRoutes: deps.installRoutes,
        maxSteps: deps.maxSteps,
        // safety-spec §3/§8 — same per-navigation check, re-run for every URL the
        // driver actually visits (an in-app link can point off-domain even when
        // targetBaseUrl itself was on the allowlist).
        onBeforeNavigate: (url) => {
          assertAllowedUrl(url, deps.allowedDomains);
          assertNotProdUrl(url, deps.prodUrlPatterns);
        },
        // safety-spec §5/§8 — before any mutating action.
        onBeforeAction: (action: ActionDescriptor) => assertNotDestructive(action, destructivePatterns),
      });
    } finally {
      await browser.close();
    }

    const screens: ScreenInfo[] = observations.map((observation) => ({
      observation,
      ...deriveScreenId(observation),
    }));
    const screenIds = screens.map((screen) => screen.screenId);

    const [existingBaselines, existingFindings] = await Promise.all([
      deps.baselineRepo.getByScreenIds(screenIds),
      deps.findingRepo.findByScreenIds(screenIds),
    ]);

    const output = await runEngineLoop({
      runId: run.id,
      charter: run.charter,
      observations,
      existingBaselines,
      existingFindings,
      judge: { clientFactory: deps.judgeClientFactory },
      maxLlmCalls: deps.maxLlmCalls,
      maxUsdPerRun: deps.maxUsdPerRun,
    });

    const findingsWithRepro = await attachReproSpecs(output.findings, screens, deps.reproSpecDir);

    await Promise.all(output.baselines.map((baseline) => deps.baselineRepo.upsert(baseline)));
    await Promise.all(findingsWithRepro.map((finding) => deps.findingRepo.upsert(finding)));
    await persistAppMap(screens, run.targetBaseUrl, deps.appMapRepo);

    await deps.runRepo.updateStatus(run.id, {
      status: "COMPLETED",
      finishedAt: new Date(),
      stepsUsed: observations.length,
      llmCallsUsed: output.llmCallsUsed,
      costUsd: output.costUsd,
    });
  } catch (error) {
    await runFailed(run, deps, error);
  }
}
