import { createHash } from "node:crypto";
import type { FindingDraft } from "./types.js";

/** Algorithm C.1 (engine-spec §5): dedupKey = hash(screenId + type + maskedSignature). */
export function computeDedupKey(draft: FindingDraft): string {
  return createHash("sha256").update(`${draft.screenId}:${draft.type}:${draft.maskedSignature}`).digest("hex");
}
