import { Modal, Notice, Setting, type App } from "obsidian";
import type { DueEntry, LearningController } from "../controller";
import { interleave } from "../domain/interleave";
import type { Rating } from "../domain/fsrs";
import type { Labels } from "../i18n/en";
import { action, confidenceInput, labelControl } from "./forms";

export class FSRSReviewModal extends Modal {
  private mixed = false;
  private lastTopic?: string;
  private closed = false;
  constructor(app: App, private readonly controller: LearningController,
    private queue: DueEntry[], private readonly tr: Labels) { super(app); }

  onOpen() { this.closed = false; this.setTitle(this.tr.review); this.render(); }

  private render() {
    const tr = this.tr;
    this.contentEl.empty();
    const topic = (entry: DueEntry) => entry.item.file.path;
    const entry = this.mixed ? interleave(this.queue, topic, Math.random, this.lastTopic)[0] : this.queue[0];
    if (!entry) {
      this.contentEl.createEl("p", { text: tr.reviewDone });
      return;
    }
    const mixing = new Setting(this.contentEl).setName(tr.interleave);
    mixing.addToggle(control => {
      labelControl(mixing, control.toggleEl);
      control.setValue(this.mixed).onChange(value => {
        this.mixed = value;
        this.render();
        this.contentEl.querySelector<HTMLElement>('[role="checkbox"]')?.focus();
      });
    });
    this.contentEl.createEl("p", { text: tr.due + " · " + this.queue.length });
    this.contentEl.createEl("p", { text: entry.card.question, cls: "cl-text" });
    const confidence = confidenceInput(this.contentEl, tr);
    action(this.contentEl, tr.reveal, () => {
      const chosen = confidence();
      if (!chosen) { new Notice(tr.required); return; }
      this.contentEl.empty();
      this.contentEl.createEl("p", { text: entry.card.question, cls: "cl-text" });
      this.contentEl.createEl("p", { text: entry.card.answer, cls: "cl-text" });
      this.contentEl.createEl("p", { text: tr.confidence + " · " + chosen + "%" });
      const buttons = this.contentEl.createDiv({ cls: "cl-actions" });
      const labels = [tr.again, tr.hard, tr.good, tr.easy];
      let saving = false;
      for (const rating of [1, 2, 3, 4] as Rating[]) {
        action(buttons, labels[rating - 1], async () => {
          if (saving) return;
          saving = true;
          try {
            const result = await this.controller.review(entry, rating, chosen);
            this.lastTopic = topic(entry);
            this.queue = this.queue.filter(item => item !== entry);
            if (result.relearning) this.queue.push({ ...entry, card: result.next });
            if (!this.closed) this.render();
          } finally { saving = false; }
        }, tr);
      }
    }, tr, true);
  }

  onClose() { this.closed = true; this.contentEl.empty(); }
}
