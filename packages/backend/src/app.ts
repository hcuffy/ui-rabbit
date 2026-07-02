import cors from "@fastify/cors";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { startRun, type OrchestratorDeps } from "./orchestrator.js";

/** safety-spec §7 — pins D6's temporary `origin: true` to an explicit allowlist.
 * `corsOrigins` is the only addition over `OrchestratorDeps`: CORS is an HTTP-layer
 * concern the orchestrator itself never needs. */
export type AppDeps = OrchestratorDeps & { corsOrigins: string[] };

const CreateRunBodySchema = z.object({
  charter: z.string(),
  targetBaseUrl: z.string().url(),
});

/** backend-spec §5. MVP polls — no WebSocket. All bodies/params validated; errors come
 * back as structured JSON (§5 "not stack traces"), never a raw 500 with a stack trace. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();

  // safety-spec §7 — only the configured origin(s) are reflected; `origin: true`
  // (reflect any origin) must not ship. An empty list means no origin is ever
  // reflected (fail-closed), matching the allowlist's own posture.
  app.register(cors, { origin: deps.corsOrigins });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply.status(500).send({ error: "internal server error" });
  });

  app.post("/runs", async (request, reply) => {
    const parsed = CreateRunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid request body", details: parsed.error.flatten() });
    }

    const run = await startRun(parsed.data, deps);
    return reply.status(202).send({ runId: run.id, status: run.status });
  });

  app.get("/runs", async () => deps.runRepo.list());

  app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const run = await deps.runRepo.get(request.params.id);
    if (!run) return reply.status(404).send({ error: "run not found" });
    return run;
  });

  app.get<{ Params: { id: string } }>("/runs/:id/findings", async (request) =>
    deps.findingRepo.listByRun(request.params.id),
  );

  app.get<{ Params: { id: string } }>("/findings/:id", async (request, reply) => {
    const finding = await deps.findingRepo.get(request.params.id);
    if (!finding) return reply.status(404).send({ error: "finding not found" });
    return finding;
  });

  app.get<{ Params: { id: string } }>("/findings/:id/repro", async (request, reply) => {
    const finding = await deps.findingRepo.get(request.params.id);
    if (!finding?.reproSpecPath) return reply.status(404).send({ error: "no repro spec for this finding" });

    const content = await readFile(finding.reproSpecPath, "utf8");
    return reply.type("application/typescript").send(content);
  });

  return app;
}
