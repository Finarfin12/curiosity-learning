import type { TFile, Vault } from "obsidian";
import { readTopic } from "../domain/frontmatter";

export function writeTopic(vault: Vault, file: TFile, id: string, transform: (content: string) => string) {
  return vault.process(file, content => {
    if (readTopic(content)?.topic.cl_id !== id) throw new Error("Learning note changed");
    return transform(content);
  });
}
