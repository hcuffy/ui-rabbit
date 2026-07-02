import { FindingCard } from "../components/FindingCard.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { useRun, useRunFindings } from "../lib/queries.js";

export function RunDetail({ runId }: { runId: string }) {
  const runQuery = useRun(runId);
  const findingsQuery = useRunFindings(runId, runQuery.data?.status);

  if (runQuery.isPending) return <p>Loading run…</p>;
  if (runQuery.isError)
    return (
      <p className="form-error" role="alert">
        Failed to load run: {runQuery.error.message}
      </p>
    );

  const run = runQuery.data;

  return (
    <section className="run-detail">
      <h2>Run detail</h2>
      <p>
        <StatusBadge status={run.status} /> — {run.charter}
      </p>
      <p>Target: {run.targetBaseUrl}</p>
      <p>
        Steps: {run.stepsUsed} · LLM calls: {run.llmCallsUsed} · Cost: ${run.costUsd.toFixed(4)}
      </p>
      {run.error && (
        <p className="form-error" role="alert">
          Error: {run.error}
        </p>
      )}

      <h3>Findings</h3>
      {findingsQuery.isPending && <p>Loading findings…</p>}
      {findingsQuery.isError && (
        <p className="form-error" role="alert">
          Failed to load findings: {findingsQuery.error.message}
        </p>
      )}
      {findingsQuery.data && findingsQuery.data.length === 0 && <p>No findings yet.</p>}
      {findingsQuery.data && findingsQuery.data.length > 0 && (
        <ul className="finding-list">
          {findingsQuery.data.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </ul>
      )}
    </section>
  );
}
