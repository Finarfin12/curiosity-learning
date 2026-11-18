import { emptyCalibration } from "./calibration";
import { validateCapture, type Capture } from "./captureValidator";
import { readTopic, serializeTopic } from "./frontmatter";
import type { PropNames } from "./learningProperties";
import { emptyRubric } from "./rubric";

const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "[": "&#91;", "]": "&#93;" };
const literals = Object.fromEntries(Object.entries(entities).map(([key, value]) => [value, key]));
const quote = (value: string) => value.split("\n").map(line => "> " + line.replace(/[&<>[\]]/g, char => entities[char])).join("\n");
export const decodeCapturedText = (value: string) => value.replace(/&(?:amp|lt|gt|#91|#93);/g, token => literals[token]);

export function captureMarkdown(capture: Capture, day: string, id: string, names?: PropNames): string {
  return serializeTopic({
    cl_schema: 1, cl_kind: "learning", cl_id: id, cl_capture_id: capture.capture_id,
    cl_state: "captured", cl_goal: capture.title, cl_prereq: [], cl_created: day, cl_updated: day,
    cl_review_due: "", cl_origin: "browser-capture", cl_source_url: capture.url,
    cl_prior_confidence: capture.confidence, cl_axes: emptyRubric(), cl_calibration: emptyCalibration(),
  }, "## My question\n\n" + quote(capture.question) + "\n\n## Prior guess\n\n" +
    quote(capture.prior_guess) + "\n\n## Source selection\n\n" + quote(capture.selection) + "\n", names);
}

function quoteAfter(body: string, heading: string) {
  const lines = body.split(/\r?\n/);
  const headingIndex = lines.indexOf("## " + heading);
  if (headingIndex === -1) return "";
  const next = lines.slice(headingIndex + 1);
  while (next.length && next[0].trim() === "") next.shift();
  const end = next.findIndex(line => !/^>/.test(line));
  return decodeCapturedText((end === -1 ? next : next.slice(0, end)).map(line => line.replace(/^> ?/, "")).join("\n"));
}

export function parseCaptureMarkdown(markdown: string): Capture | null {
  if (markdown.length > 35_000) return null;
  const note = readTopic(markdown);
  if (note?.topic.cl_state !== "captured" || note.topic.cl_origin !== "browser-capture") return null;
  const { topic, body } = note;
  return validateCapture({ v: "1", capture_id: topic.cl_capture_id, title: topic.cl_goal,
    url: topic.cl_source_url, confidence: String(topic.cl_prior_confidence),
    question: quoteAfter(body, "My question"), prior_guess: quoteAfter(body, "Prior guess"),
    selection: quoteAfter(body, "Source selection") });
}
