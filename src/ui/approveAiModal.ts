import { Modal, type App } from "obsidian";
import type { AiAction, AiOutputs, PreparedAi } from "../domain/ai/types";
import type { Labels } from "../i18n/en";
import { action } from "./forms";

export interface AiResultView {
  score?: number;
  sections: { label: string; text: string }[];
}

export class ApproveAiModal<K extends AiAction> extends Modal {
  private closed = false;
  constructor(app: App, private readonly tr: Labels, private readonly purpose: string,
    private readonly prepared: PreparedAi<K>, private readonly send: () => Promise<AiOutputs[K] | null>,
    private readonly summarize: (result: AiOutputs[K]) => AiResultView,
    private readonly apply: (result: AiOutputs[K]) => void | Promise<void>) { super(app); }

  onOpen() {
    this.closed = false;
    this.modalEl.addClass("cl-modal-wide");
    this.setTitle(this.tr.approveAi);
    const root = this.contentEl;
    const tr = this.tr;
    const preview = this.prepared.preview;
    root.createEl("p", { text: tr.aiPreviewHelp });
    const context = root.createEl("dl", { cls: "cl-ai-context" });
    this.detail(context, tr.provider, this.prepared.provider.label);
    this.detail(context, tr.aiAction, this.purpose);
    this.detail(context, tr.language, preview.language);
    this.detail(context, tr.goal, preview.goal);
    this.detail(context, tr.question, preview.question);
    if (preview.axis) this.detail(context, tr.aiTestedAxis, tr[preview.axis]);
    if (preview.mode) this.detail(context, tr.diagnose, tr[preview.mode]);
    if (preview.answer) this.detail(context, tr.answer, preview.answer, true);
    if (preview.explanation) this.detail(context, tr.explanation, preview.explanation, true);
    if (preview.gap) this.detail(context, tr.aiGap, preview.gap);
    for (const source of preview.sources ?? []) {
      this.detail(context, tr.aiSource + " " + source.id + " · " + source.title, source.excerpt, true);
    }
    const technical = root.createEl("details");
    technical.createEl("summary", { text: tr.aiInstructions });
    technical.createEl("pre", { cls: "cl-ai-preview", text: this.prepared.prompt.system });
    technical.createEl("pre", { cls: "cl-ai-preview", text: JSON.stringify(preview, null, 2) });
    const status = root.createEl("p", { attr: { "aria-live": "polite" } });
    const buttons = root.createDiv({ cls: "cl-actions cl-ai-actions" });
    action(buttons, tr.sendAi, async () => {
      status.setText(tr.aiThinking);
      const result = await this.send();
      if (!this.closed) this.renderResult(result);
    }, tr, true);
    action(buttons, tr.cancelAi, () => this.close(), tr);
  }

  private detail(list: HTMLElement, label: string, text: string, quote = false) {
    if (!text) return;
    const item = list.createDiv();
    item.createEl("dt", { text: label });
    const value = item.createEl("dd", { cls: "cl-text" });
    if (quote) value.createEl("blockquote", { text, cls: "cl-quote-box" });
    else value.setText(text);
  }

  private renderResult(result: AiOutputs[K] | null) {
    const tr = this.tr;
    const root = this.contentEl;
    root.empty();
    this.setTitle(tr.aiResult);
    if (result) {
      const view = this.summarize(result);
      if (view.score !== undefined) root.createEl("p", { text: view.score + "/3", cls: "cl-ai-score" });
      const sections = root.createEl("dl", { cls: "cl-ai-context" });
      for (const section of view.sections) this.detail(sections, section.label, section.text, true);
    } else {
      root.createEl("p", { text: tr.aiFallback, attr: { role: "status" } });
    }
    const actions = root.createDiv({ cls: "cl-actions cl-ai-actions" });
    if (result) action(actions, tr.useAi, async () => {
      await this.apply(result);
      this.close();
    }, tr, true);
    action(actions, tr.cancelAi, () => this.close(), tr);
  }

  onClose() { this.closed = true; this.contentEl.empty(); }
}
