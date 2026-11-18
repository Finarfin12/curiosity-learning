import { stringify } from "yaml";
import { readTopic } from "../src/domain/frontmatter";
import { createTopic } from "../src/domain/templates";

export const day = "2026-11-18";
export function sample() {
  const created = createTopic({ goal: "Pecahan senilai", question: "Mengapa 1/2 + 1/3 bukan 2/5?",
    guess: "1/2 + 1/3 = 2/5", confidence: 90 }, day, "topic-1", "id");
  const legacy = readTopic(created)!;
  return "---\n" + stringify(legacy.topic) + "---\n" + legacy.body;
}
