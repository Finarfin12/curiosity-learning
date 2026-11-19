import { Notice, Setting } from "obsidian";
import { detectModelsForProvider, detectProviders, type DetectedProvider } from "../adapter/ai/detector";
import { cliDefaultModels, cliNames } from "../adapter/ai/cliSpecs";
import { apiDefaultModels, apiLabels, localDefaults } from "../adapter/ai/providers";
import { normalizeAi, type AiSettings } from "../domain/ai/types";
import type LearningPlugin from "../main";
import { labelControl } from "./forms";
import { resolveVisible, type SettingGroupDef, type SettingItemDef } from "./settingDefinitions";

interface AiUiCache {
  detected: DetectedProvider[];
  modelsBySlot: Map<string, string[]>;
  detectToken: number;
}

const cacheByPlugin = new WeakMap<LearningPlugin, AiUiCache>();

function getUiCache(plugin: LearningPlugin): AiUiCache {
  let state = cacheByPlugin.get(plugin);
  if (!state) {
    state = { detected: [], modelsBySlot: new Map(), detectToken: 0 };
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

function initialModelsFor(settings: AiSettings, cache: AiUiCache): string[] {
  const cached = cache.modelsBySlot.get(providerSlot(settings));
  if (cached && cached.length) return cached;
  if (settings.provider === "cli") return [...cliDefaultModels[settings.cli]];
  if (settings.provider === "api") return [...apiDefaultModels[settings.api]];
  return [];
}

function applyModelOptions(selectEl: HTMLSelectElement, models: string[], current: string, emptyLabel: string): string {
  selectEl.empty();
  if (!models.length) {
    const value = current || "";
    selectEl.createEl("option", { text: value || emptyLabel, value });
    selectEl.value = value;
    return value;
  }
  const chosen = models.includes(current) ? current : models[0];
  for (const model of models) {
    selectEl.createEl("option", { text: model, value: model });
  }
  selectEl.value = chosen;
  return chosen;
}

export function buildAiSettingGroup(plugin: LearningPlugin, rerender: () => void): SettingGroupDef {
  const tr = plugin.labels;
  const cache = getUiCache(plugin);
  const settings = plugin.settings.ai;
  let activeModelSelect: HTMLSelectElement | null = null;

  const update = (patch: Partial<AiSettings>, refresh = false) => {
    plugin.settings.ai = normalizeAi({ ...plugin.settings.ai, ...patch });
    void plugin.saveSettings().catch(() => new Notice(tr.failed));
    if (refresh) rerender();
  };

  const syncModels = async () => {
    const current = plugin.settings.ai;
    if (current.provider === "off") return;
    const token = ++cache.detectToken;
    const slot = providerSlot(current);
    const models = await detectModelsForProvider(current, plugin.aiDependencies, plugin.getAiKey());
    cache.modelsBySlot.set(slot, models);
    if (token !== cache.detectToken) return;
    if (models.length && (!current.model || !models.includes(current.model))) {
      update({ model: models[0] }, false);
    }
    if (activeModelSelect) {
      applyModelOptions(activeModelSelect, models, plugin.settings.ai.model, tr.choose);
    }
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
              const nextSettings = normalizeAi({ ...plugin.settings.ai, provider: nextMode });
              const candidates = initialModelsFor(nextSettings, cache);
              const nextModel = candidates.length && !candidates.includes(nextSettings.model) ? candidates[0] : nextSettings.model;
              update({ provider: nextMode, model: nextModel }, true);
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
            const nextCli = value as AiSettings["cli"];
            const nextSettings = normalizeAi({ ...plugin.settings.ai, cli: nextCli });
            const candidates = initialModelsFor(nextSettings, cache);
            const nextModel = candidates.length && !candidates.includes(nextSettings.model) ? candidates[0] : nextSettings.model;
            update({ cli: nextCli, model: nextModel }, true);
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
            .onChange(value => update({ local: value as AiSettings["local"], localUrl: "" }, true));
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
            void syncModels();
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
            const nextApi = value as AiSettings["api"];
            const nextSettings = normalizeAi({ ...plugin.settings.ai, api: nextApi });
            const candidates = initialModelsFor(nextSettings, cache);
            const nextModel = candidates.length && !candidates.includes(nextSettings.model) ? candidates[0] : nextSettings.model;
            update({ api: nextApi, model: nextModel }, true);
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
            void syncModels();
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
            void syncModels();
          });
        });
      },
    },
    {
      id: "ai.model",
      name: tr.aiModel,
      visible: () => plugin.settings.ai.provider !== "off",
      render: setting => {
        setting.addDropdown(component => {
          activeModelSelect = component.selectEl;
          labelControl(setting, component.selectEl);
          const initial = initialModelsFor(plugin.settings.ai, cache);
          const chosen = applyModelOptions(component.selectEl, initial, plugin.settings.ai.model, tr.choose);
          if (chosen && chosen !== plugin.settings.ai.model) {
            update({ model: chosen }, false);
          }
          component.onChange(model => update({ model }, false));
          void syncModels();
        });
      },
    },
    {
      id: "ai.detect",
      name: tr.aiDetect,
      desc: cache.detected.map(provider =>
        provider.label + " · " + tr[provider.status] + (provider.models.length ? " · " + provider.models.join(", ") : ""),
      ).join(" | ") || undefined,
      render: setting => {
        setting.addButton(button => {
          labelControl(setting, button.buttonEl);
          button.setButtonText(tr.aiDetect);
          button.setDisabled(plugin.settings.ai.provider === "off");
          button.onClick(async () => {
            button.setDisabled(true);
            try {
              const [providers, models] = await Promise.all([
                detectProviders(plugin.settings.ai, plugin.aiDependencies),
                detectModelsForProvider(plugin.settings.ai, plugin.aiDependencies, plugin.getAiKey()),
              ]);
              cache.detected = providers;
              cache.modelsBySlot.set(providerSlot(plugin.settings.ai), models);
              if (models.length && (!plugin.settings.ai.model || !models.includes(plugin.settings.ai.model))) {
                update({ model: models[0] }, false);
              }
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
