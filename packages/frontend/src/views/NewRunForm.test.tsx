import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewRunForm } from "./NewRunForm.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("NewRunForm (frontend-spec §5)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits the form, POSTs /runs, and calls onCreated with the new run id", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "run-123", status: "PENDING" }, 202));
    const onCreated = vi.fn();
    const user = userEvent.setup();

    renderWithClient(<NewRunForm onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Charter"), "test the locations flow");
    await user.type(screen.getByLabelText("Target base URL"), "https://dev.rabbit.example");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByRole("button", { name: "Run" })).toBeEnabled();
    expect(onCreated).toHaveBeenCalledWith("run-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/runs");
    expect(init.method).toBe("POST");
  });

  it("shows a validation error and never calls fetch when targetBaseUrl is invalid", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const user = userEvent.setup();

    renderWithClient(<NewRunForm onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Charter"), "test the locations flow");
    await user.type(screen.getByLabelText("Target base URL"), "not-a-url");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/valid URL/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
