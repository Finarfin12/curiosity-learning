import { expect, test } from "vitest";
import { readTopic } from "../src/domain/frontmatter";
import { defaultNames, parseNames } from "../src/domain/learningProperties";
import {
  cleanFolder,
  coreTemplatesFolder,
  DEFAULT_TEMPLATE_FOLDER,
  initializeTemplateNote,
  isInTemplateFolder,
  planTemplateFiles,
  resolveTemplateFolder,
  TEMPLATE_FILES,
  templateContent,
} from "../src/domain/templateFiles";
import { day } from "./helpers";

test("cleanFolder and resolveTemplateFolder sanitize paths and prefer plugin setting over core Templates", () => {
  expect(cleanFolder("  Templates/Learning/ ")).toBe("Templates/Learning");
  expect(cleanFolder("../escape")).toBe("");
  expect(cleanFolder("bad:name")).toBe("");
  expect(coreTemplatesFolder('{"folder":"My Templates"}')).toBe("My Templates");
  expect(coreTemplatesFolder("not json")).toBe("");
  expect(resolveTemplateFolder("Custom", "My Templates")).toBe("Custom");
  expect(resolveTemplateFolder("", "My Templates")).toBe("My Templates");
  expect(resolveTemplateFolder("", "")).toBe(DEFAULT_TEMPLATE_FOLDER);
});

test("planTemplateFiles skips existing files case-insensitively and never overwrites", () => {
  const existing = [`templates/${TEMPLATE_FILES.topic.toLowerCase()}`];
  const plan = planTemplateFiles("Templates", existing);
  expect(plan.skip).toEqual([`Templates/${TEMPLATE_FILES.topic}`]);
  expect(plan.create).toEqual([{ kind: "inbox", path: `Templates/${TEMPLATE_FILES.inbox}` }]);
  expect(isInTemplateFolder("Templates/Curiosity Learning Topic.md", "templates")).toBe(true);
  expect(isInTemplateFolder("Learning/Topics/Fractions.md", "Templates")).toBe(false);
});

test("templateContent respects language and custom property names", () => {
  const custom = parseNames({ ...defaultNames, goal: "objective", status: "stage" })!;
  const enTopic = templateContent("topic", custom, "en");
  expect(enTopic).toContain("type: learning");
  expect(enTopic).toContain("stage: exploring");
  expect(enTopic).toContain('objective: ""');
  expect(enTopic).toContain("created: {{date:YYYY-MM-DD}}");
  expect(enTopic).toContain("## My question");

  const idInbox = templateContent("inbox", defaultNames, "id");
  expect(idInbox).toContain("status: captured");
  expect(idInbox).toContain("## Pertanyaanku");
  expect(idInbox).toContain("## Dugaan awal");
});

test("initializeTemplateNote activates a note created from a template and ignores unresolved or non-learning notes", () => {
  const rawTemplate = templateContent("topic", defaultNames, "en");
  expect(initializeTemplateNote(rawTemplate, defaultNames, day, "tpl-1")).toBeNull();

  const resolvedFromTemplate = rawTemplate
    .replaceAll("{{date:YYYY-MM-DD}}", day)
    .replace('goal: ""', 'goal: "Understand gravity"');
  const initialized = initializeTemplateNote(resolvedFromTemplate, defaultNames, day, "tpl-1");
  expect(initialized).not.toBeNull();
  const parsed = readTopic(initialized!);
  expect(parsed?.topic).toMatchObject({
    cl_id: "tpl-1",
    cl_state: "exploring",
    cl_goal: "Understand gravity",
    cl_created: day,
    cl_prior_confidence: 50,
  });

  // Calling again is a no-op (no write loop).
  expect(initializeTemplateNote(initialized!, defaultNames, day, "tpl-2")).toBeNull();

  // Non-learning note is untouched.
  const seedbedNote = "---\ntype: idea\nstatus: seed\n---\n\nAn idea.\n";
  expect(initializeTemplateNote(seedbedNote, defaultNames, day, "tpl-3")).toBeNull();
});
