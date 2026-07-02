import type { Run } from "@ui-rabbit/shared";

export function StatusBadge({ status }: { status: Run["status"] }) {
  return <span className={`status-badge status-badge--${status.toLowerCase()}`}>{status}</span>;
}
