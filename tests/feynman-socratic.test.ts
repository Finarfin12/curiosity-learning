import { test, expect } from "vitest";
import { analyzeExplanation } from "../src/domain/feynman/analyzer";
import { controls, questionFor } from "../src/domain/questions/staticProvider";

test("KT-05: flags short, non-causal explanations and excludes evidence callouts", () => {
  expect(analyzeExplanation("Metakognisi dan ATP")).toMatchObject({ score: 1, source: "rule_checked",
    flags: { short: true, causal: true, jargon: true } });
  const text = "Penyebut perlu disamakan karena setiap bagian harus punya ukuran yang sama sebelum kita dapat menjumlahkan banyaknya bagian pada kedua pecahan.";
  expect(analyzeExplanation(text + "\n\n> [!cl-evidence] References\n> ATP RNA KPK").score).toBe(2);
});

test("KT-05: each turn has exactly one prompt and three hints; control actions do not score", () => {
  for (const language of ["id", "en"] as const) {
    expect(questionFor(language, 0).question.match(/\?/g)).toHaveLength(1);
    expect(questionFor(language, 0).hints).toHaveLength(3);
    expect(questionFor(language, 1)).not.toEqual(questionFor(language, 0));
  }
  expect(controls("hint", 3)).toEqual({ mode: "test", hint: 3 });
  expect(controls("explain", 2)).toEqual({ mode: "teach", hint: 0 });
  expect(controls("skip", 2)).toEqual({ mode: "exit", hint: 0 });
  expect(controls("stop", 2)).toEqual({ mode: "exit", hint: 0 });
});
