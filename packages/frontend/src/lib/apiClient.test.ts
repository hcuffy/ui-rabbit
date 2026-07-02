import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createRun, getFinding, getRun, listRunFindings, listRuns, reproDownloadUrl } from "./apiClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("apiClient (frontend-spec §3)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createRun posts to /runs and parses { runId, status }", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "run-1", status: "PENDING" }, 202));

    const result = await createRun({ charter: "test the locations flow", targetBaseUrl: "https://dev.example" });

    expect(result).toEqual({ runId: "run-1", status: "PENDING" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/runs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      charter: "test the locations flow",
      targetBaseUrl: "https://dev.example",
    });
  });

  it("createRun rejects an invalid targetBaseUrl before making any request", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(createRun({ charter: "x", targetBaseUrl: "not-a-url" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("listRuns parses an array of Run, reviving date fields", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          charter: "test the locations flow",
          targetBaseUrl: "https://dev.example",
          status: "COMPLETED",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
          stepsUsed: 2,
          llmCallsUsed: 0,
          costUsd: 0,
        },
      ]),
    );

    const runs = await listRuns();

    expect(runs).toHaveLength(1);
    expect(runs[0]?.startedAt).toBeInstanceOf(Date);
    expect(runs[0]?.startedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("getRun throws ApiError with the backend's error message on a non-OK response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ error: "run not found" }, 404));

    await expect(getRun("missing")).rejects.toThrow("run not found");
    await expect(getRun("missing")).rejects.toBeInstanceOf(ApiError);
  });

  it("listRunFindings parses an array of Finding, reviving date fields", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "11111111-1111-1111-1111-111111111111",
          runId: "run-1",
          screenId: "screen-1",
          type: "CONSOLE_ERROR",
          evidence: { consoleMessages: ["boom"] },
          dedupKey: "dedup-1",
          status: "NEW",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );

    const findings = await listRunFindings("run-1");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("getFinding parses a single Finding", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "11111111-1111-1111-1111-111111111111",
        runId: "run-1",
        screenId: "screen-1",
        type: "STATE_DIVERGENCE",
        verdict: "REGRESSION",
        severity: "HIGH",
        reasoning: "button removed",
        confidence: 0.9,
        evidence: { ariaSnapshot: '- heading "Locations"' },
        dedupKey: "dedup-1",
        status: "NEW",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const finding = await getFinding("11111111-1111-1111-1111-111111111111");
    expect(finding.verdict).toBe("REGRESSION");
  });

  it("reproDownloadUrl builds the repro endpoint URL", () => {
    expect(reproDownloadUrl("finding-1")).toContain("/findings/finding-1/repro");
  });
});
