import { Modal, Notice } from "obsidian";
import { captureLimits, validateCapture, type Capture } from "../domain/captureValidator";
import { parseCaptureMarkdown } from "../domain/captureMarkdown";
import type LearningPlugin from "../main";
import { action, dropdown, field } from "./forms";

export class CaptureConfirmModal extends Modal {
  constructor(private readonly plugin: LearningPlugin, private readonly capture?: Capture) { super(plugin.app); }

  onOpen() {
    this.modalEl.addClass("cl-modal-wide");
    const tr = this.plugin.labels;
    this.setTitle(this.capture ? tr.confirmCapture : tr.importCapture);
    if (!this.capture) {
      const text = field(this.contentEl, tr.pasteCapture, true);
      text.maxLength = 35_000;
      action(this.contentEl, tr.previewCapture, () => {
        const capture = parseCaptureMarkdown(text.value);
        if (!capture) { new Notice(tr.invalidCapture); return; }
        this.close();
        this.plugin.previewCapture(capture);
      }, tr, true);
      return;
    }
    const capture = this.capture;
    const fields = {
      title: field(this.contentEl, tr.captureTitle),
      url: field(this.contentEl, "URL"),
      selection: field(this.contentEl, tr.selection, true),
      question: field(this.contentEl, tr.question, true),
      prior_guess: field(this.contentEl, tr.guess, true),
    };
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      fields[key].maxLength = captureLimits[key];
      fields[key].value = capture[key];
    }
    const confidence = dropdown(this.contentEl, tr.confidence, { 50: "50%", 70: "70%", 90: "90%" });
    confidence.value = String(capture.confidence);
    this.contentEl.createEl("p", { text: this.plugin.settings.inbox });
    action(this.contentEl, tr.saveCapture, async () => {
      const edited = validateCapture({
        ...capture, ...Object.fromEntries(Object.entries(fields).map(([key, control]) => [key, control.value])),
        confidence: confidence.value,
      });
      if (!edited) { new Notice(tr.invalidCapture); return; }
      if (!this.plugin.captureHandler.canOpen(edited.capture_id)) { new Notice(tr.duplicateCapture); return; }
      const file = await this.plugin.captureHandler.save(edited);
      this.close();
      await this.app.workspace.getLeaf(false).openFile(file);
    }, tr, true);
  }

  onClose() { this.contentEl.empty(); }
}
