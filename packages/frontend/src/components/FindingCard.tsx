import type { Finding } from "@ui-rabbit/shared";
import { reproDownloadUrl } from "../lib/apiClient.js";

function evidenceSummary(finding: Finding): string {
  const { evidence } = finding;
  const parts: string[] = [];
  if (evidence.consoleMessages && evidence.consoleMessages.length > 0) {
    parts.push(`${evidence.consoleMessages.length} console message(s)`);
  }
  if (evidence.networkErrors && evidence.networkErrors.length > 0) {
    parts.push(`${evidence.networkErrors.length} network error(s)`);
  }
  if (evidence.ariaSnapshot) {
    const firstLine = evidence.ariaSnapshot.split("\n")[0] ?? "";
    parts.push(`aria: ${firstLine}`);
  }
  return parts.length > 0 ? parts.join(", ") : "No evidence recorded.";
}

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <li className="finding-card">
      <div className="finding-card__header">
        <span className="finding-card__type">{finding.type}</span>
        {finding.verdict && (
          <span className={`finding-card__verdict finding-card__verdict--${finding.verdict.toLowerCase()}`}>
            {finding.verdict}
          </span>
        )}
        {finding.severity && <span className="finding-card__severity">{finding.severity}</span>}
        {finding.confidence !== undefined && (
          <span className="finding-card__confidence">confidence {Math.round(finding.confidence * 100)}%</span>
        )}
      </div>
      {finding.reasoning && <p className="finding-card__reasoning">{finding.reasoning}</p>}
      <p className="finding-card__evidence">{evidenceSummary(finding)}</p>
      {finding.reproSpecPath && (
        <a className="finding-card__repro-link" href={reproDownloadUrl(finding.id)} download>
          Download repro
        </a>
      )}
    </li>
  );
}
