import { Modal } from "obsidian";
import type { IndexedTopic } from "../adapter/topicIndex";
import { localDate } from "../domain/dates";
import { patchTopic } from "../domain/frontmatter";
import { prerequisites, splitPrereqs } from "../domain/prereqGraph";
import type LearningPlugin from "../main";
import { action, field } from "./forms";

export function renderPrerequisites(parent: HTMLElement, plugin: LearningPlugin, item: IndexedTopic, items: IndexedTopic[]) {
  const tr = plugin.labels;
  const graph = items.map(({ file, topic }) => ({
    path: file.path, basename: file.basename, goal: topic.cl_goal, state: topic.cl_state,
  }));
  const checks = prerequisites(item.topic.cl_prereq ?? [], graph, item.file.path);
  if (!checks.length) return;
  const list = parent.createEl("ul", { cls: "cl-prereqs" });
  for (const check of checks) {
    const row = list.createEl("li");
    row.createSpan({ text: (check.status === "ready" ? tr.prereqReady :
      check.status === "missing" ? tr.prereqMissing : check.status === "ambiguous" ? tr.prereqAmbiguous :
        tr.prereqUntested) + " · " + check.reference,
    cls: check.status === "ready" ? "cl-prereq-ready" : "cl-prereq-warn" });
    const linked = items.find(candidate => candidate.file.path === check.target?.path);
    if (linked) action(row, tr.open + " · " + (linked.topic.cl_goal || linked.file.basename),
      () => plugin.app.workspace.getLeaf(false).openFile(linked.file), tr);
  }
}

export class PrereqEditor extends Modal {
  constructor(private readonly plugin: LearningPlugin, private readonly item: IndexedTopic,
    private readonly afterSave: (content: string) => void) { super(plugin.app); }

  onOpen() {
    this.modalEl.addClass("cl-modal-wide");
    const tr = this.plugin.labels;
    this.setTitle(tr.editPrereqs);
    const input = field(this.contentEl, tr.prereqInput, true);
    input.value = (this.item.topic.cl_prereq ?? []).join("\n");
    action(this.contentEl, tr.save, async () => {
      const content = await this.plugin.controller.change(this.item, current => patchTopic(current,
        { cl_prereq: splitPrereqs(input.value), cl_updated: localDate() }));
      this.close();
      this.afterSave(content);
    }, tr, true);
  }

  onClose() { this.contentEl.empty(); }
}
