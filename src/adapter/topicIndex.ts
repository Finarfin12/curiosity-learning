import type { App, TFile } from "obsidian";
import { isLearning, readTopic } from "../domain/frontmatter";

export function topicFiles(app: App): TFile[] {
  return app.vault.getMarkdownFiles().filter(file =>
    isLearning(app.metadataCache.getFileCache(file)?.frontmatter));
}

export async function loadTopic(app: App, file: TFile) {
  const note = readTopic(await app.vault.cachedRead(file));
  return note && { file, ...note };
}

export async function loadTopics(app: App) {
  const topics = await Promise.all(topicFiles(app).map(file => loadTopic(app, file)));
  return topics.filter(topic => topic !== null);
}

export type IndexedTopic = NonNullable<Awaited<ReturnType<typeof loadTopic>>>;
