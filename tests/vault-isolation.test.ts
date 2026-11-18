import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { App, TFile, Vault } from "obsidian";
import { test, expect } from "vitest";
import { topicFiles } from "../src/adapter/topicIndex";
import { writeTopic } from "../src/adapter/noteWriter";
import { readTopic } from "../src/domain/frontmatter";
import { saveAttempt, saveExplanation, saveReview } from "../src/domain/session";
import { day } from "./helpers";

test("KT-01: indexes seven learning notes; leaves 13 unrelated notes byte-identical", async () => {
  const directory = new URL("../test-vault/Fixtures/", import.meta.url);
  const files = readdirSync(directory).map(path => ({ path } as TFile));
  const input = new Map(files.map(file => [file.path, readFileSync(new URL(file.path, directory), "utf8")]));
  const contents = new Map(input);
  const vault = {
    getMarkdownFiles: () => files,
    process: async (file: TFile, fn: (content: string) => string) => {
      await Promise.resolve();
      const result = fn(contents.get(file.path)!);
      contents.set(file.path, result);
      return result;
    },
  } as unknown as Vault;
  const app = { vault, metadataCache: {
    getFileCache: (file: TFile) => ({ frontmatter: file.path === "07.md" ?
      { cl_kind: "learning", type: "idea" } : readTopic(input.get(file.path)!)?.topic }),
  } } as unknown as App;
  const learning = topicFiles(app);
  expect(files).toHaveLength(20);
  expect(learning).toHaveLength(7);
  for (const file of files) {
    const note = readTopic(input.get(file.path)!);
    if (!note) {
      await expect(writeTopic(vault, file, "collision", () => "overwritten")).rejects.toThrow();
      continue;
    }
    await writeTopic(vault, file, note.topic.cl_id, text => saveExplanation(text, "Penjelasan", 2, day));
    await writeTopic(vault, file, note.topic.cl_id, text => saveAttempt(text, {
      mode: "post", prompt: "Soal", answer: "Jawaban", confidence: 70, correct: true,
      axis: "procedure", cardId: "card", day, id: true,
    }));
    await writeTopic(vault, file, note.topic.cl_id, text => saveReview(text, "card", 0, 3, 70, day).content);
    expect(contents.get(file.path)).toContain("[!cl-review]");
  }
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const other = files.filter(file => !learning.includes(file));
  expect(other).toHaveLength(13);
  for (const file of other) expect(hash(contents.get(file.path)!)).toBe(hash(input.get(file.path)!));
});
