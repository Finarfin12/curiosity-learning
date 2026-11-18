import { Modal, Notice, Setting } from "obsidian";
import type { IndexedTopic } from "../adapter/topicIndex";
import { appendCallouts } from "../domain/callout";
import { localDate } from "../domain/dates";
import { evidenceBlock, manualEvidence, normalizeDoi, sources, webUrl,
  type Citation, type Evidence } from "../domain/evidenceVerifier";
import { patchTopic } from "../domain/frontmatter";
import type LearningPlugin from "../main";
import { action, dropdown, field } from "./forms";

export class EvidenceModal extends Modal {
  private closed = false;

  constructor(private readonly plugin: LearningPlugin, private readonly item: IndexedTopic) {
    super(plugin.app);
  }

  onOpen() {
    this.closed = false;
    const tr = this.plugin.labels;
    this.setTitle(tr.findSources);
    const root = this.contentEl;
    const keywords = field(root, tr.keywords);
    keywords.maxLength = 300;
    const provider = dropdown(root, tr.provider, Object.fromEntries(sources.map(source => [source, source])));
    const notice = root.createEl("p", { text: this.plugin.settings.enableScholarlySearch ? tr.consentHelp : tr.searchOff });
    notice.setAttribute("aria-live", "polite");
    const results = root.createDiv();
    const search = action(root, tr.approveSearch, async () => {
      if (!this.plugin.settings.enableScholarlySearch) { notice.setText(tr.searchOff); return; }
      const q = keywords.value.trim();
      if (!q) { new Notice(tr.required); return; }
      const source = sources.find(option => option === provider.value);
      if (!source) return;
      results.empty();
      notice.setText(tr.searching);
      try {
        const matches = await this.plugin.scholarly.search(source, q, this.plugin.settings.language, true);
        if (this.closed) return;
        notice.setText(matches.length ? tr.searchResults : tr.noSources);
        for (const result of matches) this.showResult(results, result);
      } catch { if (!this.closed) notice.setText(tr.providerFailed); }
    }, tr, true);
    results.insertAdjacentElement("beforebegin", search);
    search.disabled = !this.plugin.settings.enableScholarlySearch;
    this.renderManual(root);
  }

  private renderManual(root: HTMLElement) {
    const tr = this.plugin.labels;
    new Setting(root).setName(tr.manualSource).setHeading();
    const title = field(root, tr.citationTitle);
    title.maxLength = 300;
    const doi = field(root, "DOI");
    doi.maxLength = 300;
    const url = field(root, "URL");
    url.maxLength = 2048;
    const manualResults = root.createDiv();
    const fields = (): Citation | null => {
      const citation = { title: title.value.trim(), doi: normalizeDoi(doi.value), url: webUrl(url.value) };
      if (!citation.title || (doi.value.trim() && !citation.doi) || (url.value.trim() && !citation.url)) {
        new Notice(tr.invalidCitation);
        return null;
      }
      return citation;
    };
    const controls = root.createDiv({ cls: "cl-actions" });
    manualResults.insertAdjacentElement("beforebegin", controls);
    const verify = action(controls, tr.approveVerify, async () => {
      if (!this.plugin.settings.enableScholarlySearch) { new Notice(tr.searchOff); return; }
      const citation = fields();
      if (!citation) return;
      if (!citation.doi && !citation.url) { new Notice(tr.requireIdentifier); return; }
      manualResults.empty();
      const result = await this.plugin.scholarly.verify(citation, true);
      if (!this.closed) this.showResult(manualResults, result);
    }, tr);
    verify.disabled = !this.plugin.settings.enableScholarlySearch;
    action(controls, tr.saveUnverified, async () => {
      const citation = fields();
      if (citation) await this.insert(manualEvidence(citation));
    }, tr);
  }

  private showResult(parent: HTMLElement, evidence: Evidence) {
    const tr = this.plugin.labels;
    const result = parent.createDiv({ cls: "cl-evidence-result" });
    result.createEl("strong", { text: evidence.title });
    result.createEl("p", { text: [evidence.source, evidence.year, ...(evidence.authors ?? [])].filter(Boolean).join(" · ") });
    result.createEl("p", { text: evidence.verification + " · " + tr[evidence.tier] });
    const reference = evidence.doi || evidence.url;
    if (reference) result.createEl("p", { text: reference, cls: "cl-text" });
    if (evidence.tier === "tertiary_wiki") result.createEl("p", { text: tr.tertiaryNote });
    action(result, tr.insertEvidence, () => this.insert(evidence), tr);
  }

  private async insert(evidence: Evidence) {
    const tr = this.plugin.labels;
    const day = localDate();
    await this.plugin.controller.change(this.item, content => patchTopic(content, { cl_updated: day },
      body => appendCallouts(body, evidenceBlock(evidence, day, tr.tertiaryNote))));
    new Notice(tr.done);
    this.close();
  }

  onClose() { this.closed = true; this.contentEl.empty(); }
}
