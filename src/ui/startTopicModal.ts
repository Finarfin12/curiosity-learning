import { Modal, Notice } from "obsidian";
import { makeTopic } from "../adapter/noteFactory";
import { splitPrereqs } from "../domain/prereqGraph";
import type LearningPlugin from "../main";
import { action, confidenceInput, dropdown, field } from "./forms";

export class StartTopicModal extends Modal {
  constructor(private readonly plugin: LearningPlugin) { super(plugin.app); }

  onOpen() {
    this.modalEl.addClass("cl-modal-wide");
    const tr = this.plugin.labels;
    this.setTitle(tr.start);
    const goal = field(this.contentEl, tr.goal);
    const question = field(this.contentEl, tr.question);
    const guess = field(this.contentEl, tr.guess, true);
    const prereq = field(this.contentEl, tr.prereqInput, true);
    const confidence = confidenceInput(this.contentEl, tr);
    const location = dropdown(this.contentEl, tr.folders, { active: tr.active, inbox: tr.captured });
    action(this.contentEl, tr.save, async () => {
      const chosen = confidence();
      if (!chosen || !goal.value.trim() || !question.value.trim() || !guess.value.trim()) {
        new Notice(tr.required);
        return;
      }
      const folder = location.value === "inbox" ? this.plugin.settings.inbox : this.plugin.settings.topics;
      const file = await makeTopic(this.app.vault, folder, {
        goal: goal.value.trim(), question: question.value.trim(), guess: guess.value.trim(), confidence: chosen, prereq: splitPrereqs(prereq.value),
      }, this.plugin.settings.language, location.value === "inbox", this.plugin.settings.propNames);
      this.close();
      await this.app.workspace.getLeaf(false).openFile(file);
    }, tr, true);
  }

  onClose() { this.contentEl.empty(); }
}
