import { useState } from "react";
import { NewRunForm } from "./views/NewRunForm.js";
import { RunDetail } from "./views/RunDetail.js";
import { RunHistory } from "./views/RunHistory.js";

export function App() {
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);

  return (
    <main>
      <h1>UI-Rabbit</h1>
      <NewRunForm onCreated={setSelectedRunId} />
      <h2>Run history</h2>
      <RunHistory selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
      {selectedRunId && <RunDetail runId={selectedRunId} />}
    </main>
  );
}
