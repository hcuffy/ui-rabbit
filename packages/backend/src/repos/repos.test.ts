import type { AppMap, Baseline, Finding, Run } from "@ui-rabbit/shared";
import { randomUUID } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeMongo, connectMongo, type MongoConnection } from "../db/connection.js";
import { AppMapRepo } from "./appMapRepo.js";
import { BaselineRepo } from "./baselineRepo.js";
import { FindingRepo } from "./findingRepo.js";
import { RunRepo } from "./runRepo.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    charter: "test the locations flow",
    targetBaseUrl: "http://mock.local",
    status: "PENDING",
    startedAt: new Date(),
    stepsUsed: 0,
    llmCallsUsed: 0,
    costUsd: 0,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const now = new Date();
  return {
    id: randomUUID(),
    runId: "run-1",
    screenId: "screen-1",
    type: "CONSOLE_ERROR",
    evidence: { consoleMessages: ["boom"] },
    dedupKey: "dedup-1",
    status: "NEW",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    screenId: "screen-1",
    fingerprint: "fp-1",
    ariaSnapshotMasked: '- heading "Locations"',
    capturedAt: new Date(),
    runId: "run-1",
    ...overrides,
  };
}

function makeAppMap(overrides: Partial<AppMap> = {}): AppMap {
  return { id: randomUUID(), baseUrl: "http://mock.local", screens: [], ...overrides };
}

describe("Mongo repositories (backend-spec §3/§7) — mongodb-memory-server, no Docker", () => {
  let mongod: MongoMemoryServer;
  let connection: MongoConnection;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await connectMongo(mongod.getUri());
  });

  afterAll(async () => {
    await closeMongo(connection);
    await mongod.stop();
  });

  describe("RunRepo", () => {
    it("round-trips a created run, validated against RunSchema", async () => {
      const repo = new RunRepo(connection.db);
      const run = makeRun();
      await repo.create(run);
      expect(await repo.get(run.id)).toEqual(run);
    });

    it("updateStatus patches only the given fields and survives a re-read", async () => {
      const repo = new RunRepo(connection.db);
      const run = makeRun();
      await repo.create(run);

      const finishedAt = new Date();
      await repo.updateStatus(run.id, { status: "COMPLETED", finishedAt, stepsUsed: 4 });

      const fetched = await repo.get(run.id);
      expect(fetched?.status).toBe("COMPLETED");
      expect(fetched?.stepsUsed).toBe(4);
      expect(fetched?.finishedAt).toEqual(finishedAt);
      expect(fetched?.charter).toBe(run.charter);
    });

    it("list returns newest-first", async () => {
      const repo = new RunRepo(connection.db);
      const older = makeRun({ startedAt: new Date(Date.now() - 60_000) });
      const newer = makeRun({ startedAt: new Date() });
      await repo.create(older);
      await repo.create(newer);

      const ids = (await repo.list()).map((run) => run.id);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    });
  });

  describe("FindingRepo", () => {
    it("round-trips an upserted finding, validated against FindingSchema", async () => {
      const repo = new FindingRepo(connection.db);
      const finding = makeFinding();
      await repo.upsert(finding);
      expect(await repo.get(finding.id)).toEqual(finding);
    });

    it("upsert by dedupKey replaces the prior doc rather than duplicating it", async () => {
      const repo = new FindingRepo(connection.db);
      const finding = makeFinding({ dedupKey: "dedup-shared" });
      await repo.upsert(finding);

      const recurring: Finding = { ...finding, status: "RECURRING", verdict: "KNOWN", updatedAt: new Date() };
      await repo.upsert(recurring);

      const byDedup = await repo.findByDedupKeys(["dedup-shared"]);
      expect(byDedup).toHaveLength(1);
      expect(byDedup[0]?.status).toBe("RECURRING");
    });

    it("findByScreenIds and listByRun scope correctly", async () => {
      const repo = new FindingRepo(connection.db);
      const a = makeFinding({ dedupKey: "a", screenId: "screen-a", runId: "run-x" });
      const b = makeFinding({ dedupKey: "b", screenId: "screen-b", runId: "run-x" });
      await repo.upsert(a);
      await repo.upsert(b);

      expect((await repo.findByScreenIds(["screen-a"])).map((f) => f.dedupKey)).toEqual(["a"]);
      expect(await repo.listByRun("run-x")).toHaveLength(2);
    });
  });

  describe("BaselineRepo", () => {
    it("round-trips an upserted baseline, keyed by screenId", async () => {
      const repo = new BaselineRepo(connection.db);
      const baseline = makeBaseline({ screenId: "screen-roundtrip" });
      await repo.upsert(baseline);

      const [fetched] = await repo.getByScreenIds([baseline.screenId]);
      expect(fetched).toEqual(baseline);
    });

    it("upsert replaces the existing baseline for a screenId rather than duplicating", async () => {
      const repo = new BaselineRepo(connection.db);
      const baseline = makeBaseline({ screenId: "screen-replace" });
      await repo.upsert(baseline);
      await repo.upsert({ ...baseline, fingerprint: "fp-2" });

      const matches = await repo.getByScreenIds(["screen-replace"]);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.fingerprint).toBe("fp-2");
    });
  });

  describe("AppMapRepo", () => {
    it("round-trips an upserted AppMap", async () => {
      const repo = new AppMapRepo(connection.db);
      const appMap = makeAppMap({
        screens: [{ screenId: "s1", normalizedUrl: "http://mock.local/x", headingAnchor: "X", discoveredAt: new Date() }],
      });
      await repo.upsert(appMap);
      expect(await repo.get()).toEqual(appMap);
    });
  });
});
