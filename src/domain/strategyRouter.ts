import type { Topic } from "./types";

export function nextStrategy(topic: Topic, today: string) {
  if (topic.cl_review_due && topic.cl_review_due <= today) return "review";
  if (topic.cl_state === "exploring" || topic.cl_state === "captured") return "teach";
  if (topic.cl_axes.explanation.score === "not_tested") return "feynman";
  if (topic.cl_axes.procedure.score === "not_tested") return "socratic";
  const explanation = topic.cl_axes.explanation.score;
  if (typeof explanation === "number" && explanation >= 2 && topic.cl_axes.transfer.score === "not_tested") return "devil";
  return "post";
}
