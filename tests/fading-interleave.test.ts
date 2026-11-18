import { expect, test } from "vitest";
import { parseWorkedExample, visibleExample } from "../src/domain/fading";
import { readTopic } from "../src/domain/frontmatter";
import { interleave } from "../src/domain/interleave";
import { controls, questionFor } from "../src/domain/questions/staticProvider";
import { recordEvidence } from "../src/domain/rubric";
import { nextStrategy } from "../src/domain/strategyRouter";
import { day, sample } from "./helpers";

test("KT-09: fading hides only the last step, then all worked steps", () => {
  const example = parseWorkedExample("independent_problem: 2/3 + 1/4\nFind a common denominator\nRewrite fractions\nSum numerators");
  expect(visibleExample(example, 1).steps).toEqual(["Find a common denominator", "Rewrite fractions", "Sum numerators"]);
  expect(visibleExample(example, 2)).toEqual({ steps: ["Find a common denominator", "Rewrite fractions"], missingLast: true, problem: "" });
  expect(visibleExample(example, 3)).toEqual({ steps: [], missingLast: false, problem: "2/3 + 1/4" });
  expect(parseWorkedExample("Existing lesson")).toEqual({ steps: ["Existing lesson"], independentProblem: "" });
});

test("KT-09: recommends Devil’s advocate only after the explanation threshold; manual prompts always work", () => {
  const topic = readTopic(sample())!.topic;
  topic.cl_state = "building";
  topic.cl_axes = recordEvidence(topic.cl_axes, "procedure", 2, "self_reported", day);
  topic.cl_axes = recordEvidence(topic.cl_axes, "explanation", 1, "rule_checked", day);
  expect(nextStrategy(topic, day)).not.toBe("devil");
  expect(questionFor("id", 0, "devil").question).toContain("bantahan");
  expect(questionFor("en", 0, "devil").question).toContain("objection");
  expect(controls("explain", 2)).toEqual({ mode: "teach", hint: 0 });
  topic.cl_axes = recordEvidence(topic.cl_axes, "explanation", 2, "rule_checked", day);
  expect(nextStrategy(topic, day)).toBe("devil");
});

test("KT-09: alternates topics while possible, preserves all cards and uses randomness", () => {
  const cards = ["A1", "A2", "A3", "B1", "B2", "C1"];
  const topic = (card: string) => card[0];
  const mixed = interleave(cards, topic, () => 0);
  expect(mixed).not.toEqual(cards);
  expect([...mixed].sort()).toEqual(cards);
  for (let i = 1; i < mixed.length; i += 1) expect(topic(mixed[i])).not.toBe(topic(mixed[i - 1]));
  expect(interleave(cards, topic, () => 0.99)).not.toEqual(mixed);
  expect(interleave(["A1", "A2", "A3", "B1"], topic, () => 0, "A")).toEqual(["B1", "A1", "A2", "A3"]);
});
test("a multiline independent problem stays separate from worked steps", () => {
  const example = parseWorkedExample("independent_problem: Explain this change.\nindependent_problem_cont: Include a counterexample.\nStep one\nStep two");
  expect(example.independentProblem).toBe("Explain this change.\nInclude a counterexample.");
  expect(visibleExample(example, 1).steps).toEqual(["Step one", "Step two"]);
});
