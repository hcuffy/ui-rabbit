import { z } from "zod";

export const FindingSchema = z.object({
  id: z.string().uuid(),
  runId: z.string(),
  screenId: z.string(),
  type: z.enum(["CONSOLE_ERROR", "HTTP_ERROR", "BLANK_SCREEN", "STATE_DIVERGENCE", "VISUAL", "OTHER"]),
  verdict: z.enum(["REGRESSION", "INTENDED_CHANGE", "NEEDS_HUMAN", "KNOWN"]).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  reasoning: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.object({
    ariaSnapshot: z.string().optional(),
    consoleMessages: z.array(z.string()).optional(),
    networkErrors: z
      .array(z.object({ method: z.string().optional(), url: z.string(), status: z.number() }))
      .optional(),
  }),
  dedupKey: z.string(),
  status: z.enum(["NEW", "RECURRING", "RESOLVED"]),
  /** D4 additive field (backend-spec §4.6/§9.3): disk path to a generated repro
   * `.spec.ts`. Originally gated on STATE_DIVERGENCE+NEW (driver-spec §5, while
   * D2/D3's mock judge always returned NEEDS_HUMAN); flipped at D5/D7 to
   * `verdict === "REGRESSION"` (judge-spec §9) now that the real judge produces
   * real verdicts — see `orchestrator.ts`/`cli.ts`. */
  reproSpecPath: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Finding = z.infer<typeof FindingSchema>;
