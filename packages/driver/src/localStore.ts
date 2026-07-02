import type { EngineLoopOutput } from "@ui-rabbit/engine";
import type { Baseline, Finding } from "@ui-rabbit/shared";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** CLI/test-only convenience persistence — NOT product persistence (Mongo is D4's
 * job). A thin merge helper over plain arrays so two `explore` invocations (or the §8
 * three-run slice) can carry state between runs without a database. */
export interface LocalStore {
  baselines: Baseline[];
  findings: Finding[];
}

export function emptyLocalStore(): LocalStore {
  return { baselines: [], findings: [] };
}

/** Appends net-new baselines (runEngineLoop never re-emits one for an already-known
 * screen) and upserts findings by `dedupKey` so a RECURRING/RESOLVED update replaces
 * the prior record rather than duplicating it. */
export function applyEngineOutput(store: LocalStore, output: EngineLoopOutput): LocalStore {
  const findingsByDedupKey = new Map(store.findings.map((finding) => [finding.dedupKey, finding]));
  for (const finding of output.findings) {
    findingsByDedupKey.set(finding.dedupKey, finding);
  }

  return {
    baselines: [...store.baselines, ...output.baselines],
    findings: [...findingsByDedupKey.values()],
  };
}

interface SerializedStore {
  baselines: (Omit<Baseline, "capturedAt"> & { capturedAt: string })[];
  findings: (Omit<Finding, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string })[];
}

export async function loadLocalStore(path: string): Promise<LocalStore> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLocalStore();
    throw error;
  }

  const parsed = JSON.parse(raw) as SerializedStore;
  return {
    baselines: parsed.baselines.map((baseline) => ({ ...baseline, capturedAt: new Date(baseline.capturedAt) })),
    findings: parsed.findings.map((finding) => ({
      ...finding,
      createdAt: new Date(finding.createdAt),
      updatedAt: new Date(finding.updatedAt),
    })),
  };
}

export async function saveLocalStore(path: string, store: LocalStore): Promise<void> {
  const serialized: SerializedStore = {
    baselines: store.baselines.map((baseline) => ({ ...baseline, capturedAt: baseline.capturedAt.toISOString() })),
    findings: store.findings.map((finding) => ({
      ...finding,
      createdAt: finding.createdAt.toISOString(),
      updatedAt: finding.updatedAt.toISOString(),
    })),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(serialized, null, 2), "utf8");
}
