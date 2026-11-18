import { Modal, Notice, Setting } from "obsidian";
import type { IndexedTopic } from "../adapter/topicIndex";
import { saveAiEvaluation, saveAiTeaching } from "../domain/ai/learningAiService";
import type { AiAction, AiAxis, AiOutputs, LearningContext, PreparedAi } from "../domain/ai/types";
import { ApproveAiModal, type AiResultView } from "./approveAiModal";
import { appendCallouts, callout, parseCallouts } from "../domain/callout";
import { localDate } from "../domain/dates";
import { analyzeExplanation } from "../domain/feynman/analyzer";
import { parseWorkedExample, visibleExample, type HelpLevel } from "../domain/fading";
import { patchTopic, readTopic } from "../domain/frontmatter";
import { controls, questionFor } from "../domain/questions/staticProvider";
import { saveAttempt, saveExplanation } from "../domain/session";
import { initialAnswers } from "../domain/templates";
import type LearningPlugin from "../main";
import { PrereqEditor, renderPrerequisites } from "./prerequisites";
import { action, confidenceInput, dropdown, field } from "./forms";

type Tab = "teach" | "feynman" | "socratic" | "post" | "devil" | "evidence";

export class DiagnoseModal extends Modal {
  private tab: Tab;
  private turn = 0;
  private help: HelpLevel = 1;
  private busy = false;
  private generation = 0;

  constructor(private readonly plugin: LearningPlugin, private item: IndexedTopic, tab: Tab = "teach") {
    super(plugin.app);
    this.tab = tab;
  }

  onOpen() {
    this.modalEl.addClass("cl-modal-wide");
    this.setTitle(this.plugin.labels.diagnose);
    this.render();
  }

  private render() {
    const tr = this.plugin.labels;
    const { question, guess } = initialAnswers(this.item.body, this.item.topic.cl_origin === "browser-capture");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: question || this.item.topic.cl_goal });
    const prereqs = this.contentEl.createDiv();
    if (this.item.topic.cl_prereq?.length) {
      void this.plugin.controller.list().then(items => {
        if (prereqs.isConnected) renderPrerequisites(prereqs, this.plugin, this.item, items);
      }).catch(() => new Notice(tr.failed));
    }
    action(prereqs, tr.editPrereqs, () => new PrereqEditor(this.plugin, this.item, content => {
      const updated = readTopic(content);
      if (updated) { this.item = { file: this.item.file, ...updated }; this.render(); }
    }).open(), tr);
    const tabs = this.contentEl.createDiv({ cls: "cl-actions" });
    for (const tab of ["teach", "feynman", "socratic", "post", "evidence", "devil"] as const) {
      const button = action(tabs, tr[tab], () => {
        if (!this.busy) { this.tab = tab; this.render(); }
      }, tr, tab === this.tab);
      button.setAttribute("aria-pressed", String(tab === this.tab));
    }
    const pane = this.contentEl.createDiv();
    if (this.tab === "teach") {
      this.renderTeach(pane);
      return;
    }
    if (this.tab === "evidence") {
      for (const block of parseCallouts(this.item.body).filter(block => block.type === "evidence")) {
        new Setting(pane).setName(block.title).setHeading();
        pane.createEl("p", { text: block.body, cls: "cl-text" });
      }
      action(pane, tr.findSources, () => {
        this.close();
        this.plugin.evidence(this.item);
      }, tr, true);
      return;
    }
    const mode = this.tab;
    const probe = questionFor(this.plugin.settings.language, this.turn, mode === "devil" ? "devil" : "socratic");
    if (mode === "post") pane.createEl("p", { text: tr.postHelp });
    const answers = pane.createDiv({ cls: mode === "post" ? "cl-comparison" : "" });
    if (mode === "post") {
      const before = answers.createDiv();
      before.createEl("strong", { text: tr.before + " (" + this.item.topic.cl_prior_confidence + "%)" });
      before.createEl("p", { text: guess, cls: "cl-text" });
    }
    let activeQuestion = probe.question;
    const diagnostic = mode === "socratic" || mode === "devil";
    const probeText = diagnostic ? answers.createEl("p", { text: activeQuestion }) : null;
    if (probeText) action(pane, tr.aiDiagnostic, () => {
      const latest = parseCallouts(this.item.body)
        .filter(block => block.type === "probe" && /^Feynman · /.test(block.title)).pop();
      const explanation = latest?.body.split(/\n\nE: /)[0] ?? "";
      const gap = explanation ? Object.entries(analyzeExplanation(explanation).flags)
        .filter(([, flagged]) => flagged).map(([name]) => name).join(", ") : "";
      this.askAi("diagnostic", tr.aiDiagnostic, { question, explanation, gap, mode: mode === "devil" ? "devil" : "socratic" },
        output => ({ sections: [{ label: tr.question, text: output.question }] }), output => {
          activeQuestion = output.question;
          probeText.setText(tr.optionalAi + " · " + activeQuestion);
        });
    }, tr);
    if (mode === "feynman") answers.createEl("p", { text: tr.feynmanHelp });
    const answer = field(answers, mode === "post" ? tr.after : tr.answer, true);
    if (mode === "feynman") answer.addClass("cl-textarea-long");
    const feedback = pane.createEl("p", { attr: { "aria-live": "polite" } });
    this.addControls(pane, feedback, probe.hints);
    if (mode === "feynman") {
      this.addAiEvaluation(pane, () => question, () => answer.value, () => "explanation");
      action(pane, tr.save, async () => {
        const explanation = analyzeExplanation(answer.value);
        await this.persist(answer.value, content =>
          saveExplanation(content, answer.value.trim(), explanation.score, localDate()), () => {
          const flags = Object.entries(explanation.flags).filter(([, active]) => active)
            .map(([key]) => tr[key as keyof typeof explanation.flags]);
          feedback.setText("E " + explanation.score + "/3 · " + (flags.join(" ") || tr.noFlags));
        });
      }, tr, true);
      return;
    }
    const confidence = confidenceInput(pane, tr);
    const result = dropdown(pane, tr.result, { "": tr.choose, yes: tr.correct, no: tr.incorrect });
    const initial = mode === "post" && !/^> initial_assessed: true$/m.test(this.item.body)
      ? dropdown(pane, tr.initial, { "": tr.choose, yes: tr.correct, no: tr.incorrect }) : null;
    const axis = mode === "post" ? dropdown(pane, tr.practice, { procedure: tr.procedure, transfer: tr.transfer, recall: tr.recall }) : null;
    const prompt = mode === "post" ? field(pane, tr.question) : null;
    const testedAxis = (): AiAxis => {
      if (mode === "devil" || axis?.value === "transfer") return "transfer";
      return axis?.value === "recall" ? "recall" : "procedure";
    };
    if (prompt) {
      prompt.value = question;
      action(pane, tr.aiEquivalent, () => this.askAi("equivalent", tr.aiEquivalent, { question: prompt.value },
        output => ({ sections: [{ label: tr.question, text: output.problem }] }), output => { prompt.value = output.problem; }), tr);
    }
    const testedQuestion = () => prompt ? prompt.value.trim() : activeQuestion;
    this.addAiEvaluation(pane, testedQuestion, () => answer.value, testedAxis);
    action(pane, tr.save, async () => {
      const chosen = confidence();
      if (!chosen || !result.value || (prompt && !prompt.value.trim())) { new Notice(tr.required); return; }
      await this.persist(answer.value, content => saveAttempt(content, {
        mode, answer: answer.value.trim(), confidence: chosen, correct: result.value === "yes",
        initialCorrect: initial?.value ? initial.value === "yes" : undefined,
        axis: testedAxis(),
        cardId: this.contentEl.win.crypto.randomUUID(), day: localDate(), id: this.plugin.settings.language === "id",
        prompt: testedQuestion(),
      }), () => {
        if (mode === "post") this.close();
        else { this.turn += 1; this.render(); }
      });
    }, tr, true);
  }

  private renderTeach(pane: HTMLElement) {
    const tr = this.plugin.labels;
    const latest = parseCallouts(this.item.body).filter(block => block.type === "teach").pop();
    const example = parseWorkedExample(latest?.body ?? "");
    if (this.help === 1) {
      const sources = parseCallouts(this.item.body).filter(block => block.type === "evidence" &&
        /^verification: verified_(?:doi|url)$/m.test(block.body)).slice(-3).map(block => ({
        title: block.title, excerpt: block.body.split("\n").filter(line => !/^(?:URL|DOI):/.test(line)).join("\n"),
        url: /^(?:DOI|URL): (https?:\S+)$/m.exec(block.body)?.[1],
      }));
      action(pane, tr.aiTeach, () => this.askAi("teach", tr.aiTeach, { sources },
        result => ({ sections: [{ label: tr.explanation, text: result.explanation },
          { label: tr.workedExample, text: result.steps.map((step, index) => (index + 1) + ". " + step).join("\n") },
          { label: tr.independentProblem, text: result.problem }] }),
        (result, prepared) => this.persist(result.explanation,
          content => saveAiTeaching(content, result, prepared.sources, localDate(), tr.aiTeachingLabel),
          () => this.render())), tr);
      if (example.explanation) pane.createEl("p", { text: tr.aiTeachingLabel + " · " + example.explanation, cls: "cl-text" });
    }
    const level = dropdown(pane, tr.workedExample, { 1: tr.fullExample, 2: tr.fadedExample, 3: tr.independentExample });
    level.value = String(this.help);
    level.addEventListener("change", () => {
      if (this.busy) { level.value = String(this.help); return; }
      this.help = level.value === "3" ? 3 : level.value === "2" ? 2 : 1;
      this.render();
    });
    const visible = visibleExample(example, this.help);
    if (visible.steps.length || visible.missingLast) {
      const list = pane.createEl("ol");
      for (const step of visible.steps) list.createEl("li", { text: step });
      if (visible.missingLast) list.createEl("li", { text: tr.completeStep });
    }
    if (this.help === 1) {
      const steps = field(pane, tr.exampleSteps, true);
      steps.addClass("cl-textarea-long");
      steps.value = example.steps.join("\n");
      const problem = field(pane, tr.independentProblem, true);
      problem.value = example.independentProblem;
      action(pane, tr.save, () => this.persist(steps.value, content => {
        const current = readTopic(content)?.topic;
        const problemLines = problem.value.trim().split(/\r?\n/);
        const problemBlock = problemLines.map((line, index) =>
          (index === 0 ? "independent_problem: " : "independent_problem_cont: ") + line).join("\n");
        const input = problemBlock + "\n" + steps.value.trim();
        return patchTopic(content, { cl_updated: localDate(), cl_state:
          current?.cl_state === "captured" ? "exploring" : current?.cl_state ?? "exploring" },
        body => appendCallouts(body, callout("teach", tr.workedExample, input)));
      }, () => this.render()), tr, true);
      return;
    }
    if ((this.help === 2 && !visible.missingLast) || (this.help === 3 && !visible.problem)) {
      pane.createEl("p", { text: tr.exampleNeeded });
      return;
    }
    if (visible.problem) pane.createEl("p", { text: visible.problem });
    const answer = field(pane, this.help === 2 ? tr.completeStep : tr.answer, true);
    const label = this.help === 2 ? tr.fadedExample : tr.independentExample;
    action(pane, tr.savePractice, () => this.persist(answer.value, content => patchTopic(content,
      { cl_updated: localDate() }, body => appendCallouts(body, callout("probe", label,
        (visible.problem ? visible.problem + "\n\n" : "") + answer.value.trim()))),
    () => { answer.value = ""; }), tr, true);
  }

  private addAiEvaluation(pane: HTMLElement, question: () => string, answer: () => string, axis: () => AiAxis) {
    const tr = this.plugin.labels;
    action(pane, tr.aiEvaluate, () => {
      const response = answer().trim();
      const assessed = axis();
      if (this.plugin.settings.ai.provider !== "off" && (!response || !question().trim())) {
        new Notice(tr.required);
        return;
      }
      this.askAi("evaluate", tr.aiEvaluate + " · " + tr[assessed], { question: question(), answer: response, axis: assessed },
        result => ({ score: result.score, sections: [{ label: tr.aiFeedback, text: result.feedback },
          { label: tr.aiGap, text: result.gap_hypothesis }] }),
        result => this.persist(response, content =>
          saveAiEvaluation(content, assessed, result, localDate(), tr.aiFeedbackLabel), () => this.render()));
    }, tr);
  }

  private askAi<K extends AiAction>(kind: K, purpose: string, context: Partial<LearningContext>,
    summarize: (output: AiOutputs[K]) => AiResultView,
    apply: (output: AiOutputs[K], prepared: PreparedAi<K>) => void | Promise<void>) {
    const tr = this.plugin.labels;
    const settings = this.plugin.settings.ai;
    if (settings.provider === "off") { new Notice(tr.aiOffHelp); return; }
    if (this.busy) return;
    const generation = this.generation;
    const key = this.plugin.getAiKey();
    const prepared = this.plugin.ai.prepare(kind, {
      goal: this.item.topic.cl_goal, question: initialAnswers(this.item.body,
        this.item.topic.cl_origin === "browser-capture").question,
      language: this.plugin.settings.language, ...context,
    });
    if (!prepared) { new Notice(tr.aiSetup); return; }
    new ApproveAiModal(this.app, tr, purpose, prepared,
      () => this.plugin.settings.ai === settings && this.plugin.getAiKey() === key && generation === this.generation
        ? this.plugin.ai.send(prepared, true) : Promise.resolve(null),
      summarize, result => {
        if (generation === this.generation) return apply(result, prepared);
      }).open();
  }

  private addControls(pane: HTMLElement, feedback: HTMLElement, hints: string[]) {
    let hint = 0;
    const tr = this.plugin.labels;
    const buttons = pane.createDiv({ cls: "cl-actions" });
    for (const key of ["explain", "hint", "skip", "stop"] as const) {
      action(buttons, tr[key], () => {
        if (this.busy) return;
        const state = controls(key, hint);
        hint = state.hint;
        if (state.mode === "teach") { this.tab = "teach"; this.help = 1; this.render(); }
        else if (state.mode === "exit") this.close();
        else feedback.setText(hints[hint - 1]);
      }, tr);
    }
  }

  private async persist(value: string, transform: (content: string) => string, onSave: () => void) {
    if (!value.trim()) { new Notice(this.plugin.labels.required); return; }
    if (this.busy) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const content = await this.plugin.controller.change(this.item, transform);
      const note = readTopic(content);
      if (note) this.item = { file: this.item.file, ...note };
      new Notice(this.plugin.labels.done);
      if (generation === this.generation) onSave();
    } finally { this.busy = false; }
  }

  onClose() { this.generation += 1; this.contentEl.empty(); }
}
