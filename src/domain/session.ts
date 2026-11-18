import { appendCallouts, callout } from "./callout";
import { recordConfidence } from "./calibration";
import { cardBlock, readCards } from "./cards";
import { patchTopic, readTopic } from "./frontmatter";
import { earliestDue, newCard, reviewCard, type Rating } from "./fsrs";
import { recordEvidence, topicState } from "./rubric";
import { initialAnswers, postTestBlock } from "./templates";
import type { Axis, Confidence, Score } from "./types";

interface Attempt {
  mode: "socratic" | "post" | "devil";
  prompt: string;
  answer: string;
  confidence: Confidence;
  correct: boolean;
  axis: Axis;
  initialCorrect?: boolean;
  cardId: string;
  day: string;
  id: boolean;
}

function misconception(id: string, day: string, answer: string) {
  return callout("misconception", "High-confidence error (90%) · " + day + " · " + id,
    "status: open\nhigh_confidence_error: true\n\n" + answer);
}

function requireTopic(markdown: string) {
  const note = readTopic(markdown);
  if (!note) throw new Error("Unsupported learning note");
  return note;
}

export function saveAttempt(markdown: string, input: Attempt): string {
  const { topic, body } = requireTopic(markdown);
  const { guess } = initialAnswers(body, topic.cl_origin === "browser-capture");
  const blocks: string[] = [];
  let calibration = topic.cl_calibration;
  let highError = false;
  if (input.initialCorrect !== undefined && guess &&
      !/^> initial_assessed: true$/m.test(body)) {
    const result = recordConfidence(calibration, topic.cl_prior_confidence, input.initialCorrect);
    calibration = result.next;
    highError = result.highError;
    blocks.push(callout("probe", input.id ? "Penilaian dugaan awal" : "Prior guess assessment",
      "initial_assessed: true\n" + guess));
    if (result.highError) blocks.push(misconception(input.cardId + "-prior", input.day, guess));
  }
  const attempt = recordConfidence(calibration, input.confidence, input.correct);
  highError ||= attempt.highError;
  const rubric = recordEvidence(topic.cl_axes, input.axis, input.correct ? 2 : 0, "self_reported", input.day);
  const feedback = input.mode === "post"
    ? postTestBlock(guess, input.answer, topic.cl_prior_confidence, input.confidence, input.correct, input.id)
    : callout("probe", (input.mode === "devil" ? (input.id ? "Uji bantahan" : "Devil’s advocate") : "Socratic") + " · " + input.day,
      input.prompt + "\n\n" + input.answer + "\n\n" + input.confidence + "% · " +
      (input.correct ? "correct" : "incorrect") + " · self_reported");
  blocks.push(feedback);
  if (attempt.highError) blocks.push(misconception(input.cardId, input.day, input.answer));
  const cards = readCards(body, topic.cl_created).map(entry => entry.card);
  if (input.mode === "post" && input.correct) {
    const card = newCard(input.cardId, input.prompt, input.answer, input.day);
    cards.push(card);
    blocks.push(cardBlock(card));
  }
  return patchTopic(markdown, {
    cl_axes: rubric, cl_calibration: attempt.next, cl_updated: input.day,
    cl_review_due: earliestDue(cards), cl_state: topicState(topic.cl_state, rubric, highError),
  }, previous => appendCallouts(previous, ...blocks));
}

export function saveExplanation(markdown: string, response: string, score: Score, day: string) {
  const { topic } = requireTopic(markdown);
  const rubric = recordEvidence(topic.cl_axes, "explanation", score, "rule_checked", day);
  return patchTopic(markdown, { cl_axes: rubric, cl_updated: day,
    cl_state: topicState(topic.cl_state, rubric, topic.cl_state === "needs_reassessment") },
  body => appendCallouts(body, callout("probe", "Feynman · " + day, response + "\n\nE: " + score + " · rule_checked")));
}

export function saveReview(markdown: string, cardId: string, expectedReps: number,
    rating: Rating, confidence: Confidence, day: string) {
  const { topic, body } = requireTopic(markdown);
  const entries = readCards(body, topic.cl_created);
  const matching = entries.filter(entry => entry.card.id === cardId);
  const entry = matching[0];
  if (matching.length !== 1 || entry.card.reps !== expectedReps) throw new Error("Card changed during the session");
  const result = reviewCard(entry.card, rating, day);
  const attempt = recordConfidence(topic.cl_calibration, confidence, rating !== 1);
  const rubric = recordEvidence(topic.cl_axes, result.axis, result.score, "self_reported", day);
  const { start, end } = entry.block;
  const updated = cardBlock(result.next).replace(/\n/g, body.includes("\r\n") ? "\r\n" : "\n");
  const blocks = [callout("review", cardId + " · " + day,
    ["rating: " + rating, "confidence: " + confidence, "elapsed_days: " + result.next.elapsed_days,
      "source: self_reported"].join("\n"))];
  if (attempt.highError) blocks.push(misconception(cardId + "-" + result.next.reps, day, entry.card.question));
  const content = patchTopic(markdown, {
    cl_axes: rubric, cl_calibration: attempt.next, cl_updated: day,
    cl_review_due: earliestDue(entries.map(item => item === entry ? result.next : item.card)),
    cl_state: topicState(topic.cl_state, rubric, attempt.highError || result.relearning),
  }, previous => appendCallouts(previous.slice(0, start) + updated + previous.slice(end), ...blocks));
  return { content, result };
}
