import { expect, test } from "vitest";
import { CaptureHandler } from "../src/adapter/captureHandler";
import { captureMarkdown, parseCaptureMarkdown } from "../src/domain/captureMarkdown";
import { captureUri, validateCapture } from "../src/domain/captureValidator";
import { migrateProperties, patchTopic, readTopic } from "../src/domain/frontmatter";
import { defaultNames, parseNames } from "../src/domain/learningProperties";
import { prerequisites, splitPrereqs, type PrereqTarget } from "../src/domain/prereqGraph";
import { saveExplanation } from "../src/domain/session";
import { createTopic } from "../src/domain/templates";
import { day, sample } from "./helpers";

const fields = { v: "1", capture_id: "fixture-1", title: "A page", url: "https://example.com/a",
  selection: "First line\nSecond line", question: "Why? [Example]", prior_guess: "Less than <5", confidence: "90" };
const capture = validateCapture(fields)!;

test("KT-10: wikilink aliases and paths find learning prerequisites, without treating ambiguous or missing notes as ready", () => {
  const graph: PrereqTarget[] = [
    { path: "Topics/Equivalent.md", basename: "Equivalent", goal: "Equivalent Fractions", state: "demonstrated_in_context" },
    { path: "Topics/Addition.md", basename: "Addition", goal: "Addition", state: "needs_reassessment" },
    { path: "Inbox/Addition.md", basename: "Addition", goal: "Alternate", state: "building" },
  ];
  const refs = splitPrereqs("[[Topics/Equivalent#Section|Fractions]]\n Equivalent Fractions\n[[Topics/Addition]]\nOther\nAddition\nOther");
  expect(prerequisites(refs, graph, "Main.md").map(item => item.status)).toEqual(
    ["ready", "ready", "untested", "missing", "ambiguous"]);
});

test("KT-10: blocks unsafe URL, traversal, controls, XSS, oversized data, and missing fields", () => {
  for (const bad of [
    { url: "javascript:alert(1)" }, { url: "https://example.com/%2e%2e%2fsecret" },
    { title: "../../note" }, { capture_id: "..\\anything" }, { selection: "x".repeat(2501) },
    { question: "" }, { selection: "a\u0000b" }, { title: "<img src=x onerror=alert(1)>" },
    { prior_guess: "\u202efake" }, { v: "2" }, { confidence: "95" },
  ]) expect(validateCapture({ ...fields, ...bad })).toBeNull();
  expect(validateCapture({ ...fields, confidence: undefined, prior_guess: undefined })?.confidence).toBe(50);
  expect(new URL(captureUri(capture)).searchParams.get("question")).toBe(fields.question);
  expect(captureUri(capture)).toContain("title=A%20page");
});

test("KT-10: confirmed captures are create-only and duplicates are suppressed during saves and across reloads", async () => {
  const notes = new Map<string, string>();
  let recent = Array.from({ length: 200 }, (_, i) => "earlier-" + i);
  const target = {
    folder: () => Promise.resolve("Learning/Inbox"),
    exists: (path: string) => notes.has(path),
    create: (path: string, content: string) => { notes.set(path, content); return Promise.resolve(path); },
  };
  const handler = () => new CaptureHandler(target, () => recent, ids => { recent = ids; },
    () => defaultNames, () => "fixture-uuid");
  const controller = handler();
  expect(controller.canOpen(capture.capture_id)).toBe(true);
  expect(notes.size).toBe(0);
  const pending = controller.save(capture);
  await expect(controller.save({ ...capture, title: "Another title" })).rejects.toThrow("duplicate");
  const path = await pending;
  expect(path).toBe("Learning/Inbox/A page - fixture-1.md");
  expect(recent).toHaveLength(200);
  await expect(handler().save(capture)).rejects.toThrow("duplicate");
  expect(readTopic(notes.get(path)!)?.topic).toMatchObject({
    cl_kind: "learning", cl_state: "captured", cl_origin: "browser-capture", cl_capture_id: capture.capture_id,
  });
});

test("KT-10: capture fallback is a complete learning note and imports only captured fields", () => {
  const text = captureMarkdown(capture, day, "id");
  expect(text).toMatch(/^---\ntype: learning\n/);
  expect(text).toContain("origin: capture");
  expect(text).not.toContain("cl_axes:");
  expect(parseCaptureMarkdown(text)).toEqual(capture);
  expect(parseCaptureMarkdown(sample())).toBeNull();
  const embedded = captureMarkdown({ ...capture, selection: "![[remote]] & <b>" }, day, "id");
  expect(embedded).toContain("!&#91;&#91;remote&#93;&#93; &amp; &lt;b&gt;");
});

test("KT-10: legacy properties migrate in place, custom keys and user body survive, and flat properties remain editable", () => {
  const legacy = sample().replace(/^---\n/, "---\ntags: [keep]\ncustom: anchored\n") + "\nFree prose.\n";
  const names = parseNames({ goal: "learning goal" })!;
  const old = readTopic(legacy)!;
  const migrated = migrateProperties(legacy, names);
  const revised = saveExplanation(migrated, "Explanation", 2, day);
  expect(migrated).toContain("type: learning");
  expect(migrated).toContain("learning goal: Pecahan senilai");
  expect(migrated).toContain("tags: [ keep ]");
  expect(migrated).toContain("custom: anchored");
  expect(readTopic(migrated)?.body).toBe(old.body);
  expect(migrated).not.toContain("cl_axes:");
  expect(readTopic(revised)?.topic.cl_axes.explanation).toEqual({ score: 2, source: "rule_checked", updated: day });
  expect(revised).toContain('explanation: "2 (rule)"');
  expect(readTopic(patchTopic(revised, { cl_prereq: ["[[A]]"] }))?.topic.cl_prereq).toEqual(["[[A]]"]);
  expect(() => migrateProperties(legacy.replace("custom: anchored", "goal: User content"), defaultNames)).toThrow("collision");
  expect(() => migrateProperties(legacy.replace("custom: anchored", "type: idea"), defaultNames)).toThrow("Unsupported");
  expect(readTopic("---\ntype: learning\n---\nUnrelated note.")).toBeNull();
  expect(parseNames({ status: "type" })).toBeNull();
});

test("KT-10: new topics use default flat properties and read back the prerequisite list", () => {
  const note = createTopic({ goal: "B", question: "B?", guess: "B", confidence: 70, prereq: ["[[A]]"] }, day, "b", "en");
  expect(readTopic(note)).toMatchObject({ legacy: false, topic: { cl_id: "b", cl_prereq: ["[[A]]"] } });
  expect(note).toContain("recall: not_tested");
  expect(note).not.toMatch(/^cl_/m);
});
