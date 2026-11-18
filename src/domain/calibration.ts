import { confidenceLevels, type Calibration, type Confidence } from "./types";

export function emptyCalibration(): Calibration {
  return { c50_correct: 0, c50_total: 0, c70_correct: 0, c70_total: 0,
    c90_correct: 0, c90_total: 0, high_conf_errors: 0 };
}

export function recordConfidence(previous: Calibration, confidence: Confidence, correct: boolean) {
  const next = { ...previous };
  const highError = confidence === 90 && !correct;
  next[`c${confidence}_total`] += 1;
  next[`c${confidence}_correct`] += Number(correct);
  next.high_conf_errors += Number(highError);
  return { next, highError };
}

export function summarize(calibration: Calibration) {
  const buckets = confidenceLevels.map(confidence => {
    const total = calibration[`c${confidence}_total`];
    const correct = calibration[`c${confidence}_correct`];
    return { confidence, total, correct, accuracy: total ? Math.round(100 * correct / total) : null };
  });
  const populated = buckets.flatMap(({ confidence, accuracy }) => accuracy === null ? [] : [confidence - accuracy]);
  const gap = populated.length ? populated.reduce((sum, value) => sum + value, 0) / populated.length : null;
  const status: "noData" | "over" | "under" | "calibrated" = gap === null ? "noData" : gap > 15 ? "over" : gap < -15 ? "under" : "calibrated";
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const brier = total ? buckets.reduce((sum, { confidence, correct, total: count }) => {
    const p = confidence / 100;
    return sum + correct * (1 - p) ** 2 + (count - correct) * p ** 2;
  }, 0) / total : null;
  return { buckets, gap, status, brier };
}
