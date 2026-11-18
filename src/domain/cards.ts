import { callout, parseCallouts } from "./callout";
import { validDate } from "./dates";
import type { Card } from "./fsrs";

export function cardBlock(card: Card): string {
  const title = [card.id, "due: " + card.due, "state: " + card.state, "S: " + card.stability,
    "D: " + card.difficulty, "reps: " + card.reps, "lapses: " + card.lapses, "created: " + card.created,
    "last_review: " + card.last_review, "elapsed_days: " + card.elapsed_days,
    "scheduled_days: " + card.scheduled_days].join(" | ");
  return callout("card", title, "**Q:** " + card.question + "\n**A:** " + card.answer);
}

export function readCards(body: string, created: string) {
  return parseCallouts(body).flatMap(block => {
    if (block.type !== "card") return [];
    const [id, ...parts] = block.title.split(" | ");
    const fields = new Map(parts.map(part => {
      const colon = part.indexOf(":");
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    }));
    const qa = /^\*\*Q:\*\* ([\s\S]*?)\n\*\*A:\*\* ([\s\S]+)$/.exec(block.body);
    const due = fields.get("due") ?? "";
    const cardCreated = fields.get("created") ?? created;
    const last_review = fields.get("last_review") ?? "";
    const state = fields.get("state");
    if (!id || !qa || !validDate(due) || !validDate(cardCreated) ||
        (last_review && !validDate(last_review)) ||
        (state !== "new" && state !== "review" && state !== "relearning")) return [];
    const number = (key: string) => Math.max(0, Number(fields.get(key)) || 0);
    const card: Card = {
      id, question: qa[1], answer: qa[2], due, created: cardCreated, last_review, state,
      stability: number("S"), difficulty: number("D"), reps: number("reps"), lapses: number("lapses"),
      elapsed_days: number("elapsed_days"), scheduled_days: number("scheduled_days"),
    };
    return [{ card, block }];
  });
}
