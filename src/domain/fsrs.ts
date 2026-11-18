import { addDays, elapsedDays } from "./dates";
import type { Axis, Score } from "./types";

export type Rating = 1 | 2 | 3 | 4;
export interface Card {
  id: string;
  question: string;
  answer: string;
  due: string;
  created: string;
  last_review: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: "new" | "review" | "relearning";
}

// FSRS-5 default weights and 90% target retention.
const w = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604,
  0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
  2.9898, 0.51655, 0.6621] as const;
const factor = 0.9 ** -2 - 1;
const clampDifficulty = (value: number) => Math.min(10, Math.max(1, value));
const initialDifficulty = (rating: Rating) => w[4] - Math.exp(w[5] * (rating - 1)) + 1;

export function newCard(id: string, question: string, answer: string, day: string): Card {
  return { id, question, answer, due: day, created: day, last_review: "", stability: 0,
    difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: "new" };
}

function nextStability(card: Card, rating: Rating, elapsed: number): number {
  const { stability: s, difficulty: d } = card;
  if (!s || !card.reps) return w[rating - 1];
  if (!elapsed) return s * Math.exp(w[17] * (rating - 3 + w[18]));
  const r = (1 + factor * elapsed / s) ** -0.5;
  if (rating === 1) {
    const forget = w[11] * d ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp((1 - r) * w[14]);
    return Math.min(forget, s / Math.exp(w[17] * w[18]));
  }
  const hard = rating === 2 ? w[15] : 1;
  const easy = rating === 4 ? w[16] : 1;
  return s * (1 + Math.exp(w[8]) * (11 - d) * s ** -w[9] *
    (Math.exp((1 - r) * w[10]) - 1) * hard * easy);
}

export function reviewCard(card: Card, rating: Rating, today: string) {
  const elapsed = elapsedDays(card.last_review || card.created, today);
  const stability = Math.max(0.01, Math.min(36_500, nextStability(card, rating, elapsed)));
  const damped = card.difficulty - w[6] * (rating - 3) * (10 - card.difficulty) / 9;
  const difficulty = clampDifficulty(card.reps
    ? w[7] * initialDifficulty(4) + (1 - w[7]) * damped
    : initialDifficulty(rating));
  const again = rating === 1;
  const relearning = again || (card.state === "relearning" && rating < 3);
  const scheduled = relearning ? 0 : card.state === "relearning" ? 1 : Math.max(1, Math.round(stability));
  const axis: Axis = elapsed === 0 ? "recall" : "retention";
  let score: Score = rating === 1 ? 0 : rating === 2 ? 1 : 2;
  if (rating >= 3 && (axis === "retention" ? elapsed >= 7 && card.reps + 1 >= 2 : rating === 4)) score = 3;
  const next: Card = {
    ...card, due: addDays(today, scheduled), last_review: today, elapsed_days: elapsed,
    scheduled_days: scheduled, stability, difficulty, reps: card.reps + 1,
    lapses: card.lapses + Number(again && card.state === "review"),
    state: relearning ? "relearning" : "review",
  };
  return { next, relearning, axis, score };
}

export function advanceSession<T>(queue: readonly T[], repeat: boolean): T[] {
  const [first, ...rest] = queue;
  return repeat && first !== undefined ? [...rest, first] : rest;
}

export function earliestDue(cards: readonly Card[]): string {
  return cards.map(card => card.due).sort()[0] ?? "";
}
