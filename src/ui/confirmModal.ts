import { Modal, type App } from "obsidian";

export class ConfirmModal extends Modal {
  private decided = false;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly body: string,
    private readonly cancelLabel: string,
    private readonly confirmLabel: string,
    private readonly onResult: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    this.contentEl.createEl("p", { text: this.body });
    const actions = this.contentEl.createDiv({ cls: "cl-actions" });
    const cancel = actions.createEl("button", { text: this.cancelLabel, attr: { type: "button" } });
    const confirm = actions.createEl("button", { text: this.confirmLabel, cls: "mod-cta", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.finish(false));
    confirm.addEventListener("click", () => this.finish(true));
  }

  private finish(confirmed: boolean): void {
    if (this.decided) return;
    this.decided = true;
    this.close();
    this.onResult(confirmed);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) {
      this.decided = true;
      this.onResult(false);
    }
  }
}
