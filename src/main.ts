import { Notice, Platform, Plugin, SuggestModal, type TFile } from "obsidian";
import { makeAiProvider } from "./adapter/ai/factory";
import { obsidianAiHttp } from "./adapter/ai/obsidianHttp";
import { desktopCli } from "./adapter/ai/runner";
import { LearningAiService } from "./domain/ai/learningAiService";
import { defaultAi, normalizeAi, type AiSettings } from "./domain/ai/types";
import { ScholarlyApi, type ScholarlySettings } from "./adapter/scholarlyApi";
import { obsidianHttp } from "./adapter/obsidianHttp";
import { EvidenceModal } from "./ui/evidenceModal";
import { CaptureHandler } from "./adapter/captureHandler";
import { CaptureConfirmModal } from "./ui/captureConfirmModal";
import { validateCapture, type Capture } from "./domain/captureValidator";
import { defaultNames, parseNames, type PropNames } from "./domain/learningProperties";
import { migrateProperties } from "./domain/frontmatter";
import { ensureFolder, folderPath } from "./adapter/noteFactory";
import { loadTopic, type IndexedTopic } from "./adapter/topicIndex";
import { LearningController } from "./controller";
import { localDate } from "./domain/dates";
import { nextStrategy } from "./domain/strategyRouter";
import { en } from "./i18n/en";
import { id } from "./i18n/id";
import { DiagnoseModal } from "./ui/diagnoseModal";
import { FSRSReviewModal } from "./ui/fsrsReviewModal";
import { MisconceptionModal } from "./ui/misconceptionModal";
import { LearningQueueView, VIEW } from "./ui/queueView";
import { LearningSettingTab } from "./ui/settingsTab";
import { StartTopicModal } from "./ui/startTopicModal";

interface SecretStorageCompat {
  getSecret(id: string): string | null;
  setSecret(id: string, value: string): void;
}

interface Settings extends ScholarlySettings { language: "id" | "en"; inbox: string; topics: string; propNames: PropNames; recentCaptureIds: string[]; ai: AiSettings }
const defaults: Settings = {
  language: "en", inbox: "Learning/Inbox", topics: "Learning/Topics",
  propNames: defaultNames, recentCaptureIds: [], ai: defaultAi,
  enableScholarlySearch: false, scholarlyMailto: "", openAlexApiKey: "", semanticScholarApiKey: "",
};

export default class LearningPlugin extends Plugin {
  settings: Settings = { ...defaults };
  controller!: LearningController;
  captureHandler!: CaptureHandler<TFile>;
  private readonly aiKeys = new Map<string, string>();
  readonly aiDependencies = { http: obsidianAiHttp, cli: Platform.isDesktopApp ? desktopCli() : undefined };
  readonly ai = new LearningAiService(() => makeAiProvider(this.settings.ai, this.aiDependencies, this.getAiKey()),
    () => [this.getAiKey(), this.settings.openAlexApiKey, this.settings.semanticScholarApiKey]);
  private settingsWrite = Promise.resolve();
  readonly scholarly = new ScholarlyApi(obsidianHttp, () => this.settings);
  get labels() { return this.settings.language === "id" ? id : en; }

  async onload() {
    const data = await this.loadData() as Partial<Settings> | null;
    this.settings = {
      ai: normalizeAi(data?.ai),
      propNames: parseNames(data?.propNames) ?? defaultNames,
      recentCaptureIds: Array.isArray(data?.recentCaptureIds) ? data.recentCaptureIds.filter(id => typeof id === "string").slice(0, 200) : [],
      enableScholarlySearch: data?.enableScholarlySearch === true,
      scholarlyMailto: typeof data?.scholarlyMailto === "string" ? data.scholarlyMailto : "",
      openAlexApiKey: typeof data?.openAlexApiKey === "string" ? data.openAlexApiKey : "",
      semanticScholarApiKey: typeof data?.semanticScholarApiKey === "string" ? data.semanticScholarApiKey : "",
      language: data?.language === "id" ? "id" : "en",
      inbox: typeof data?.inbox === "string" ? folderPath(data.inbox) ?? defaults.inbox : defaults.inbox,
      topics: typeof data?.topics === "string" ? folderPath(data.topics) ?? defaults.topics : defaults.topics,
    };
    this.controller = new LearningController(this.app);
    const vault = this.app.vault;
    this.captureHandler = new CaptureHandler({
      folder: () => ensureFolder(vault, this.settings.inbox),
      exists: path => Boolean(vault.getAbstractFileByPath(path)),
      create: (path, content) => vault.create(path, content),
    }, () => this.settings.recentCaptureIds, ids => {
      this.settings.recentCaptureIds = ids;
      this.run(() => this.saveSettings());
    }, () => this.settings.propNames, () => activeWindow.crypto.randomUUID());
    this.registerObsidianProtocolHandler("curiosity-capture", params => {
      const capture = validateCapture(params);
      if (capture) this.previewCapture(capture);
      else new Notice(this.labels.invalidCapture);
    });
    this.registerView(VIEW, leaf => new LearningQueueView(leaf, this));
    this.addSettingTab(new LearningSettingTab(this));
    this.addRibbonIcon("brain", this.labels.queue, () => this.run(() => this.queue()));
    this.addLearningCommands();
  }

  addLearningCommands() {
    const commands = {
      queue: () => this.queue(), start: () => this.start(), diagnose: () => this.pick(item => this.diagnose(item)),
      importCapture: () => new CaptureConfirmModal(this).open(),
      migrate: () => this.pick(item => this.run(async () => {
        await this.controller.change(item, content => migrateProperties(content, this.settings.propNames));
        new Notice(this.labels.done);
      })),
      findSources: () => this.pick(item => this.evidence(item)),
      review: () => this.reviews(), ledger: () => this.ledger(),
    };
    for (const key of Object.keys(commands) as (keyof typeof commands)[]) {
      this.removeCommand(key);
      this.addCommand({ id: key, name: this.labels[key], callback: () => this.run(commands[key]) });
    }
    this.app.workspace.getLeavesOfType(VIEW).forEach(leaf => {
      if (leaf.view instanceof LearningQueueView) leaf.view.refresh();
    });
  }

  private run(fn: () => void | Promise<void>) {
    void Promise.resolve().then(fn).catch(() => new Notice(this.labels.failed));
  }

  async queue() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW)[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (leaf.view.getViewType() !== VIEW) await leaf.setViewState({ type: VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private keySlot() {
    const { api, apiUrl } = this.settings.ai;
    const route = api === "openai" ? apiUrl || "https://api.openai.com" : api;
    const encoded = Array.from(route).map(char => char.codePointAt(0)?.toString(16)).join("-");
    return "curiosity-learning-" + api + "-" + encoded;
  }

  private get keyStorage() {
    // Obsidian 1.11.4 added this API. Older compatible hosts use the session map.
    const host = this.app as unknown as { secretStorage?: SecretStorageCompat };
    return host.secretStorage;
  }

  getAiKey(): string {
    if (this.settings.ai.provider !== "api") return "";
    const slot = this.keySlot();
    return this.keyStorage?.getSecret(slot) ?? this.aiKeys.get(slot) ?? "";
  }

  setAiKey(value: string) {
    const slot = this.keySlot();
    this.aiKeys.set(slot, value);
    this.keyStorage?.setSecret(slot, value);
  }

  saveSettings() {
    const snapshot = { ...this.settings };
    const write = this.settingsWrite.catch(() => undefined).then(() => this.saveData(snapshot));
    this.settingsWrite = write;
    return write;
  }

  previewCapture(capture: Capture) {
    if (!this.captureHandler.canOpen(capture.capture_id)) { new Notice(this.labels.duplicateCapture); return; }
    new CaptureConfirmModal(this, capture).open();
  }
  start() { new StartTopicModal(this).open(); }
  ledger() { new MisconceptionModal(this).open(); }

  diagnose(item: IndexedTopic) {
    const recommendation = nextStrategy(item.topic, localDate());
    new DiagnoseModal(this, item, recommendation === "review" ? "post" : recommendation).open();
  }

  evidence(item: IndexedTopic) { new EvidenceModal(this, item).open(); }

  async reviews() {
    const queue = this.controller.due(await this.controller.list());
    new FSRSReviewModal(this.app, this.controller, queue, this.labels).open();
  }

  private async pick(choose: (item: IndexedTopic) => void) {
    const active = this.app.workspace.getActiveFile();
    const note = active && await loadTopic(this.app, active);
    if (note) { choose(note); return; }
    const topics = await this.controller.list();
    if (!topics.length) { new Notice(this.labels.requireTopic); return; }
    const picker = new class extends SuggestModal<IndexedTopic> {
      getSuggestions(query: string) {
        return topics.filter(item => (item.topic.cl_goal + item.file.basename).toLowerCase().includes(query.toLowerCase()));
      }
      renderSuggestion(item: IndexedTopic, el: HTMLElement) { el.setText(item.topic.cl_goal || item.file.basename); }
      onChooseSuggestion(item: IndexedTopic) { choose(item); }
    }(this.app);
    picker.setPlaceholder(this.labels.chooseTopic);
    picker.open();
  }
}
