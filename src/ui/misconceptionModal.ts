import { Modal, Notice, Setting } from "obsidian";
import { appendCallouts, callout, parseCallouts } from "../domain/callout";
import { localDate } from "../domain/dates";
import { patchTopic } from "../domain/frontmatter";
import type LearningPlugin from "../main";
import { action, field } from "./forms";

export class MisconceptionModal extends Modal {
  private highOnly = false;
  private revision = 0;
  constructor(private readonly plugin: LearningPlugin) { super(plugin.app); }

  onOpen() {
    this.modalEl.addClass("cl-modal-wide");
    this.setTitle(this.plugin.labels.ledger);
    this.refresh();
  }

  private refresh() {
    void this.render().catch(() => new Notice(this.plugin.labels.failed));
  }

  private async render() {
    const revision = ++this.revision;
    const tr = this.plugin.labels;
    const items = await this.plugin.controller.list();
    if (revision !== this.revision) return;
    this.contentEl.empty();
    new Setting(this.contentEl).setName(tr.onlyHigh).addToggle(toggle =>
      toggle.setValue(this.highOnly).onChange(value => { this.highOnly = value; this.refresh(); }));
    let count = 0;
    for (const item of items) {
      for (const block of parseCallouts(item.body)) {
        if (block.type !== "misconception" || (this.highOnly && !/90%|high_confidence_error: true/i.test(block.title + block.body))) continue;
        count += 1;
        new Setting(this.contentEl).setName(item.topic.cl_goal).setHeading();
        this.contentEl.createEl("p", { text: block.title });
        this.contentEl.createEl("p", { text: block.body, cls: "cl-text" });
        if (!/^status: open$/m.test(block.body)) continue;
        const correction = field(this.contentEl, tr.correction, true);
        action(this.contentEl, tr.save, async () => {
          if (!correction.value.trim()) { new Notice(tr.required); return; }
          await this.plugin.controller.change(item, content => patchTopic(content,
            { cl_updated: localDate() }, body => {
              const current = parseCallouts(body).find(entry => entry.type === "misconception" &&
                entry.title === block.title && entry.body === block.body);
              if (!current) throw new Error("Misconception changed");
              const updated = current.body.replace(/^status: open$/m, "status: corrected");
              const replacement = callout("misconception", current.title, updated);
              const next = body.slice(0, current.start) + replacement.replace(/\n/g, body.includes("\r\n") ? "\r\n" : "\n") +
                body.slice(current.end);
              return appendCallouts(next, callout("feedback", tr.correction + " · " + current.title, correction.value.trim()));
            }));
          this.refresh();
        }, tr);
      }
    }
    if (!count) this.contentEl.createEl("p", { text: tr.noErrors });
  }

  onClose() { this.revision += 1; this.contentEl.empty(); }
}
