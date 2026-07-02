import { FindingSchema, RunSchema, type Finding, type Run } from "@ui-rabbit/shared";
import { z } from "zod";

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `request failed with status ${response.status}`, response.status);
  }
  return response;
}

/** `Run`/`Finding` declare their timestamp fields as `z.date()` — correct for the
 * backend, where Mongo returns real `Date` instances. Over HTTP, `JSON.stringify`
 * turns every `Date` into an ISO string, so the shared schema can't parse a raw
 * fetch response as-is. Revive the known date fields to `Date` before validating —
 * this is a JSON-serialization gap, not frontend/backend drift, so it's handled
 * here rather than weakened in the shared schema itself. */
function reviveDates<T extends Record<string, unknown>>(raw: T, dateKeys: readonly string[]): T {
  const revived: Record<string, unknown> = { ...raw };
  for (const key of dateKeys) {
    const value = revived[key];
    if (typeof value === "string") revived[key] = new Date(value);
  }
  return revived as T;
}

const RUN_DATE_KEYS = ["startedAt", "finishedAt"] as const;
const FINDING_DATE_KEYS = ["createdAt", "updatedAt"] as const;

function parseRun(raw: unknown): Run {
  return RunSchema.parse(reviveDates(raw as Record<string, unknown>, RUN_DATE_KEYS));
}

function parseFinding(raw: unknown): Finding {
  return FindingSchema.parse(reviveDates(raw as Record<string, unknown>, FINDING_DATE_KEYS));
}

/** D4's `POST /runs` response is `{ runId, status }` — not a full `Run` (backend-spec
 * §5), and not exported from `shared` (it's a one-off wire shape for this endpoint,
 * not one of the four named schemas). Validating it here, not forking `Run`. */
const CreateRunResponseSchema = z.object({ runId: z.string(), status: z.string() });
export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;

/** Mirrors `CreateRunBodySchema` in `packages/backend/src/app.ts`, which isn't
 * exported from `shared` either (request-only shape). Client-side validation here
 * is a UX nicety (fail before the round trip), not a contract duplication of
 * Run/Finding/AppMap/Baseline. */
export const CreateRunInputSchema = z.object({
  charter: z.string().trim().min(1, "Charter is required."),
  targetBaseUrl: z.string().trim().url("Target base URL must be a valid URL."),
});
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;

export async function createRun(input: CreateRunInput): Promise<CreateRunResponse> {
  const parsedInput = CreateRunInputSchema.parse(input);
  const response = await request("/runs", { method: "POST", body: JSON.stringify(parsedInput) });
  return CreateRunResponseSchema.parse(await response.json());
}

export async function listRuns(): Promise<Run[]> {
  const response = await request("/runs");
  const body = (await response.json()) as unknown[];
  return body.map(parseRun);
}

export async function getRun(id: string): Promise<Run> {
  const response = await request(`/runs/${id}`);
  return parseRun(await response.json());
}

export async function listRunFindings(id: string): Promise<Finding[]> {
  const response = await request(`/runs/${id}/findings`);
  const body = (await response.json()) as unknown[];
  return body.map(parseFinding);
}

export async function getFinding(id: string): Promise<Finding> {
  const response = await request(`/findings/${id}`);
  return parseFinding(await response.json());
}

/** `GET /findings/:id/repro` returns the repro `.spec.ts` file content directly
 * (not JSON) — a plain link is enough, no fetch/blob plumbing needed. */
export function reproDownloadUrl(findingId: string): string {
  return `${API_BASE_URL}/findings/${findingId}/repro`;
}
