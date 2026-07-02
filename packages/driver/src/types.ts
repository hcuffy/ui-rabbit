/** Driver-internal charter contract. Not part of the engine's `CapturedObservation`
 * contract — scoped to packages/driver only (driver-spec §4). */
export type CharterStep = { kind: "navigate"; path: string } | { kind: "clickFirstLink" };

export interface CharterPlan {
  name: string;
  steps: CharterStep[];
}
