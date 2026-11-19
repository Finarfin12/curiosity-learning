import { normalizePath, type App } from "obsidian";
import type { PropNames } from "../domain/learningProperties";
import { coreTemplatesFolder, planTemplateFiles, resolveTemplateFolder, templateContent } from "../domain/templateFiles";

export interface TemplateInstallResult {
  folder: string;
  created: string[];
  skipped: string[];
}

export interface TemplateConfig {
  templateFolder: string;
  propNames: PropNames;
  language: "en" | "id";
}

export class TemplateInstaller {
  constructor(
    private readonly app: App,
    private readonly config: () => TemplateConfig,
  ) {}

  async folder(): Promise<string> {
    let core = "";
    try {
      const path = normalizePath(`${this.app.vault.configDir}/templates.json`);
      if (await this.app.vault.adapter.exists(path)) {
        core = coreTemplatesFolder(await this.app.vault.adapter.read(path));
      }
    } catch {
      // Fall back to configured or default folder.
    }
    return resolveTemplateFolder(this.config().templateFolder, core);
  }

  async create(): Promise<TemplateInstallResult> {
    const cfg = this.config();
    const folder = await this.folder();
    const existing = this.app.vault.getFiles().map(file => file.path);
    const plan = planTemplateFiles(folder, existing);
    const created: string[] = [];
    if (plan.create.length > 0 && folder && !this.app.vault.getFolderByPath(normalizePath(folder))) {
      try {
        await this.app.vault.createFolder(normalizePath(folder));
      } catch {
        if (!this.app.vault.getFolderByPath(normalizePath(folder))) {
          throw new Error(`Cannot create folder ${folder}`);
        }
      }
    }
    for (const item of plan.create) {
      const path = normalizePath(item.path);
      if (this.app.vault.getAbstractFileByPath(path)) {
        plan.skip.push(item.path);
        continue;
      }
      await this.app.vault.create(path, templateContent(item.kind, cfg.propNames, cfg.language));
      created.push(item.path);
    }
    return { folder, created, skipped: plan.skip };
  }
}
