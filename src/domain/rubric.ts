import type { Axis, Evidence, Rubric, Score, Source, State } from "./types";

export function emptyRubric(): Rubric {
  const empty: Evidence = { score: "not_tested", source: "not_tested", updated: "" };
  return { recall: { ...empty }, explanation: { ...empty }, procedure: { ...empty },
    transfer: { ...empty }, retention: { ...empty } };
}

export function recordEvidence(rubric: Rubric, axis: Axis, score: Score, source: Source, date: string): Rubric {
  return { ...rubric, [axis]: { score, source, updated: date } };
}

export function topicState(current: State, rubric: Rubric, needsReassessment: boolean): State {
  if (current === "archived") return current;
  if (needsReassessment) return "needs_reassessment";
  const demonstrates = (axis: Axis) => {
    const value = rubric[axis].score;
    return typeof value === "number" && value >= 2;
  };
  return demonstrates("explanation") && (demonstrates("procedure") || demonstrates("transfer"))
    ? "demonstrated_in_context" : "building";
}
