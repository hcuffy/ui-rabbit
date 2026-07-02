import type { Finding } from "@ui-rabbit/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FindingCard } from "./FindingCard.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("FindingCard (frontend-spec §5)", () => {
  it("renders type/verdict/severity/confidence/reasoning", () => {
    render(
      <ul>
        <FindingCard finding={makeFinding()} />
      </ul>,
    );

    expect(screen.getByText("STATE_DIVERGENCE")).toBeInTheDocument();
    expect(screen.getByText("REGRESSION")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("confidence 90%")).toBeInTheDocument();
    expect(screen.getByText("button removed")).toBeInTheDocument();
  });

  it("shows a download-repro link only when reproSpecPath is present", () => {
    const { rerender } = render(
      <ul>
        <FindingCard finding={makeFinding({ reproSpecPath: undefined })} />
      </ul>,
    );
    expect(screen.queryByText("Download repro")).not.toBeInTheDocument();

    rerender(
      <ul>
        <FindingCard finding={makeFinding({ reproSpecPath: "/tmp/repro-specs/x.spec.ts" })} />
      </ul>,
    );
    const link = screen.getByText("Download repro");
    expect(link).toHaveAttribute("href", expect.stringContaining("/findings/11111111-1111-1111-1111-111111111111/repro"));
  });
});
