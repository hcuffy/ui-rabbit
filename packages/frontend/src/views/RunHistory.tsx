import { StatusBadge } from "../components/StatusBadge.js";
import { useRunsList } from "../lib/queries.js";

export function RunHistory({
  selectedRunId,
  onSelect,
}: {
  selectedRunId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const { data, isPending, isError, error } = useRunsList();

  if (isPending) return <p>Loading run history…</p>;
  if (isError)
    return (
      <p className="form-error" role="alert">
        Failed to load runs: {error.message}
      </p>
    );
  if (data.length === 0) return <p>No runs yet — start one above.</p>;

  const sorted = [...data].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  return (
    <table className="run-history">
      <thead>
        <tr>
          <th>Charter</th>
          <th>Status</th>
          <th>Started</th>
          <th>Steps</th>
          <th>LLM calls</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((run) => (
          <tr
            key={run.id}
            className={run.id === selectedRunId ? "run-history__row--selected" : undefined}
            onClick={() => onSelect(run.id)}
          >
            <td>{run.charter}</td>
            <td>
              <StatusBadge status={run.status} />
            </td>
            <td>{run.startedAt.toLocaleString()}</td>
            <td>{run.stepsUsed}</td>
            <td>{run.llmCallsUsed}</td>
            <td>${run.costUsd.toFixed(4)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
