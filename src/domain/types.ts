export const axes = {
  recall: "R", explanation: "E", procedure: "P", transfer: "T", retention: "D",
} as const;

export type Axis = keyof typeof axes;
export type Score = 0 | 1 | 2 | 3;
export type Source = "self_reported" | "rule_checked" | "observed_ai";
export type Evidence = { score: Score; source: Source; updated: string }
  | { score: "not_tested"; source: "not_tested"; updated: "" };
export type Rubric = Record<Axis, Evidence>;
export const confidenceLevels = [50, 70, 90] as const;
export type Confidence = typeof confidenceLevels[number];
export type Calibration = Record<`c${Confidence}_${"correct" | "total"}` | "high_conf_errors", number>;
export type State = "captured" | "exploring" | "building" | "demonstrated_in_context" |
  "review_due" | "needs_reassessment" | "archived";
export interface Topic {
  cl_schema: 1;
  cl_id: string;
  cl_kind: "learning";
  cl_state: State;
  cl_goal: string;
  cl_prereq: string[];
  cl_created: string;
  cl_updated: string;
  cl_review_due: string;
  cl_origin: string;
  cl_source_url: string;
  cl_prior_confidence: Confidence;
  cl_axes: Rubric;
  cl_calibration: Calibration;
  cl_capture_id?: string;
}
export type TopicPatch = Partial<Omit<Topic, "cl_schema" | "cl_kind" | "cl_id" | "cl_capture_id">>;
