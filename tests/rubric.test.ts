import { expect, test } from "vitest";
import { addDays } from "../src/domain/dates";
import { readTopic } from "../src/domain/frontmatter";
import { saveAttempt, saveExplanation, saveReview } from "../src/domain/session";
import { day, sample } from "./helpers";

test("KT-06: untouched axes remain untested; FSRS distinguishes recall and retention", () => {
  const original = readTopic(sample())!.topic.cl_axes;
  expect(Object.values(original).map(value => value.score)).toEqual(Array(5).fill("not_tested"));
  const explained = saveExplanation(sample(), "My explanation", 2, day);
  expect(readTopic(explained)!.topic.cl_axes).toEqual({ ...original,
    explanation: { score: 2, source: "rule_checked", updated: day } });
  const card = saveAttempt(explained, { mode: "post", prompt: "Q", answer: "A", confidence: 70,
    correct: true, axis: "procedure", cardId: "card", day, id: false });
  const immediate = saveReview(card, "card", 0, 3, 70, day);
  const first = readTopic(immediate.content)!.topic.cl_axes;
  expect(first.recall.score).toBe(2);
  expect(first.retention.score).toBe("not_tested");
  const delayed = saveReview(immediate.content, "card", 1, 3, 70, addDays(day, 3));
  const later = readTopic(delayed.content)!.topic.cl_axes;
  expect(delayed.result.next.elapsed_days).toBe(3);
  expect(later.retention.score).toBe(2);
  expect(later.recall).toEqual(first.recall);
});
