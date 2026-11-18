import { emptyCalibration } from "./calibration";
import { emptyRubric } from "./rubric";
import { axes, type Axis, type Topic, type Calibration, type Source, type Score } from "./types";

export const propertyFields = ["status", "goal", "prereq", "created", "updated", "review", "origin", "source",
  "confidence", "recall", "explanation", "procedure", "transfer", "retention", "calibration"] as const;
export type PropField = typeof propertyFields[number];
export type PropNames = Record<PropField, string>;
export const defaultNames = Object.fromEntries(propertyFields.map(field => [field, field])) as PropNames;
const reserved = new Set(["type", "tags", "aliases", "cssclasses", "constructor", "prototype", "__proto__"]);

const record = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};

export function parseNames(input: unknown): PropNames | null {
  const raw = record(input);
  const names = { ...defaultNames };
  const used = new Set(reserved);
  for (const field of propertyFields) {
    const candidate = raw[field] === undefined ? field : raw[field];
    if (typeof candidate !== "string") return null;
    const name = candidate.trim();
    const key = name.toLowerCase();
    if (!/^[A-Za-z0-9_](?:[A-Za-z0-9_ -]{0,58}[A-Za-z0-9_])?$/.test(name) ||
        key.startsWith("cl_") || used.has(key)) return null;
    used.add(key);
    names[field] = name;
  }
  return names;
}

const axisNames = Object.keys(axes) as Axis[];
const shortSource: Record<Source, string> = { self_reported: "self", rule_checked: "rule", observed_ai: "ai" };
const fullSource: Record<string, Source> = { self: "self_reported", rule: "rule_checked", ai: "observed_ai" };

export function flatProperties(topic: Topic, names: PropNames): Record<string, string | number | string[]> {
  const stats = topic.cl_calibration;
  const correct = stats.c50_correct + stats.c70_correct + stats.c90_correct;
  const total = stats.c50_total + stats.c70_total + stats.c90_total;
  const accuracy = total ? Math.round(correct / total * 100) + "%" : "—";
  const fields: Record<PropField, string | number | string[]> = {
    status: topic.cl_state, goal: topic.cl_goal, prereq: topic.cl_prereq, created: topic.cl_created,
    updated: topic.cl_updated, review: topic.cl_review_due, origin: topic.cl_origin === "browser-capture" ? "capture" : topic.cl_origin,
    source: topic.cl_source_url, confidence: topic.cl_prior_confidence,
    recall: "", explanation: "", procedure: "", transfer: "", retention: "",
    calibration: correct + "/" + total + " (" + accuracy + ") · " + stats.high_conf_errors + " high-conf " +
      (stats.high_conf_errors === 1 ? "error" : "errors"),
  };
  for (const axis of axisNames) {
    const value = topic.cl_axes[axis];
    fields[axis] = value.score === "not_tested" ? value.score : value.score + " (" + shortSource[value.source] + ")";
  }
  return { type: "learning", ...Object.fromEntries(propertyFields.map(field => [names[field], fields[field]])) };
}

const metadataPattern = /^<!-- curiosity-learning:v1 (.+) -->[ \t]*(?:\r?\n|$)/;

export function topicMetadata(topic: Topic, names: PropNames, eol: string) {
  const dates = Object.fromEntries(axisNames.map(axis => [axis, topic.cl_axes[axis].updated]));
  const metadata = JSON.stringify({ id: topic.cl_id, capture_id: topic.cl_capture_id, names, dates,
    buckets: topic.cl_calibration }).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  return "<!-- curiosity-learning:v1 " + metadata + " -->" + eol;
}

export function readFlat(data: Record<string, unknown>, body: string) {
  const match = metadataPattern.exec(body);
  if (data.type !== "learning" || !match) return null;
  let meta: Record<string, unknown>;
  try { meta = record(JSON.parse(match[1])); } catch { return null; }
  const names = parseNames(meta.names);
  if (!names || typeof meta.id !== "string") return null;
  const value = (field: PropField) => data[names[field]];
  const str = (field: PropField): string => {
    const current = value(field);
    return typeof current === "string" ? current : "";
  };
  const rubric = emptyRubric();
  const dates = record(meta.dates);
  for (const axis of axisNames) {
    const text = str(axis);
    const score = /^([0-3]) \((self|rule|ai)\)$/.exec(text);
    if (!score && text !== "not_tested") return null;
    if (score) rubric[axis] = { score: Number(score[1]) as Score, source: fullSource[score[2]],
      updated: typeof dates[axis] === "string" ? dates[axis] : "" };
  }
  const calibration = record(meta.buckets);
  if (Object.keys(emptyCalibration()).some(key => !Number.isSafeInteger(calibration[key]))) return null;
  const links = value("prereq");
  const topic = {
    cl_kind: "learning", cl_schema: 1, cl_id: meta.id, cl_state: str("status"), cl_goal: str("goal"),
    cl_prereq: Array.isArray(links) ? links.filter((link): link is string => typeof link === "string") : [],
    cl_created: str("created"), cl_updated: str("updated"), cl_review_due: str("review"),
    cl_origin: str("origin") === "capture" ? "browser-capture" : str("origin"), cl_source_url: str("source"),
    cl_prior_confidence: value("confidence"), cl_axes: rubric, cl_calibration: calibration as Calibration,
    cl_capture_id: typeof meta.capture_id === "string" ? meta.capture_id : undefined,
  };
  return { data: topic, names, body: body.slice(match[0].length) };
}
