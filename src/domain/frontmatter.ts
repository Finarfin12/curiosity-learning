import { isMap, isNode, parseDocument, stringify } from "yaml";
import { axes, confidenceLevels, type Topic, type TopicPatch } from "./types";
import { emptyCalibration } from "./calibration";
import { validDate } from "./dates";
import { defaultNames, flatProperties, readFlat, topicMetadata, type PropNames } from "./learningProperties";

const header = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m;

export function isLearning(data: Record<string, unknown> | null | undefined): boolean {
  return data?.type === "learning" || (data?.type === undefined && data?.cl_kind === "learning");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validTopic(data: Record<string, unknown>): boolean {
  if (!isLearning(data) || data.cl_schema !== 1 || typeof data.cl_id !== "string" || !data.cl_id) return false;
  if (typeof data.cl_goal !== "string" || typeof data.cl_created !== "string" || !validDate(data.cl_created)) return false;
  if (!(confidenceLevels as readonly unknown[]).includes(data.cl_prior_confidence)) return false;
  const rubric = asRecord(data.cl_axes);
  const calibration = asRecord(data.cl_calibration);
  return Object.keys(axes).every(key => {
    const { score, source } = asRecord(rubric[key]);
    return score === "not_tested" ? source === "not_tested" :
      [0, 1, 2, 3].includes(score as number) && ["self_reported", "rule_checked", "observed_ai"].includes(source as string);
  }) && Object.keys(emptyCalibration()).every(key =>
    typeof calibration[key] === "number" && Number.isSafeInteger(calibration[key]) && Number(calibration[key]) >= 0);
}

function parseNote(markdown: string) {
  const match = header.exec(markdown);
  if (!match || match.index !== 0) return null;
  const yaml = parseDocument(match[2]);
  if (yaml.errors.length > 0 || !isMap(yaml.contents)) return null;
  let data: Record<string, unknown>;
  try { data = asRecord(yaml.toJS({ maxAliasCount: 100 })); }
  catch { return null; }
  if (!isLearning(data)) return null;
  const body = markdown.slice(match[0].length);
  const flat = readFlat(data, body);
  if (flat) data = flat.data;
  if (!validTopic(data)) return null;
  if (!Array.isArray(data.cl_prereq)) data.cl_prereq = [];
  return { match, yaml, topic: data as unknown as Topic, body: flat?.body ?? body, names: flat?.names };
}

export function readTopic(markdown: string) {
  const note = parseNote(markdown);
  return note && { topic: note.topic, body: note.body, legacy: !note.names };
}

const editable = new Set([
  "cl_state", "cl_goal", "cl_prereq", "cl_created", "cl_updated", "cl_review_due",
  "cl_origin", "cl_source_url", "cl_prior_confidence", "cl_axes", "cl_calibration",
]);

export function patchTopic(markdown: string, patch: TopicPatch, editBody = (body: string) => body): string {
  const note = parseNote(markdown);
  if (!note) throw new Error("Unsupported learning note");
  const eol = note.match[1].endsWith("\r\n") ? "\r\n" : "\n";
  const original = note.match[2];
  const replacements: { start: number; end: number; text: string }[] = [];
  for (const key of Object.keys(patch)) if (!editable.has(key)) throw new Error("Unsupported learning property");
  const updated = { ...note.topic, ...patch };
  const values = note.names ? flatProperties(updated, note.names) : patch;
  for (const [key, value] of Object.entries(values)) {
    if (note.names && JSON.stringify(value) === JSON.stringify(note.yaml.get(key))) continue;
    const node = note.yaml.get(key, true);
    const range = isNode(node) ? node.range : undefined;
    const replacement = stringify(value, { collectionStyle: "flow", lineWidth: 0, blockQuote: false, defaultStringType: "QUOTE_DOUBLE" }).trim();
    if (!range) {
      replacements.push({ start: original.length, end: original.length, text: key + ": " + replacement + eol });
      continue;
    }
    const [start, end] = range;
    replacements.push({ start, end, text: replacement + (original[end - 1] === "\n" ? eol : "") });
  }
  let frontmatter = original;
  for (const edit of replacements.sort((a, b) => b.start - a.start)) {
    frontmatter = frontmatter.slice(0, edit.start) + edit.text + frontmatter.slice(edit.end);
  }
  const body = editBody(note.body);
  const closing = note.match[3];
  const result = note.match[1] + frontmatter + closing + (!closing.endsWith("\n") ? eol : "") +
    (note.names ? topicMetadata(updated, note.names, eol) : "") + body;
  if (!parseNote(result)) throw new Error("Invalid learning note update");
  return result;
}

const legacyKeys = new Set(["cl_schema", "cl_kind", "cl_id", "cl_capture_id", ...editable]);

export function migrateProperties(markdown: string, names: PropNames): string {
  const note = parseNote(markdown);
  if (!note) throw new Error("Unsupported learning note");
  const managed = note.names ? new Set(Object.keys(flatProperties(note.topic, note.names))) : legacyKeys;
  const next = flatProperties(note.topic, names);
  for (const key of Object.keys(next)) {
    if (note.yaml.has(key) && !managed.has(key) && !(key === "type" && note.yaml.get(key) === "learning")) {
      throw new Error("Custom property collision");
    }
  }
  for (const key of managed) if (!(key in next)) note.yaml.delete(key);
  for (const [key, value] of Object.entries(next)) note.yaml.set(key, value);
  const eol = note.match[1].endsWith("\r\n") ? "\r\n" : "\n";
  const result = note.match[1] + note.yaml.toString().replace(/\n/g, eol) + "---" + eol +
    topicMetadata(note.topic, names, eol) + note.body;
  if (!parseNote(result)) throw new Error("Invalid learning note migration");
  return result;
}

export function serializeTopic(topic: Topic, body: string, names = defaultNames): string {
  return "---\n" + stringify(flatProperties(topic, names)) + "---\n" + topicMetadata(topic, names, "\n") + body;
}
