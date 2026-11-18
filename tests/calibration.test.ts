import { test, expect } from "vitest";
import { emptyCalibration, recordConfidence, summarize } from "../src/domain/calibration";
import { readTopic } from "../src/domain/frontmatter";
import { saveAttempt } from "../src/domain/session";
import { day, sample } from "./helpers";

test("KT-04: classifies high-confidence errors and records a ledger entry", () => {
  const updated = saveAttempt(sample(), { mode: "socratic", prompt: "Why?", answer: "Wrong",
    confidence: 90, correct: false, axis: "procedure", cardId: "one", day, id: false });
  const note = readTopic(updated)!;
  expect(note.topic.cl_calibration.high_conf_errors).toBe(1);
  expect(note.body).toContain("[!cl-misconception]");
  expect(summarize(note.topic.cl_calibration).status).toBe("over");
});
test("KT-04: computes each observed bucket, calibration gap and Brier score", () => {
  let state = emptyCalibration();
  for (const confidence of [50, 70, 90] as const) state = recordConfidence(state, confidence, true).next;
  expect(summarize(state)).toMatchObject({ status: "under", gap: -30,
    buckets: [{ accuracy: 100 }, { accuracy: 100 }, { accuracy: 100 }] });
  state = recordConfidence(state, 50, false).next;
  expect(summarize(state)).toMatchObject({ status: "calibrated", buckets: [{ accuracy: 50 },
    { accuracy: 100 }, { accuracy: 100 }] });
  expect(summarize(state).brier).toBeCloseTo(0.15);
  expect(summarize(emptyCalibration())).toMatchObject({ status: "noData", brier: null });
});
