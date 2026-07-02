import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunDetail } from "./RunDetail.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const RUN_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

function makeRun(status: "RUNNING" | "COMPLETED") {
  return {
    id: RUN_ID,
    charter: "test the locations flow",
    targetBaseUrl: "https://dev.example",
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    stepsUsed: 1,
    llmCallsUsed: 0,
    costUsd: 0,
  };
}

/** frontend-spec §4/§6 — a RUNNING run polls every 2s; a terminal run stops.
 * Real timers (not fake) — fake timers interact poorly with RTL's `findBy*` +
 * TanStack Query's internal scheduling; a real ~2.1s wait is slower but reliable. */
describe("RunDetail polling (frontend-spec §4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "polls a RUNNING run every 2s and stops once it goes COMPLETED",
    async () => {
      let runCallCount = 0;
      const fetchMock = vi.fn((url: string) => {
        if (url.includes("/findings")) return Promise.resolve(jsonResponse([]));
        runCallCount += 1;
        return Promise.resolve(jsonResponse(makeRun(runCallCount === 1 ? "RUNNING" : "COMPLETED")));
      });
      vi.stubGlobal("fetch", fetchMock);

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <RunDetail runId={RUN_ID} />
        </QueryClientProvider>,
      );

      expect(await screen.findByText("RUNNING")).toBeInTheDocument();
      expect(runCallCount).toBe(1);

      expect(await screen.findByText("COMPLETED", {}, { timeout: 4000 })).toBeInTheDocument();
      expect(runCallCount).toBe(2);

      // Past another full interval — a terminal run must not poll again.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect(runCallCount).toBe(2);
    },
    10_000,
  );
});
