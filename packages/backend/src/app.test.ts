import type { AnthropicLike } from "@ui-rabbit/engine";
import { installMockTarget, type MockSeed } from "@ui-rabbit/driver";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type AppDeps } from "./app.js";
import { closeMongo, connectMongo, type MongoConnection } from "./db/connection.js";
import { AppMapRepo } from "./repos/appMapRepo.js";
import { BaselineRepo } from "./repos/baselineRepo.js";
import { FindingRepo } from "./repos/findingRepo.js";
import { RunRepo } from "./repos/runRepo.js";

const MOCK_BASE_URL = "http://mock.local";

function seedFor(overrides: Partial<MockSeed> = {}): MockSeed {
  return { recordId: randomUUID(), timestamp: new Date().toISOString(), count: 7, ...overrides };
}

interface RunResponseBody {
  runId: string;
  status: string;
}

/** judge-spec §8 — mocked SDK client, no real API in CI. The "baseline" mock
 * variant never diverges within a single run, so the judge should never be called. */
function throwingJudgeClient(): AnthropicLike {
  return {
    messages: {
      create: () => {
        throw new Error("judge should not be called — no divergence expected in this test");
      },
    },
  };
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition not met in time");
}

/** backend-spec §10 done criteria: `POST /runs` returns immediately, the run completes
 * in the background, `GET /runs/:id` reflects status transitions. */
describe("Fastify app (backend-spec §5)", () => {
  let mongod: MongoMemoryServer;
  let connection: MongoConnection;
  let app: FastifyInstance;
  let deps: AppDeps;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await connectMongo(mongod.getUri());
    const reproSpecDir = await mkdtemp(join(tmpdir(), "ui-rabbit-repro-app-"));
    deps = {
      runRepo: new RunRepo(connection.db),
      findingRepo: new FindingRepo(connection.db),
      baselineRepo: new BaselineRepo(connection.db),
      appMapRepo: new AppMapRepo(connection.db),
      reproSpecDir,
      judgeClientFactory: throwingJudgeClient,
      allowedDomains: ["mock.local"],
      prodUrlPatterns: [],
      corsOrigins: ["http://localhost:5173"],
      installRoutes: (context) => installMockTarget(context, "baseline", seedFor()),
    };
    app = buildApp(deps);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await closeMongo(connection);
    await mongod.stop();
  });

  it("rejects an invalid POST /runs body with structured JSON, not a stack trace", async () => {
    const response = await app.inject({ method: "POST", url: "/runs", payload: { charter: "x" } });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: string }>();
    expect(body.error).toBeTruthy();
    expect(body).not.toHaveProperty("stack");
  });

  it("POST /runs returns immediately and the run completes in the background; GET reflects the transition", async () => {
    const postResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { charter: "test the locations flow", targetBaseUrl: MOCK_BASE_URL },
    });
    expect(postResponse.statusCode).toBe(202);
    const { runId, status } = postResponse.json<RunResponseBody>();
    expect(["PENDING", "RUNNING"]).toContain(status);

    await waitUntil(async () => {
      const getResponse = await app.inject({ method: "GET", url: `/runs/${runId}` });
      return getResponse.json<{ status: string }>().status === "COMPLETED";
    });

    const findingsResponse = await app.inject({ method: "GET", url: `/runs/${runId}/findings` });
    expect(findingsResponse.statusCode).toBe(200);

    const listResponse = await app.inject({ method: "GET", url: "/runs" });
    const runs = listResponse.json<{ id: string }[]>();
    expect(runs.some((run) => run.id === runId)).toBe(true);
  }, 30_000);

  it("GET /runs/:id 404s for an unknown run", async () => {
    const response = await app.inject({ method: "GET", url: `/runs/${randomUUID()}` });
    expect(response.statusCode).toBe(404);
  });

  it("GET /findings/:id/repro 404s when no repro spec exists for the finding", async () => {
    const response = await app.inject({ method: "GET", url: `/findings/${randomUUID()}/repro` });
    expect(response.statusCode).toBe(404);
  });

  /** safety-spec §7/§9 — CORS is pinned to `corsOrigins`; `origin: true` (reflect
   * any origin) must not ship. */
  describe("CORS (safety-spec §7)", () => {
    it("reflects the configured origin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { origin: "http://localhost:5173" },
      });
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    });

    it("does not reflect a disallowed origin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { origin: "http://evil.example" },
      });
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});
