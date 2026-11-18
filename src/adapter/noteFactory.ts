import { TFolder, normalizePath, type Vault } from "obsidian";
import { localDate } from "../domain/dates";
import { uniqueBase } from "../domain/captureValidator";
import type { PropNames } from "../domain/learningProperties";
import { createTopic, type TopicInput } from "../domain/templates";

export function folderPath(value: string): string | null {
  const parts = value.trim().split(/[\\/]/);
  if (parts.some(part => !part || part === "." || part === ".." ||
      /[<>:"|?*]/.test(part) || Array.from(part).some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(part))) return null;
  return normalizePath(parts.join("/"));
}

export async function ensureFolder(vault: Vault, folder: string) {
  const path = folderPath(folder);
  if (!path) throw new Error("Invalid folder");
  let current = "";
  for (const segment of path.split("/")) {
    current = current ? current + "/" + segment : segment;
    if (!vault.getAbstractFileByPath(current)) {
      try { await vault.createFolder(current); }
      catch (error) { if (!(vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; }
    }
    if (!(vault.getAbstractFileByPath(current) instanceof TFolder)) throw new Error("Path already exists as a file");
  }
  return path;
}

export async function makeTopic(vault: Vault, folder: string, input: TopicInput, language: "id" | "en",
    captured = false, names?: PropNames) {
  const path = await ensureFolder(vault, folder);
  const id = activeWindow.crypto.randomUUID();
  return vault.create(path + "/" + uniqueBase(input.question, id) + ".md",
    createTopic(input, localDate(), id, language, captured, names));
}
