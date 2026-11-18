import { decodeCapturedText } from "./captureMarkdown";
import { emptyCalibration } from "./calibration";
import { callout, quoteText } from "./callout";
import type { PropNames } from "./learningProperties";
import { serializeTopic } from "./frontmatter";
import { emptyRubric } from "./rubric";
import type { Confidence, Topic } from "./types";

export interface TopicInput {
  goal: string; question: string; guess: string; confidence: Confidence; prereq?: string[];
}

export function createTopic(input: TopicInput, day: string, id: string, language: "id" | "en", captured = false, names?: PropNames): string {
  const topic: Topic = {
    cl_schema: 1, cl_kind: "learning", cl_id: id, cl_state: captured ? "captured" : "exploring", cl_goal: input.goal,
    cl_prereq: input.prereq ?? [], cl_created: day, cl_updated: day, cl_review_due: "", cl_origin: "manual",
    cl_source_url: "", cl_prior_confidence: input.confidence, cl_axes: emptyRubric(),
    cl_calibration: emptyCalibration(),
  };
  const labels = language === "id" ? ["Pertanyaanku", "Dugaan awal"] : ["My question", "Prior guess"];
  return serializeTopic(topic, "## " + labels[0] + "\n\n" + quoteText(input.question) +
    "\n\n## " + labels[1] + "\n\n" + quoteText(input.guess) + "\n", names);
}

export function postTestBlock(before: string, after: string, prior: Confidence, confidence: Confidence,
    correct: boolean, id: boolean): string {
  return callout("feedback", id ? "Uji lagi" : "Post-test",
    (id ? "Sebelum" : "Before") + " (" + prior + "%)\n" + before + "\n\n" +
    (id ? "Sesudah" : "After") + " (" + confidence + "%)\n" + after + "\n\n" +
    (correct ? (id ? "Benar" : "Correct") : (id ? "Salah" : "Incorrect")) + " (self_reported)");
}

export function initialAnswers(body: string, captured = false) {
  const lines = body.split(/\r?\n/);
  const section = (headings: RegExp) => {
    const start = lines.findIndex(line => headings.test(line));
    if (start === -1) return "";
    const values: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (/^#{1,6} |^>\s*\[!cl-/i.test(line) || (!line.trim() && values.length)) break;
      if (!line.trim() || /^\s*-\s+\*\*(?:Keyakinan awal|Initial confidence):/i.test(line)) continue;
      values.push(line.replace(/^> ?|^\s*-\s+\*\*(?:Dugaan|Guess):\*\* /i, "").replace(/^\\(?=\[!cl-)/i, ""));
    }
    const answer = values.join("\n").trim();
    return captured ? decodeCapturedText(answer) : answer;
  };
  return {
    question: section(/^## (?:My question|Pertanyaanku)\s*$/i),
    guess: section(/^## (?:Prior guess|Dugaan awal)(?:\s+\(.+\))?\s*$/i),
  };
}
