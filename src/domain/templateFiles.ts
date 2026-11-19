import { isMap, parseDocument } from "yaml";
import { emptyCalibration } from "./calibration";
import { validDate } from "./dates";
import { isLearning, readTopic } from "./frontmatter";
import { flatProperties, topicMetadata, type PropNames } from "./learningProperties";
import { emptyRubric } from "./rubric";
import type { Confidence, Topic } from "./types";

export type TemplateKind = "topic" | "inbox";

export const DEFAULT_TEMPLATE_FOLDER = "Templates";

export const TEMPLATE_FILES: Record<TemplateKind, string> = {
  topic: "Curiosity Learning Topic.md",
  inbox: "Curiosity Learning Inbox.md",
};

export function templateContent(kind: TemplateKind, names: PropNames, language: "en" | "id"): string {
  const status = kind === "inbox" ? "captured" : "exploring";
  const labels = language === "id" ? ["Pertanyaanku", "Dugaan awal"] : ["My question", "Prior guess"];
  const lines = [
    "---",
    "type: learning",
    `${names.status}: ${status}`,
    `${names.goal}: ""`,
    `${names.prereq}: []`,
    `${names.created}: {{date:YYYY-MM-DD}}`,
    `${names.updated}: {{date:YYYY-MM-DD}}`,
    `${names.review}: ""`,
    `${names.origin}: manual`,
    `${names.source}: ""`,
    `${names.confidence}: 50`,
    `${names.recall}: not_tested`,
    `${names.explanation}: not_tested`,
    `${names.procedure}: not_tested`,
    `${names.transfer}: not_tested`,
    `${names.retention}: not_tested`,
    `${names.calibration}: "0/0 (—) · 0 high-conf errors"`,
    "---",
    "",
    `## ${labels[0]}`,
    "",
    "> ",
    "",
    `## ${labels[1]}`,
    "",
    "> ",
    "",
  ];
  return lines.join("\n");
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 32) return true;
  }
  return false;
}

export function cleanFolder(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .map(part => part.trim())
    .filter(part => part.length > 0 && part !== ".");
  if (parts.some(part => part === ".." || hasControlChar(part) || /[<>:"|?*]/.test(part))) return "";
  return parts.join("/");
}

export function coreTemplatesFolder(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? cleanFolder((parsed as Record<string, unknown>).folder)
      : "";
  } catch {
    return "";
  }
}

export function resolveTemplateFolder(configured: unknown, coreFolder: unknown): string {
  return cleanFolder(configured) || cleanFolder(coreFolder) || DEFAULT_TEMPLATE_FOLDER;
}

export interface TemplatePlan {
  create: Array<{ kind: TemplateKind; path: string }>;
  skip: string[];
}

export function planTemplateFiles(folder: string, existing: Iterable<string>): TemplatePlan {
  const have = new Set<string>();
  for (const path of existing) have.add(path.toLowerCase());
  const plan: TemplatePlan = { create: [], skip: [] };
  for (const kind of ["topic", "inbox"] as const) {
    const path = folder ? `${folder}/${TEMPLATE_FILES[kind]}` : TEMPLATE_FILES[kind];
    if (have.has(path.toLowerCase())) plan.skip.push(path);
    else plan.create.push({ kind, path });
  }
  return plan;
}

export function isInTemplateFolder(path: string, folder: string): boolean {
  const clean = cleanFolder(folder).toLowerCase();
  return clean.length > 0 && path.toLowerCase().startsWith(`${clean}/`);
}

const headerPattern = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m;
const metadataMarker = /^<!-- curiosity-learning:v1 /;

export function initializeTemplateNote(markdown: string, names: PropNames, today: string, newId: string): string | null {
  const match = headerPattern.exec(markdown);
  if (!match || match.index !== 0) return null;
  const rawFrontmatter = match[2];
  if (/\{\{[^}]+\}\}/.test(rawFrontmatter)) return null;
  if (readTopic(markdown)) return null;
  const body = markdown.slice(match[0].length);
  if (metadataMarker.test(body)) return null;
  const yaml = parseDocument(rawFrontmatter);
  if (yaml.errors.length > 0 || !isMap(yaml.contents)) return null;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = yaml.toJS({ maxAliasCount: 100 });
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return null;
  }
  if (!isLearning(data) || data.type !== "learning") return null;

  const str = (key: string): string => typeof data[key] === "string" ? data[key].trim() : "";
  const rawCreated = str(names.created);
  const created = validDate(rawCreated) ? rawCreated : today;
  const rawUpdated = str(names.updated);
  const updated = validDate(rawUpdated) ? rawUpdated : created;
  const rawStatus = str(names.status);
  const state: Topic["cl_state"] = rawStatus === "captured" || rawStatus === "exploring" ||
    rawStatus === "building" || rawStatus === "demonstrated_in_context" || rawStatus === "review_due" ||
    rawStatus === "needs_reassessment" || rawStatus === "archived" ? rawStatus : "exploring";
  const rawConfidence = Number(data[names.confidence]);
  const confidence: Confidence = rawConfidence === 70 || rawConfidence === 90 ? rawConfidence : 50;
  const rawPrereq = data[names.prereq];
  const prereq = Array.isArray(rawPrereq) ? rawPrereq.filter((item): item is string => typeof item === "string") : [];

  const topic: Topic = {
    cl_schema: 1,
    cl_kind: "learning",
    cl_id: newId,
    cl_state: state,
    cl_goal: str(names.goal),
    cl_prereq: prereq,
    cl_created: created,
    cl_updated: updated,
    cl_review_due: validDate(str(names.review)) ? str(names.review) : "",
    cl_origin: str(names.origin) === "capture" ? "browser-capture" : "manual",
    cl_source_url: str(names.source),
    cl_prior_confidence: confidence,
    cl_axes: emptyRubric(),
    cl_calibration: emptyCalibration(),
  };

  const eol = match[1].endsWith("\r\n") ? "\r\n" : "\n";
  const flat = flatProperties(topic, names);
  for (const [key, value] of Object.entries(flat)) {
    if (!yaml.has(key) || data[key] === "" || data[key] === null || data[key] === undefined) {
      yaml.set(key, value);
    }
  }
  const serialized = yaml.toString({ lineWidth: 0 }).trimEnd();
  const result = "---" + eol + serialized + eol + "---" + eol + topicMetadata(topic, names, eol) + body;
  return readTopic(result) ? result : null;
}
