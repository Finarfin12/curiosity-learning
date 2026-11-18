import { Notice, Setting } from "obsidian";
import { detectProviders } from "../adapter/ai/detector";
import { cliNames } from "../adapter/ai/cliSpecs";
import { apiLabels, localDefaults } from "../adapter/ai/providers";
import { normalizeAi, type AiSettings } from "../domain/ai/types";
import type LearningPlugin from "../main";
import { action, labelControl } from "./forms";

export function renderSettingsAi(root: HTMLElement, plugin: LearningPlugin) {
  const tr = plugin.labels;
  const section = root.createDiv();
  const render = () => {
    section.empty();
    new Setting(section).setName(tr.optionalAi).setHeading();
    const settings = plugin.settings.ai;
    const update = (patch: Partial<AiSettings>, rerender = false) => {
      plugin.settings.ai = normalizeAi({ ...plugin.settings.ai, ...patch });
      void plugin.saveSettings().catch(() => new Notice(tr.failed));
      if (rerender) render();
    };
    const select = (label: string, options: Record<string, string>, current: string, next: (value: string) => void) => {
      const setting = new Setting(section).setName(label);
      setting.addDropdown(component => {
        labelControl(setting, component.selectEl);
        component.addOptions(options).setValue(current).onChange(next);
      });
    };
    const input = (label: string, value: string, placeholder: string, next: (value: string) => void, secret = false) => {
      const setting = new Setting(section).setName(label);
      setting.addText(component => {
        labelControl(setting, component.inputEl);
        component.setValue(value).setPlaceholder(placeholder);
        if (secret) {
          component.inputEl.type = "password";
          component.inputEl.autocomplete = "off";
        }
        component.inputEl.addEventListener("change", () => next(component.getValue().trim()));
      });
    };
    select(tr.aiMode, { off: tr.aiOffMode, cli: tr.aiCliMode, local: tr.aiLocalMode, api: tr.aiApiMode },
      settings.provider, value => update({ provider: value as AiSettings["provider"] }, true));
    if (settings.provider === "off") section.createEl("p", { text: tr.aiOffHelp });
    if (settings.provider === "cli") {
      select(tr.provider, cliNames, settings.cli, value => update({ cli: value as AiSettings["cli"] }, true));
      section.createEl("p", { text: tr.aiCliHelp });
    }
    if (settings.provider === "local") {
      select(tr.provider, { ollama: "Ollama", lmstudio: "LM Studio" }, settings.local,
        value => update({ local: value as AiSettings["local"], localUrl: "" }, true));
      input(tr.aiEndpoint, settings.localUrl, localDefaults[settings.local], localUrl => update({ localUrl }));
    }
    if (settings.provider === "api") {
      select(tr.provider, apiLabels, settings.api, value => update({ api: value as AiSettings["api"] }, true));
      if (settings.api === "openai") input(tr.aiEndpoint, settings.apiUrl, "https://api.openai.com", apiUrl => update({ apiUrl }));
      input(tr.aiKey, plugin.getAiKey(), "", value => plugin.setAiKey(value), true);
      section.createEl("p", { text: tr.aiKeyHelp });
    }
    if (settings.provider !== "off") {
      input(tr.aiModel, settings.model, "", model => update({ model }));
    }
    const output = section.createEl("ul", { attr: { "aria-live": "polite" } });
    const detect = action(section, tr.aiDetect, async () => {
      output.empty();
      const providers = await detectProviders(plugin.settings.ai, plugin.aiDependencies);
      for (const provider of providers) output.createEl("li", {
        text: provider.label + " · " + tr[provider.status] + (provider.models.length ? " · " + provider.models.join(", ") : ""),
      });
    }, tr);
    detect.disabled = settings.provider === "off";
    output.insertAdjacentElement("beforebegin", detect);
  };
  render();
}
