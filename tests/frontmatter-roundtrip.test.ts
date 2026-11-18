import { test, expect } from "vitest";
import { appendCallouts, callout, calloutTypes, parseCallouts } from "../src/domain/callout";
import { patchTopic, readTopic } from "../src/domain/frontmatter";
import { saveExplanation } from "../src/domain/session";
import { day, sample } from "./helpers";

test("KT-02: preserves custom YAML, comments, CRLF and arbitrary body text", () => {
  const custom = "tags: [one, two] # keep\naliases:\n  - A\nmy_custom_field: &shared {nested: true}\ncopy: *shared\n";
  const before = sample().replace(/^---\n/, "---\n" + custom).replace(/\n/g, "\r\n") + "\r\nFree paragraph.\r\n";
  const updated = saveExplanation(before, "A response", 3, day);
  expect(updated).toContain(custom.replace(/\n/g, "\r\n"));
  expect(readTopic(updated)?.body.startsWith(readTopic(before)!.body)).toBe(true);
  expect(readTopic(updated)?.topic.cl_axes.explanation.score).toBe(3);
  expect(() => patchTopic("Free text\n---\ncl_kind: learning\n---\n", {})).toThrow();
});

test("KT-02: rewrites scalar and nested managed values without touching following user keys", () => {
  const input = sample().replace("cl_goal: Pecahan senilai", "cl_goal: |\n  A multiline goal\ncustom: preserve");
  const revised = patchTopic(input, { cl_goal: "New goal\nSecond line" });
  expect(readTopic(revised)?.topic.cl_goal).toBe("New goal\nSecond line");
  expect(revised).toContain("custom: preserve");
});

test("KT-02: all seven callout types round trip and fenced examples are ignored", () => {
  const example = "~~~md\n> [!cl-card] example\n~~~\n";
  const body = appendCallouts(example, ...calloutTypes.map(type => callout(type, "Title", "First\n\nLast")));
  const blocks = parseCallouts(body);
  expect(blocks.map(block => block.type)).toEqual(calloutTypes);
  for (const block of blocks) expect(block.body).toBe("First\n\nLast");
});
