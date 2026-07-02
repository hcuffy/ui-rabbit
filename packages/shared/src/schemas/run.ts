import { z } from "zod";

export const RunSchema = z.object({
  id: z.string().uuid(),
  charter: z.string(),
  targetBaseUrl: z.string().url(),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]),
  startedAt: z.date(),
  finishedAt: z.date().optional(),
  stepsUsed: z.number().int().min(0),
  llmCallsUsed: z.number().int().min(0),
  costUsd: z.number().min(0),
  error: z.string().optional(),
});

export type Run = z.infer<typeof RunSchema>;
