import { Notice, PluginSettingTab, Setting } from "obsidian";
import { folderPath } from "../adapter/noteFactory";
import { parseNames, propertyFields } from "../domain/learningProperties";
import { renderSettingsAi } from "./settingsAi";
import { labelControl } from "./forms";
import type LearningPlugin from "../main";

export class LearningSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: LearningPlugin) { super(plugin.app, plugin); }

  display() { this.renderSettings(); }

  private renderSettings() {
    const tr = this.plugin.labels;
    const root = this.containerEl;
    root.empty();
    new Setting(root).setName(tr.settings).setHeading();
    new Setting(root).setName(tr.language).addDropdown(control =>
      control.addOptions({ en: "English", id: "Bahasa Indonesia" }).setValue(this.plugin.settings.language)
        .onChange(async value => {
          this.plugin.settings.language = value === "id" ? "id" : "en";
          await this.plugin.saveSettings();
          this.plugin.addLearningCommands();
          this.renderSettings();
        }));
    new Setting(root).setName(tr.folders).setHeading();
    for (const key of ["inbox", "topics"] as const) {
      new Setting(root).setName(tr[key]).addText(control => {
        control.setValue(this.plugin.settings[key]);
        control.inputEl.addEventListener("change", () => {
          const path = folderPath(control.getValue());
          if (!path) { control.setValue(this.plugin.settings[key]); new Notice(tr.invalidFolder); return; }
          this.plugin.settings[key] = path;
          void this.plugin.saveSettings().catch(() => new Notice(tr.failed));
        });
      });
    }
    renderSettingsAi(root, this.plugin);
    new Setting(root).setName(tr.scholarlySettings).setHeading();
    const online = new Setting(root).setName(tr.enableScholarlySearch).setDesc(tr.consentHelp);
    online.addToggle(control => {
      labelControl(online, control.toggleEl);
      control.setValue(this.plugin.settings.enableScholarlySearch).onChange(async value => {
        this.plugin.settings.enableScholarlySearch = value;
        await this.plugin.saveSettings();
      });
    });
    for (const key of ["scholarlyMailto", "openAlexApiKey", "semanticScholarApiKey"] as const) {
      const setting = new Setting(root).setName(tr[key]);
      setting.addText(control => {
        labelControl(setting, control.inputEl);
        control.inputEl.type = key === "scholarlyMailto" ? "email" : "password";
        control.inputEl.autocomplete = "off";
        control.setValue(this.plugin.settings[key]);
        control.inputEl.addEventListener("change", () => {
          this.plugin.settings[key] = control.getValue().trim();
          void this.plugin.saveSettings().catch(() => new Notice(tr.failed));
        });
      });
    }
    new Setting(root).setName(tr.properties).setHeading();
    root.createEl("p", { text: tr.propertyHelp });
    for (const key of propertyFields) {
      const setting = new Setting(root).setName(key[0].toUpperCase() + key.slice(1));
      setting.addText(control => {
        labelControl(setting, control.inputEl);
        control.setValue(this.plugin.settings.propNames[key]);
        control.inputEl.addEventListener("change", () => {
          const names = parseNames({ ...this.plugin.settings.propNames, [key]: control.getValue() });
          if (!names) { control.setValue(this.plugin.settings.propNames[key]); new Notice(tr.invalidProperty); return; }
          this.plugin.settings.propNames = names;
          control.setValue(names[key]);
          void this.plugin.saveSettings().catch(() => new Notice(tr.failed));
        });
      });
    }
  }
}
