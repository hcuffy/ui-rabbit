import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { buildApp } from "./app.js";
import { closeMongo, connectMongo } from "./db/connection.js";
import { AppMapRepo } from "./repos/appMapRepo.js";
import { BaselineRepo } from "./repos/baselineRepo.js";
import { FindingRepo } from "./repos/findingRepo.js";
import { RunRepo } from "./repos/runRepo.js";
import { waitForInFlightRuns } from "./orchestrator.js";
import { parseAllowedDomains, parseProdUrlPatterns } from "./safety.js";
import type { LoginCreds } from "@ui-rabbit/driver";

/** audit #8 — bounded wait on shutdown so a SIGTERM can't strand a run as
 * RUNNING forever (its own FAILED-write would itself fail against an already-
 * closed Mongo client). Not unlimited: a wedged run still lets the process exit. */
const SHUTDOWN_RUN_DRAIN_TIMEOUT_MS = 10_000;

/** auto-login-spec §1 — all 6 vars required; any absent → undefined (no auto-login). */
function parseLoginCreds(env: NodeJS.ProcessEnv): LoginCreds | undefined {
  const { TARGET_LOGIN_URL, TARGET_EMAIL, TARGET_PASSWORD,
          TARGET_EMAIL_SELECTOR, TARGET_PASSWORD_SELECTOR, TARGET_SUBMIT_SELECTOR,
          TARGET_NEXT_SELECTOR } = env;
  if (!TARGET_LOGIN_URL || !TARGET_EMAIL || !TARGET_PASSWORD ||
      !TARGET_EMAIL_SELECTOR || !TARGET_PASSWORD_SELECTOR || !TARGET_SUBMIT_SELECTOR) {
    return undefined;
  }
  return {
    loginUrl: TARGET_LOGIN_URL,
    email: TARGET_EMAIL,
    password: TARGET_PASSWORD,
    emailSelector: TARGET_EMAIL_SELECTOR,
    passwordSelector: TARGET_PASSWORD_SELECTOR,
    submitSelector: TARGET_SUBMIT_SELECTOR,
    nextSelector: TARGET_NEXT_SELECTOR || undefined,
  };
}

function parseCorsOrigins(envValue: string | undefined): string[] {
  return (envValue ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGO_URI ?? "mongodb://localhost:27017/uirabbit";
  const port = Number(process.env.PORT ?? 8000);
  const reproSpecDir = process.env.REPRO_SPEC_DIR ?? "./repro-specs";
  const maxLlmCalls = Number(process.env.MAX_LLM_CALLS ?? 25);
  const maxUsdPerRun = Number(process.env.MAX_USD_PER_RUN ?? 1.0);
  const maxSteps = Number(process.env.MAX_STEPS ?? 40);
  // auto-login-spec §1/§3 — takes precedence over storageState when all 6 vars set.
  const loginCreds = parseLoginCreds(process.env);
  // driver-spec §7 fallback auth seam — used only when loginCreds is absent.
  const storageState = process.env.STORAGE_STATE_PATH || undefined;
  // safety-spec §3/§4/§7
  const allowedDomains = parseAllowedDomains(process.env.ALLOWED_DOMAINS);
  const prodUrlPatterns = parseProdUrlPatterns(process.env.PROD_URL_PATTERNS);
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN ?? "http://localhost:5173");

  const connection = await connectMongo(mongoUri);

  const runRepo = new RunRepo(connection.db);
  const findingRepo = new FindingRepo(connection.db);
  const baselineRepo = new BaselineRepo(connection.db);
  const appMapRepo = new AppMapRepo(connection.db);
  await runRepo.ensureIndexes();
  await findingRepo.ensureIndexes();

  // judge-spec §4 — lazy: `new Anthropic()` (needs ANTHROPIC_API_KEY) only runs
  // on the first real judge use; a run with no divergences never needs a key.
  let judgeClient: Anthropic | undefined;
  const judgeClientFactory = (): Anthropic => (judgeClient ??= new Anthropic());

  const app = buildApp({
    runRepo,
    findingRepo,
    baselineRepo,
    appMapRepo,
    reproSpecDir,
    judgeClientFactory,
    maxLlmCalls,
    maxUsdPerRun,
    maxSteps,
    loginCreds,
    storageState,
    allowedDomains,
    prodUrlPatterns,
    corsOrigins,
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await waitForInFlightRuns(SHUTDOWN_RUN_DRAIN_TIMEOUT_MS);
    await closeMongo(connection);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ port, host: "0.0.0.0" });
}

await main();
