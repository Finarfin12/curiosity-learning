import { ItemView, Notice, Setting, type WorkspaceLeaf } from "obsidian";
import type { IndexedTopic } from "../adapter/topicIndex";
import { summarize } from "../domain/calibration";
import { parseCallouts } from "../domain/callout";
import { localDate } from "../domain/dates";
import { nextStrategy } from "../domain/strategyRouter";
import { axes, type Axis } from "../domain/types";
import type LearningPlugin from "../main";
import { renderPrerequisites } from "./prerequisites";
import { action } from "./forms";

export const VIEW = "curiosity-learning-queue";
let viewCount = 0;

export class LearningQueueView extends ItemView {
  private readonly viewId = ++viewCount;
  private revision = 0;
  private selectedId = "";
  constructor(leaf: WorkspaceLeaf, private readonly plugin: LearningPlugin) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return this.plugin.labels.title; }
  getIcon() { return "brain"; }

  async onOpen() {
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.refresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.refresh()));
    await this.render();
  }

  refresh() {
    void this.render().catch(() => new Notice(this.plugin.labels.failed));
  }

  private async render() {
    const revision = ++this.revision;
    const tr = this.plugin.labels;
    const items = await this.plugin.controller.list();
    if (revision !== this.revision) return;
    const root = this.contentEl;
    root.empty();
    root.addClass("cl-queue");
    new Setting(root).setName(tr.title).setHeading();
    const controls = root.createDiv({ cls: "cl-actions" });
    action(controls, tr.start, () => this.plugin.start(), tr, true);
    action(controls, tr.ledger, () => this.plugin.ledger(), tr);
    action(controls, tr.due + " · " + this.plugin.controller.due(items).length, () => this.plugin.reviews(), tr);
    if (!items.length) { root.createEl("p", { text: tr.empty }); return; }
    const selected = items.find(item => item.topic.cl_id === this.selectedId) ?? items[0];
    this.selectedId = selected.topic.cl_id;
    const list = root.createEl("ul", { cls: "cl-topics" });
    for (const item of items) {
      const button = action(list.createEl("li"), item.topic.cl_goal || item.file.basename, () => {
        this.selectedId = item.topic.cl_id;
        this.refresh();
      }, tr);
      button.setAttribute("aria-pressed", String(item === selected));
    }
    this.renderTopic(root, selected, items);
  }

  private renderTopic(root: HTMLElement, item: IndexedTopic, items: IndexedTopic[]) {
    const tr = this.plugin.labels;
    const topic = item.topic;
    new Setting(root).setName(topic.cl_goal || item.file.basename).setHeading();
    const controls = root.createDiv({ cls: "cl-actions" });
    action(controls, tr.open, () => this.app.workspace.getLeaf(false).openFile(item.file), tr);
    action(controls, tr.diagnose, () => this.plugin.diagnose(item), tr);
    renderPrerequisites(root, this.plugin, item, items);
    const strategy = nextStrategy(topic, localDate());
    root.createEl("p", { text: tr.next + " · " + tr[strategy] });
    const grid = root.createDiv({ cls: "cl-axes" });
    for (const axis of Object.keys(axes) as Axis[]) {
      const value = topic.cl_axes[axis];
      const box = grid.createDiv();
      box.createEl("strong", { text: axes[axis] + " · " + tr[axis] });
      box.createEl("span", { text: (value.score === "not_tested" ? "—" : value.score + "/3") + " · " + tr[value.source] });
    }
    const map = summarize(topic.cl_calibration);
    new Setting(root).setName(tr.map).setHeading();
    root.createEl("p", { text: tr[map.status] + " · " + topic.cl_calibration.high_conf_errors + " × ⚠" });
    for (const bucket of map.buckets) {
      const caption = bucket.confidence + "% · " + (bucket.accuracy === null ? tr.noData :
        bucket.accuracy + "% (" + bucket.correct + "/" + bucket.total + ")");
      const label = root.createEl("p", { text: caption });
      label.id = "cl-bucket-" + this.viewId + "-" + bucket.confidence;
      const bar = root.createEl("meter", { attr: { min: "0", max: "100",
        value: String(bucket.accuracy ?? 0), "aria-valuetext": caption, title: caption } });
      bar.setAttribute("aria-labelledby", label.id);
    }
    const latest = parseCallouts(item.body).filter(block => block.type === "feedback" &&
      /^(Uji lagi|Post-test)$/i.test(block.title)).pop();
    if (latest) {
      new Setting(root).setName(tr.comparison).setHeading();
      root.createEl("p", { text: latest.body, cls: "cl-text" });
    }
  }

  async onClose() { this.revision += 1; }
}
