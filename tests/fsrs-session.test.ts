import { expect, test } from "vitest";
import { addDays } from "../src/domain/dates";
import { readTopic } from "../src/domain/frontmatter";
import { advanceSession, newCard, reviewCard } from "../src/domain/fsrs";
import { saveAttempt, saveReview } from "../src/domain/session";
import { day, sample } from "./helpers";

test("KT-07: Again then Hard keeps the first of three cards in the queue until Good", () => {
  const ids = ["one", "two", "three"];
  let note = sample();
  for (const cardId of ids) note = saveAttempt(note, { mode: "post", prompt: "Q " + cardId,
    answer: "A", confidence: 70, correct: true, axis: "procedure", cardId, day, id: false });
  let queue = ids;
  const grade = (rating: 1 | 2 | 3, reps: number) => {
    const review = saveReview(note, queue[0], reps, rating, 90, day);
    note = review.content;
    queue = advanceSession(queue, review.result.relearning);
    return review.result.next;
  };
  grade(1, 0);
  expect(queue).toEqual(["two", "three", "one"]);
  expect(readTopic(note)!.topic.cl_review_due).toBe(day);
  grade(3, 0);
  grade(3, 0);
  grade(2, 1);
  expect(queue).toEqual(["one"]);
  const card = grade(3, 2);
  expect(queue).toEqual([]);
  expect(card.scheduled_days).toBe(1);
  expect(readTopic(note)!.topic.cl_review_due).toBe(addDays(day, 1));
  expect(() => saveReview(note, "one", 2, 3, 90, day)).toThrow("Card changed");
});
test("KT-07: deterministic FSRS-5 memory states and seven-day evidence", () => {
  const first = reviewCard(newCard("one", "Q", "A", day), 3, day).next;
  expect(first.stability).toBeCloseTo(3.173, 6);
  expect(first.difficulty).toBeCloseTo(5.282434, 5);
  const next = reviewCard(first, 4, addDays(day, 7));
  expect(next.next.stability).toBeGreaterThan(first.stability);
  expect(next).toMatchObject({ axis: "retention", score: 3 });
});
