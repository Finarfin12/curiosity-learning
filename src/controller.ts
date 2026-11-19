import type { App } from "obsidian";
import { loadTopics, type IndexedTopic } from "./adapter/topicIndex";
import { writeTopic } from "./adapter/noteWriter";
import { readCards } from "./domain/cards";
import { localDate } from "./domain/dates";
import { saveReview } from "./domain/session";
import type { Rating } from "./domain/fsrs";
import type { Confidence } from "./domain/types";

export class LearningController {
  constructor(readonly app: App, private readonly exclude?: (path: string) => boolean) {}

  list() {
    return loadTopics(this.app, this.exclude);
  }

  change(item: IndexedTopic, transform: (content: string) => string) {
    return writeTopic(this.app.vault, item.file, item.topic.cl_id, transform);
  }

  due(items: IndexedTopic[], day = localDate()) {
    return items.filter(item => item.topic.cl_state !== "archived").flatMap(item =>
      readCards(item.body, item.topic.cl_created).map(({ card }) => ({ item, card }))
        .filter(({ card }) => card.due <= day)).sort((a, b) => a.card.due.localeCompare(b.card.due));
  }

  async review(entry: DueEntry, rating: Rating, confidence: Confidence) {
    let outcome: ReturnType<typeof saveReview>["result"] | undefined;
    await this.change(entry.item, content => {
      const updated = saveReview(content, entry.card.id, entry.card.reps, rating, confidence, localDate());
      outcome = updated.result;
      return updated.content;
    });
    if (!outcome) throw new Error("Review was not saved");
    return outcome;
  }
}

export type DueEntry = ReturnType<LearningController["due"]>[number];
