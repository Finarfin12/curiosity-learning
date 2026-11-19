import { Notice, PluginSettingTab, Setting } from "obsidian";
import { folderPath } from "../adapter/noteFactory";
import { parseNames, propertyFields } from "../domain/learningProperties";
import { cleanFolder } from "../domain/templateFiles";
import { buildAiSettingGroup } from "./settingsAi";
import { labelControl } from "./forms";
import { refreshSettingTab, resolveVisible, type SettingGroupDef, type SettingItemDef } from "./settingDefinitions";
import type LearningPlugin from "../main";

export class LearningSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: LearningPlugin) { super(plugin.app, plugin); }

  private redisplay(): void {
    const top = this.containerEl.scrollTop;
    refreshSettingTab(this);
    this.containerEl.scrollTop = top;
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        this.containerEl.scrollTop = top;
      });
    }
  }

  getSettingDefinitions(): SettingGroupDef[] {
    const tr = this.plugin.labels;
    const groups: SettingGroupDef[] = [];

    groups.push({
      type: "group",
      id: "general",
      heading: tr.settings,
      items: [
        {
          id: "general.language",
          name: tr.language,
          render: setting => {
            setting.addDropdown(control => {
              labelControl(setting, control.selectEl);
              control.addOptions({ en: "English", id: "Bahasa Indonesia" }).setValue(this.plugin.settings.language)
                .onChange(async value => {
                  this.plugin.settings.language = value === "id" ? "id" : "en";
                  await this.plugin.saveSettings();
                  this.plugin.addLearningCommands();
                  this.redisplay();
                });
            });
          },
        },
      ],
    });

    groups.push({
      type: "group",
      id: "folders",
      heading: tr.folders,
      items: (["inbox", "topics"] as const).map(key => ({
        id: "folders." + key,
        name: tr[key],
        render: setting => {
          setting.addText(control => {
            labelControl(setting, control.inputEl);
            control.setValue(this.plugin.settings[key]);
            control.inputEl.addEventListener("change", () => {
              const path = folderPath(control.getValue());
              if (!path) { control.setValue(this.plugin.settings[key]); new Notice(tr.invalidFolder); return; }
              this.plugin.settings[key] = path;
              void this.plugin.saveSettings().catch(() => new Notice(tr.failed));
            });
          });
        },
      })),
    });

    groups.push({
      type: "group",
      id: "templates",
      heading: tr.templates,
      items: [
        {
          id: "templates.help",
          name: "",
          desc: tr.templatesHelp,
          searchable: false,
          render: () => undefined,
        },
        {
          id: "templates.folder",
          name: tr.templateFolder,
          desc: tr.templateFolderDesc,
          render: setting => {
            setting.addText(control => {
              labelControl(setting, control.inputEl);
              control.setValue(this.plugin.settings.templateFolder);
              control.inputEl.addEventListener("change", () => {
                this.plugin.settings.templateFolder = cleanFolder(control.getValue());
                control.setValue(this.plugin.settings.templateFolder);
                void this.plugin.saveSettings()
                  .then(() => this.plugin.refreshTemplateFolder())
                  .catch(() => new Notice(tr.failed));
              });
              void this.plugin.templates.folder().then(folder => {
                control.setPlaceholder(folder);
              });
            });
          },
        },
        {
          id: "templates.create",
          name: tr.createTemplates,
          render: setting => {
            setting.addButton(button => {
              labelControl(setting, button.buttonEl);
              button.setButtonText(tr.createTemplates).onClick(() => {
                void this.plugin.createTemplates().catch(() => new Notice(tr.failed));
              });
            });
          },
        },
      ],
    });

    groups.push(buildAiSettingGroup(this.plugin, () => this.redisplay()));

    groups.push({
      type: "group",
      id: "scholarly",
      heading: tr.scholarlySettings,
      items: [
        {
          id: "scholarly.enable",
          name: tr.enableScholarlySearch,
          desc: tr.consentHelp,
          render: setting => {
            setting.addToggle(control => {
              labelControl(setting, control.toggleEl);
              control.setValue(this.plugin.settings.enableScholarlySearch).onChange(async value => {
                this.plugin.settings.enableScholarlySearch = value;
                await this.plugin.saveSettings();
              });
            });
          },
        },
        ...(["scholarlyMailto", "openAlexApiKey", "semanticScholarApiKey"] as const).map(key => ({
          id: "scholarly." + key,
          name: tr[key],
          render: (setting: Setting) => {
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
          },
        })),
      ],
    });

    const propItems: SettingItemDef[] = [
      {
        id: "properties.help",
        name: "",
        desc: tr.propertyHelp,
        searchable: false,
        render: () => undefined,
      },
      ...propertyFields.map(key => ({
        id: "properties." + key,
        name: key[0].toUpperCase() + key.slice(1),
        render: (setting: Setting) => {
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
        },
      })),
    ];

    groups.push({
      type: "group",
      id: "properties",
      heading: tr.properties,
      items: propItems,
    });

    return groups;
  }

  display(): void {
    const root = this.containerEl;
    root.empty();

    for (const group of this.getSettingDefinitions()) {
      if (!resolveVisible(group.visible)) continue;
      if (group.heading) {
        new Setting(root).setName(group.heading).setHeading();
      }
      for (const item of group.items) {
        if (!resolveVisible(item.visible)) continue;
        const setting = new Setting(root);
        if (item.name) setting.setName(item.name);
        if (item.desc) setting.setDesc(item.desc);
        if (item.cls) setting.settingEl.addClass(item.cls);
        item.render(setting);
      }
    }
  }
}
