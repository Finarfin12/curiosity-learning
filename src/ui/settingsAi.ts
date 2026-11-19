import { Notice, Setting } from "obsidian";
import {
  checkActiveProvider,
  detectProviders,
  type DetectedProvider,
  type ProviderCheckResult,
} from "../adapter/ai/detector";
import { cliNames } from "../adapter/ai/cliSpecs";
import { apiLabels, localDefaults } from "../adapter/ai/providers";
import { normalizeAi, type AiSettings } from "../domain/ai/types";
import type { Labels } from "../i18n/en";
import type LearningPlugin from "../main";
import { labelControl } from "./forms";
import { resolveVisible, type SettingGroupDef, type SettingItemDef } from "./settingDefinitions";

interface AiUiCache {
  detected: DetectedProvider[];
  checksBySlot: Map<string, ProviderCheckResult>;
  detectToken: number;
  notifyOnNextRender: boolean;
}

const cacheByPlugin = new WeakMap<LearningPlugin, AiUiCache>();

function getUiCache(plugin: LearningPlugin): AiUiCache {
  let state = cacheByPlugin.get(plugin);
  if (!state) {
    state = { detected: [], checksBySlot: new Map(), detectToken: 0, notifyOnNextRender: false };
    cacheByPlugin.set(plugin, state);
  }
  return state;
}

function providerSlot(settings: AiSettings): string {
  if (settings.provider === "cli") return "cli:" + settings.cli;
  if (settings.provider === "local") return "local:" + settings.local + ":" + (settings.localUrl || localDefaults[settings.local]);
  if (settings.provider === "api") return "api:" + settings.api + ":" + (settings.api === "openai" ? settings.apiUrl : "");
  return "off";
}

function statusLine(check: ProviderCheckResult | undefined, tr: Labels): string {
  if (!check) return tr.aiChecking;
  if (check.connected) return `${tr.aiConnected} · ${check.models.length} ${tr.aiModelsAvailable}`;
  if (check.status === "needsKey") return `${tr.aiNotConnected} · ${tr.aiKeyRequired}`;
  if (check.status === "desktopOnly") return `${tr.aiNotConnected} · ${tr.desktopOnly}`;
  return `${tr.aiNotConnected} · ${tr.unavailable}`;
}

function notifyConnection(check: ProviderCheckResult, tr: Labels): void {
  if (check.connected) {
    new Notice(`${tr.aiConnectedTo} ${check.label} (${check.models.length} ${tr.aiModelsDetected})`);
  } else if (check.status === "needsKey") {
    new Notice(`${check.label}: ${tr.aiNotConnected} (${tr.aiKeyRequired})`);
  } else {
    new Notice(`${check.label} ${tr.aiDisconnectedFrom}`);
  }
}

function applyModelOptions(
  selectEl: HTMLSelectElement,
  check: ProviderCheckResult | undefined,
  current: string,
  tr: Labels,
): string {
  selectEl.empty();
  const models = check?.models ?? [];
  if (!models.length) {
    const placeholder = check?.status === "needsKey" ? tr.aiNeedsKey : (check ? tr.aiNoModels : tr.aiChecking);
    selectEl.createEl("option", { text: placeholder, value: "" });
    selectEl.value = "";
    selectEl.disabled = true;
    return "";
  }
  selectEl.disabled = false;
  const chosen = models.includes(current) ? current : models[0];
  for (const model of models) {
    selectEl.createEl("option", { text: model, value: model });
  }
  selectEl.value = chosen;
  return chosen;
}

function formatDetectedProvider(provider: DetectedProvider, tr: Labels): string {
  const head = `${provider.label} · ${tr[provider.status]}`;
  if (provider.status !== "available" || !provider.models.length) return head;
  const preview = provider.models.slice(0, 6).join(", ");
  const extra = provider.models.length > 6 ? ` (+${provider.models.length - 6})` : "";
  return `${head} · ${preview}${extra}`;
}

export function buildAiSettingGroup(plugin: LearningPlugin, rerender: () => void): SettingGroupDef {
  const tr = plugin.labels;
  const cache = getUiCache(plugin);
  const settings = plugin.settings.ai;
  let activeModelSelect: HTMLSelectElement | null = null;
  let activeModelDesc: HTMLElement | null = null;

  const update = (patch: Partial<AiSettings>, refresh = false) => {
    plugin.settings.ai = normalizeAi({ ...plugin.settings.ai, ...patch });
    void plugin.saveSettings().catch(() => new Notice(tr.failed));
    if (refresh) rerender();
  };

  const syncActiveProvider = async (notify: boolean) => {
    const current = plugin.settings.ai;
    if (current.provider === "off") return;
    const token = ++cache.detectToken;
    const slot = providerSlot(current);
    if (activeModelDesc) activeModelDesc.setText(tr.aiChecking);
    const result = await checkActiveProvider(current, plugin.aiDependencies, plugin.getAiKey());
    cache.checksBySlot.set(slot, result);
    if (token !== cache.detectToken) return;
    const models = result.models;
    if (models.length && (!current.model || !models.includes(current.model))) {
      update({ model: models[0] }, false);
    } else if (!models.length && current.model) {
      update({ model: "" }, false);
    }
    if (activeModelSelect) {
      applyModelOptions(activeModelSelect, result, plugin.settings.ai.model, tr);
    }
    if (activeModelDesc) {
      activeModelDesc.setText(statusLine(result, tr));
    }
    if (notify) notifyConnection(result, tr);
  };

  const items: SettingItemDef[] = [
    {
      id: "ai.mode",
      name: tr.aiMode,
      desc: settings.provider === "off" ? tr.aiOffHelp : undefined,
      render: setting => {
        setting.addDropdown(component => {
          labelControl(setting, component.selectEl);
          component.addOptions({ off: tr.aiOffMode, cli: tr.aiCliMode, local: tr.aiLocalMode, api: tr.aiApiMode })
            .setValue(settings.provider)
            .onChange(value => {
              const nextMode = value as AiSettings["provider"];
              cache.notifyOnNextRender = nextMode !== "off";
              update({ provider: nextMode }, true);
            });
        });
      },
    },
    {
      id: "ai.cli",
      name: tr.provider,
      desc: tr.aiCliHelp,
      visible: () => plugin.settings.ai.provider === "cli",
      render: setting => {
        setting.addDropdown(component => {
          labelControl(setting, component.selectEl);
          component.addOptions(cliNames).setValue(settings.cli).onChange(value => {
            cache.notifyOnNextRender = true;
            update({ cli: value as AiSettings["cli"] }, true);
          });
        });
      },
    },
    {
      id: "ai.local",
      name: tr.provider,
      visible: () => plugin.settings.ai.provider === "local",
      render: setting => {
        setting.addDropdown(component => {
          labelControl(setting, component.selectEl);
          component.addOptions({ ollama: "Ollama", lmstudio: "LM Studio" }).setValue(settings.local)
            .onChange(value => {
              cache.notifyOnNextRender = true;
              update({ local: value as AiSettings["local"], localUrl: "" }, true);
            });
        });
      },
    },
    {
      id: "ai.localUrl",
      name: tr.aiEndpoint,
      visible: () => plugin.settings.ai.provider === "local",
      render: setting => {
        setting.addText(component => {
          labelControl(setting, component.inputEl);
          component.setValue(settings.localUrl).setPlaceholder(localDefaults[settings.local]);
          component.inputEl.addEventListener("change", () => {
            update({ localUrl: component.getValue().trim() }, false);
            void syncActiveProvider(true);
          });
        });
      },
    },
    {
      id: "ai.api",
      name: tr.provider,
      visible: () => plugin.settings.ai.provider === "api",
      render: setting => {
        setting.addDropdown(component => {
          labelControl(setting, component.selectEl);
          component.addOptions(apiLabels).setValue(settings.api).onChange(value => {
            cache.notifyOnNextRender = true;
            update({ api: value as AiSettings["api"] }, true);
          });
        });
      },
    },
    {
      id: "ai.apiUrl",
      name: tr.aiEndpoint,
      visible: () => plugin.settings.ai.provider === "api" && plugin.settings.ai.api === "openai",
      render: setting => {
        setting.addText(component => {
          labelControl(setting, component.inputEl);
          component.setValue(settings.apiUrl).setPlaceholder("https://api.openai.com");
          component.inputEl.addEventListener("change", () => {
            update({ apiUrl: component.getValue().trim() }, false);
            void syncActiveProvider(true);
          });
        });
      },
    },
    {
      id: "ai.apiKey",
      name: tr.aiKey,
      desc: tr.aiKeyHelp,
      visible: () => plugin.settings.ai.provider === "api",
      render: setting => {
        setting.addText(component => {
          labelControl(setting, component.inputEl);
          component.setValue(plugin.getAiKey());
          component.inputEl.type = "password";
          component.inputEl.autocomplete = "off";
          component.inputEl.addEventListener("change", () => {
            plugin.setAiKey(component.getValue().trim());
            void syncActiveProvider(true);
          });
        });
      },
    },
    {
      id: "ai.model",
      name: tr.aiModel,
      desc: statusLine(cache.checksBySlot.get(providerSlot(settings)), tr),
      visible: () => plugin.settings.ai.provider !== "off",
      render: setting => {
        activeModelDesc = setting.descEl;
        setting.addDropdown(component => {
          activeModelSelect = component.selectEl;
          labelControl(setting, component.selectEl);
          const cached = cache.checksBySlot.get(providerSlot(plugin.settings.ai));
          const chosen = applyModelOptions(component.selectEl, cached, plugin.settings.ai.model, tr);
          if (chosen && chosen !== plugin.settings.ai.model) {
            update({ model: chosen }, false);
          }
          component.onChange(model => update({ model }, false));
          const shouldNotify = cache.notifyOnNextRender;
          cache.notifyOnNextRender = false;
          void syncActiveProvider(shouldNotify);
        });
      },
    },
    {
      id: "ai.detect",
      name: tr.aiDetect,
      desc: cache.detected.map(provider => formatDetectedProvider(provider, tr)).join(" | ") || undefined,
      render: setting => {
        setting.addButton(button => {
          labelControl(setting, button.buttonEl);
          button.setButtonText(tr.aiDetect);
          button.setDisabled(plugin.settings.ai.provider === "off");
          button.onClick(async () => {
            button.setDisabled(true);
            try {
              const [providers, active] = await Promise.all([
                detectProviders(plugin.settings.ai, plugin.aiDependencies),
                checkActiveProvider(plugin.settings.ai, plugin.aiDependencies, plugin.getAiKey()),
              ]);
              cache.detected = providers;
              cache.checksBySlot.set(providerSlot(plugin.settings.ai), active);
              if (active.models.length && (!plugin.settings.ai.model || !active.models.includes(plugin.settings.ai.model))) {
                update({ model: active.models[0] }, false);
              } else if (!active.models.length && plugin.settings.ai.model) {
                update({ model: "" }, false);
              }
              notifyConnection(active, tr);
              rerender();
            } finally {
              button.setDisabled(plugin.settings.ai.provider === "off");
            }
          });
        });
      },
    },
  ];

  return {
    type: "group",
    id: "ai",
    heading: tr.optionalAi,
    items,
  };
}

export function renderSettingsAi(root: HTMLElement, plugin: LearningPlugin, rerender?: () => void) {
  const section = root.createDiv();
  const draw = () => {
    section.empty();
    const group = buildAiSettingGroup(plugin, rerender ?? draw);
    if (group.heading) new Setting(section).setName(group.heading).setHeading();
    for (const item of group.items) {
      if (!resolveVisible(item.visible)) continue;
      const setting = new Setting(section);
      if (item.name) setting.setName(item.name);
      if (item.desc) setting.setDesc(item.desc);
      if (item.cls) setting.settingEl.addClass(item.cls);
      item.render(setting);
    }
  };
  draw();
}
