import { useState, type FormEvent } from "react";
import { CreateRunInputSchema } from "../lib/apiClient.js";
import { useCreateRun } from "../lib/queries.js";

export function NewRunForm({ onCreated }: { onCreated: (runId: string) => void }) {
  const [charter, setCharter] = useState("");
  const [targetBaseUrl, setTargetBaseUrl] = useState("");
  const [validationError, setValidationError] = useState<string | undefined>(undefined);
  const mutation = useCreateRun();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = CreateRunInputSchema.safeParse({ charter, targetBaseUrl });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    setValidationError(undefined);
    mutation.mutate(parsed.data, {
      onSuccess: (response) => onCreated(response.runId),
    });
  }

  return (
    <form className="new-run-form" onSubmit={handleSubmit}>
      <h2>New run</h2>
      <label htmlFor="charter">Charter</label>
      <textarea
        id="charter"
        value={charter}
        onChange={(event) => setCharter(event.target.value)}
        placeholder="test the locations flow"
        rows={3}
      />
      <label htmlFor="targetBaseUrl">Target base URL</label>
      <input
        id="targetBaseUrl"
        type="text"
        value={targetBaseUrl}
        onChange={(event) => setTargetBaseUrl(event.target.value)}
        placeholder="https://dev.rabbit.example"
      />
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Starting…" : "Run"}
      </button>
      {validationError && (
        <p className="form-error" role="alert">
          {validationError}
        </p>
      )}
      {mutation.isError && (
        <p className="form-error" role="alert">
          {mutation.error.message}
        </p>
      )}
    </form>
  );
}
