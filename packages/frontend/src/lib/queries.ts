import type { Run } from "@ui-rabbit/shared";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  createRun,
  getRun,
  listRunFindings,
  listRuns,
  type CreateRunInput,
  type CreateRunResponse,
} from "./apiClient.js";

/** frontend-spec §4 — 2s poll, terminal-aware (proposed default, §7.2). */
const POLL_INTERVAL_MS = 2000;

export function isTerminalStatus(status: Run["status"] | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

export function useRunsList() {
  return useQuery({ queryKey: ["runs"], queryFn: listRuns });
}

/** v5 signature: the callback takes `(query)`, not `(data, query)` (frontend-spec §4). */
export function useRun(id: string | undefined): UseQueryResult<Run> {
  return useQuery({
    queryKey: ["run", id],
    queryFn: () => getRun(id as string),
    enabled: id !== undefined,
    refetchInterval: (query) => (isTerminalStatus(query.state.data?.status) ? false : POLL_INTERVAL_MS),
  });
}

/** Findings carry no run status of their own — share the run's terminal-ness via
 * `runStatus`, passed in by the caller (which already holds it from `useRun`). */
export function useRunFindings(id: string | undefined, runStatus: Run["status"] | undefined) {
  return useQuery({
    queryKey: ["findings", id],
    queryFn: () => listRunFindings(id as string),
    enabled: id !== undefined,
    refetchInterval: () => (isTerminalStatus(runStatus) ? false : POLL_INTERVAL_MS),
  });
}

export function useCreateRun() {
  const queryClient = useQueryClient();
  return useMutation<CreateRunResponse, Error, CreateRunInput>({
    mutationFn: createRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}
