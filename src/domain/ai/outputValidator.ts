import type { AiAction, AiOutputs, Evaluation, TeachOutput } from "./types";
import type { Score } from "../types";

export function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function parse(input: string) {
  const text = input.trim().replace(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i, "$1");
  try { return asObject(JSON.parse(text)); } catch { return {}; }
}

function safeText(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max ||
      /(?:https?:|www\.|10\.\d{4,9}\/|<\s*\/?[a-z]+(?:\s|>))/i.test(value)) return null;
  return value.replace(/\s+/g, " ").trim();
}

export function parseTeachOutput(input: string, sources: number): TeachOutput | null {
  const data = parse(input);
  const explanation = safeText(data.explanation, 1800);
  const problem = safeText(data.problem, 700);
  if (!explanation || !problem || !Array.isArray(data.steps) || data.steps.length !== 3 || !Array.isArray(data.source_refs)) return null;
  const [one, two, three] = data.steps.map(step => safeText(step, 600));
  const refs = data.source_refs as unknown[];
  if (!one || !two || !three || refs.length > sources ||
      refs.some(ref => typeof ref !== "number" || !Number.isInteger(ref) || ref < 1 || ref > sources)) return null;
  return { explanation, steps: [one, two, three], problem, source_refs: [...new Set(refs as number[])] };
}

export function parseEvaluationOutput(input: string): Evaluation | null {
  const result = parse(input);
  const score = result.score;
  const gap_hypothesis = safeText(result.gap_hypothesis, 700);
  const feedback = safeText(result.feedback, 1500);
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 3 || !gap_hypothesis || !feedback) return null;
  return { score: score as Score, gap_hypothesis, feedback };
}

export function validateOutput<K extends AiAction>(kind: K, input: string, sourceCount: number): AiOutputs[K] | null;
export function validateOutput(kind: AiAction, input: string, sourceCount: number): AiOutputs[AiAction] | null {
  if (kind === "teach") return parseTeachOutput(input, sourceCount);
  if (kind === "evaluate") return parseEvaluationOutput(input);
  const data = parse(input);
  if (kind === "diagnostic") {
    const question = safeText(data.question, 500);
    return question && question.endsWith("?") && question.indexOf("?") === question.length - 1 ? { question } : null;
  }
  const problem = safeText(data.problem, 700);
  return problem ? { problem } : null;
}
