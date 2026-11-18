import { test, expect } from "vitest";
import { readTopic } from "../src/domain/frontmatter";
import { saveAttempt } from "../src/domain/session";
import { parseCallouts } from "../src/domain/callout";
import { initialAnswers } from "../src/domain/templates";
import { day, sample } from "./helpers";

test("KT-03: persists before/after, initial calibration and a recall card", () => {
  expect(initialAnswers(readTopic(sample())!.body).guess).toBe("1/2 + 1/3 = 2/5");
  const after = saveAttempt(sample(), { mode: "post", prompt: "Pecahan?", answer: "3/6 + 2/6 = 5/6",
    confidence: 70, correct: true, initialCorrect: false, axis: "procedure", cardId: "one", day, id: true });
  const note = readTopic(after)!;
  const blocks = parseCallouts(note.body);
  expect(blocks.find(block => block.type === "feedback")?.body).toContain(
    "Sebelum (90%)\n1/2 + 1/3 = 2/5\n\nSesudah (70%)\n3/6 + 2/6 = 5/6");
  expect(blocks.map(block => block.type)).toEqual(["probe", "misconception", "feedback", "card"]);
  expect(note.topic.cl_calibration.high_conf_errors).toBe(1);
  expect(note.topic.cl_state).toBe("needs_reassessment");
  expect(note.topic.cl_review_due).toBe(day);
});
