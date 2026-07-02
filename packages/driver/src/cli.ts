import Anthropic from "@anthropic-ai/sdk";
import { deriveScreenId, runEngineLoop } from "@ui-rabbit/engine";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { explore } from "./explore.js";
import { applyEngineOutput, loadLocalStore, saveLocalStore } from "./localStore.js";
import type { MockSeed, MockVariant } from "./mock/pages.js";
import { installMockTarget } from "./mock/routes.js";
import { generateReproSpec } from "./reproSpec.js";

const MOCK_BASE_URL = "http://mock.local";

function buildSeed(): MockSeed {
  return { recordId: randomUUID(), timestamp: new Date().toISOString(), count: 12 };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      charter: { type: "string" },
      run: { type: "string" },
      variant: { type: "string", default: "baseline" },
      state: { type: "string", default: ".ui-rabbit/driver-state.json" },
      out: { type: "string", default: "./repro-specs" },
    },
  });

  if (!values.charter || !values.run) {
    throw new Error(
      'usage: explore --charter "test the locations flow" --run <run-id> ' +
        "[--variant baseline|volatile-only|changed-regression] [--state path] [--out dir]",
    );
  }
  const charter = values.charter;
  const runId = values.run;
  const variant = values.variant as MockVariant;
  const statePath = values.state;
  const outDir = values.out;
  const seed = buildSeed();

  // judge-spec §10/§4 — lazy factory: `new Anthropic()` (needs ANTHROPIC_API_KEY)
  // only runs on the first real divergence; a clean mock demo never needs a key.
  let judgeClient: Anthropic | undefined;
  const judgeClientFactory = (): Anthropic => (judgeClient ??= new Anthropic());
  const maxLlmCalls = Number(process.env.MAX_LLM_CALLS ?? 25);
  const maxUsdPerRun = Number(process.env.MAX_USD_PER_RUN ?? 1.0);

  const browser = await chromium.launch();
  try {
    const store = await loadLocalStore(statePath);

    const observations = await explore({
      charter,
      baseUrl: MOCK_BASE_URL,
      browser,
      installRoutes: (context) => installMockTarget(context, variant, seed),
    });

    const output = await runEngineLoop({
      runId,
      charter,
      observations,
      existingBaselines: store.baselines,
      existingFindings: store.findings,
      judge: { clientFactory: judgeClientFactory },
      maxLlmCalls,
      maxUsdPerRun,
    });

    const urlByScreenId = new Map(
      observations.map((observation) => [deriveScreenId(observation).screenId, observation.url]),
    );

    const reproSpecPaths: string[] = [];
    for (const finding of output.findings) {
      // judge-spec §9 — gate flipped from STATE_DIVERGENCE+NEW to a confirmed
      // REGRESSION verdict now that the real judge produces real verdicts.
      if (finding.verdict !== "REGRESSION") continue;
      const url = urlByScreenId.get(finding.screenId);
      if (!url) continue;

      await mkdir(outDir, { recursive: true });
      const specPath = join(outDir, `${finding.id}.spec.ts`);
      await writeFile(specPath, generateReproSpec({ finding, url }), "utf8");
      reproSpecPaths.push(specPath);
    }

    await saveLocalStore(statePath, applyEngineOutput(store, output));

    console.log(JSON.stringify({ newBaselines: output.baselines.length, findings: output.findings, reproSpecPaths }, null, 2));
  } finally {
    await browser.close();
  }
}

await main();
