import type { AnthropicLike, AnthropicMessageResponse } from "@ui-rabbit/engine";
import { installMockTarget, type MockSeed } from "@ui-rabbit/driver";
import type { Run } from "@ui-rabbit/shared";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeMongo, connectMongo, type MongoConnection } from "./db/connection.js";
import { startRun, waitForInFlightRuns, type OrchestratorDeps } from "./orchestrator.js";
import { AppMapRepo } from "./repos/appMapRepo.js";
import { BaselineRepo } from "./repos/baselineRepo.js";
import { FindingRepo } from "./repos/findingRepo.js";
import { RunRepo } from "./repos/runRepo.js";

const MOCK_BASE_URL = "http://mock.local";
const CHARTER = "test the locations flow";

function seedFor(overrides: Partial<MockSeed> = {}): MockSeed {
  return { recordId: randomUUID(), timestamp: new Date().toISOString(), count: 7, ...overrides };
}

/** judge-spec §8 — mocked SDK client, no real API in CI. Default: asserts the
 * judge is never called (used where no divergence is expected). */
function throwingJudgeClient(): AnthropicLike {
  return {
    messages: {
      create: () => {
        throw new Error("judge should not be called — no divergence expected in this test");
      },
    },
  };
}

function regressionJudgeClient(): AnthropicLike {
  const response: AnthropicMessageResponse = {
    content: [
      { type: "tool_use", name: "submit_verdict", input: { verdict: "REGRESSION", severity: "HIGH", reasoning: "button removed", confidence: 0.9 } },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  return { messages: { create: () => Promise.resolve(response) } };
}

async function waitForTerminal(runRepo: RunRepo, runId: string): Promise<Run> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const run = await runRepo.get(runId);
    if (run && (run.status === "COMPLETED" || run.status === "FAILED")) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`run ${runId} did not reach a terminal state in time`);
}

/** backend-spec §7 — orchestrator test against mongodb-memory-server (no Docker),
 * driving the D3 mock through the real, unmodified engine + driver. This is the
 * automated proxy for the restart-survival proof: a fresh `deps` set per `it` here
 * plays the same role a backend restart does manually (§7/§10) — no in-memory cache
 * carries state between runs, only what's actually persisted to Mongo does. */
describe("orchestrator (backend-spec §4) — D3 mock through the real engine, persisted to Mongo", () => {
  let mongod: MongoMemoryServer;
  let connection: MongoConnection;
  let deps: OrchestratorDeps;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await connectMongo(mongod.getUri());
    const reproSpecDir = await mkdtemp(join(tmpdir(), "ui-rabbit-repro-"));
    deps = {
      runRepo: new RunRepo(connection.db),
      findingRepo: new FindingRepo(connection.db),
      baselineRepo: new BaselineRepo(connection.db),
      appMapRepo: new AppMapRepo(connection.db),
      reproSpecDir,
      judgeClientFactory: throwingJudgeClient,
      allowedDomains: ["mock.local"],
      prodUrlPatterns: [],
    };
  }, 30_000);

  afterAll(async () => {
    await closeMongo(connection);
    await mongod.stop();
  });

  it("run 1 learns baselines+appMap; run 2 against an unchanged target reads them back from Mongo and suppresses", async () => {
    const baselineSeed = seedFor();
    const run1 = await startRun(
      { charter: CHARTER, targetBaseUrl: MOCK_BASE_URL },
      { ...deps, installRoutes: (context) => installMockTarget(context, "baseline", baselineSeed) },
    );
    const run1Final = await waitForTerminal(deps.runRepo, run1.id);
    expect(run1Final.status).toBe("COMPLETED");
    expect(run1Final.stepsUsed).toBeGreaterThan(0);

    const run1Findings = await deps.findingRepo.listByRun(run1.id);
    expect(run1Findings.filter((finding) => finding.type === "STATE_DIVERGENCE")).toHaveLength(0);

    const appMapAfterRun1 = await deps.appMapRepo.get();
    expect(appMapAfterRun1?.screens.length).toBe(1); // locations-list only

    const run2 = await startRun(
      { charter: CHARTER, targetBaseUrl: MOCK_BASE_URL },
      {
        ...deps,
        installRoutes: (context) =>
          installMockTarget(
            context,
            "volatile-only",
            seedFor({ timestamp: new Date(Date.now() + 60_000).toISOString() }),
          ),
      },
    );
    const run2Final = await waitForTerminal(deps.runRepo, run2.id);
    expect(run2Final.status).toBe("COMPLETED");

    const run2Findings = await deps.findingRepo.listByRun(run2.id);
    expect(run2Findings.filter((finding) => finding.type === "STATE_DIVERGENCE")).toHaveLength(0);

    // No new screens learned on run 2 -- proves run 2 read run 1's baselines back from Mongo.
    const appMapAfterRun2 = await deps.appMapRepo.get();
    expect(appMapAfterRun2?.screens.length).toBe(1);
    expect(appMapAfterRun2?.id).toBe(appMapAfterRun1?.id);
  }, 30_000);

  it("a run against a changed target flags a NEW STATE_DIVERGENCE and writes a repro spec to disk", async () => {
    const priorRun = await startRun(
      { charter: CHARTER, targetBaseUrl: MOCK_BASE_URL },
      { ...deps, installRoutes: (context) => installMockTarget(context, "baseline", seedFor()) },
    );
    await waitForTerminal(deps.runRepo, priorRun.id);

    const changedRun = await startRun(
      { charter: CHARTER, targetBaseUrl: MOCK_BASE_URL },
      {
        ...deps,
        judgeClientFactory: regressionJudgeClient,
        installRoutes: (context) => installMockTarget(context, "changed-regression", seedFor()),
      },
    );
    const changedFinal = await waitForTerminal(deps.runRepo, changedRun.id);
    expect(changedFinal.status).toBe("COMPLETED");
    expect(changedFinal.llmCallsUsed).toBe(1);
    expect(changedFinal.costUsd).toBeGreaterThan(0);

    const findings = await deps.findingRepo.listByRun(changedRun.id);
    const divergence = findings.find((finding) => finding.type === "STATE_DIVERGENCE" && finding.status === "NEW");
    expect(divergence).toBeDefined();
    expect(divergence?.verdict).toBe("REGRESSION");
    expect(divergence?.reproSpecPath).toBeDefined();
    if (!divergence?.reproSpecPath) throw new Error("unreachable — asserted above");

    const reproContents = await readFile(divergence.reproSpecPath, "utf8");
    expect(reproContents).toContain("test(");
    expect(reproContents).toContain("deriveFingerprint");
  }, 30_000);

  it("a run that fails (bad charter) writes FAILED + error, never leaves the run stuck RUNNING", async () => {
    const run = await startRun({ charter: "no charter matches this", targetBaseUrl: MOCK_BASE_URL }, deps);
    const final = await waitForTerminal(deps.runRepo, run.id);
    expect(final.status).toBe("FAILED");
    expect(final.error).toBeTruthy();
  }, 30_000);
});

/** safety-spec §9 — orchestrator integration: off-allowlist target, off-domain
 * navigation mid-run, and a destructive action all hard-fail the run. No real
 * network — same mongodb-memory-server + driver-mock setup as above. */
describe("orchestrator safety floor (safety-spec §2/§3/§5)", () => {
  let mongod: MongoMemoryServer;
  let connection: MongoConnection;
  let deps: OrchestratorDeps;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await connectMongo(mongod.getUri());
    const reproSpecDir = await mkdtemp(join(tmpdir(), "ui-rabbit-repro-safety-"));
    deps = {
      runRepo: new RunRepo(connection.db),
      findingRepo: new FindingRepo(connection.db),
      baselineRepo: new BaselineRepo(connection.db),
      appMapRepo: new AppMapRepo(connection.db),
      reproSpecDir,
      judgeClientFactory: throwingJudgeClient,
      allowedDomains: ["mock.local"],
      prodUrlPatterns: [],
    };
  }, 30_000);

  afterAll(async () => {
    await closeMongo(connection);
    await mongod.stop();
  });

  it("an off-allowlist targetBaseUrl is refused before the browser ever launches", async () => {
    const run = await startRun(
      { charter: CHARTER, targetBaseUrl: "http://not-allowed.example" },
      deps,
    );
    const final = await waitForTerminal(deps.runRepo, run.id);

    expect(final.status).toBe("FAILED");
    expect(final.error).toContain("not on the domain allowlist");
    expect(final.stepsUsed).toBe(0); // never explored — refused pre-launch
  }, 15_000);

  /** auto-login audit fix 1 — the login URL is a navigation target too: an
   * off-allowlist TARGET_LOGIN_URL must refuse the run pre-launch even when
   * targetBaseUrl itself is allowlisted. */
  it("an off-allowlist login URL is refused before the browser ever launches", async () => {
    const run = await startRun(
      { charter: CHARTER, targetBaseUrl: MOCK_BASE_URL },
      {
        ...deps,
        loginCreds: {
          loginUrl: "http://not-allowed.example/login",
          email: "test@example.com",
          password: "mock-password-not-real",
          emailSelector: "#email",
          passwordSelector: "#password",
          submitSelector: "#submit",
        },
      },
    );
    const final = await waitForTerminal(deps.runRepo, run.id);

    expect(final.status).toBe("FAILED");
    expect(final.error).toContain("not on the domain allowlist");
    expect(final.stepsUsed).toBe(0);
  }, 15_000);

  /** audit #3 — the allowlist alone passing must not be enough; a configured
   * prod pattern refuses even an allowlisted host (safety-spec §4 defense in
   * depth). Browser never launches, same as the off-allowlist case. */
  it("an allowlisted host that also matches a configured prod-URL pattern is refused before the browser ever launches", async () => {
    const run = await startRun(
      { charter: CHARTER, targetBaseUrl: MOCK_BASE_URL },
      { ...deps, prodUrlPatterns: [/^mock\.local$/i] },
    );
    const final = await waitForTerminal(deps.runRepo, run.id);

    expect(final.status).toBe("FAILED");
    expect(final.error).toContain("production-url pattern");
    expect(final.stepsUsed).toBe(0);
  }, 15_000);
});

/** audit #8 — a graceful shutdown gives in-flight runs a bounded chance to
 * finish before Mongo closes underneath them, rather than stranding them
 * RUNNING forever. */
describe("waitForInFlightRuns (audit #8)", () => {
  let mongod: MongoMemoryServer;
  let connection: MongoConnection;
  let deps: OrchestratorDeps;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await connectMongo(mongod.getUri());
    const reproSpecDir = await mkdtemp(join(tmpdir(), "ui-rabbit-repro-inflight-"));
    deps = {
      runRepo: new RunRepo(connection.db),
      findingRepo: new FindingRepo(connection.db),
      baselineRepo: new BaselineRepo(connection.db),
      appMapRepo: new AppMapRepo(connection.db),
      reproSpecDir,
      judgeClientFactory: throwingJudgeClient,
      allowedDomains: ["mock.local"],
      prodUrlPatterns: [],
    };
  }, 30_000);

  afterAll(async () => {
    await closeMongo(connection);
    await mongod.stop();
  });

  it("a short timeout returns without waiting for the run to finish; a generous one waits for it", async () => {
    const startedAt = Date.now();
    const run = await startRun(
      { charter: CHARTER, targetBaseUrl: MOCK_BASE_URL },
      { ...deps, installRoutes: (context) => installMockTarget(context, "baseline", seedFor()) },
    );

    // Real chromium launch + navigation takes well over 50ms — the run is still
    // in-flight here, so a short timeout must return early, not block on it.
    await waitForInFlightRuns(50);
    expect(Date.now() - startedAt).toBeLessThan(500);

    // A generous timeout actually waits for the run to reach a terminal status.
    await waitForInFlightRuns(10_000);
    const final = await deps.runRepo.get(run.id);
    expect(final?.status).toBe("COMPLETED");
  }, 15_000);
});
