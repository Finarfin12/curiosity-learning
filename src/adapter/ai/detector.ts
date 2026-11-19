import { asObject } from "../../domain/ai/outputValidator";
import type { AiSettings, ApiKind, CliKind, LocalKind } from "../../domain/ai/types";
import { cliNames, cliSpecs, isSafeModelName } from "./cliSpecs";
import type { AiDependencies } from "./factory";
import { apiPath, endpointBase } from "./http";
import { apiDefaults, apiLabels, localDefaults } from "./providers";

export interface DetectedProvider {
  label: string;
  status: "available" | "unavailable" | "desktopOnly";
  models: string[];
}

export interface ProviderCheckResult {
  label: string;
  connected: boolean;
  status: "available" | "unavailable" | "desktopOnly" | "needsKey";
  models: string[];
}

const binaryModelCache = new Map<string, string[]>();

export function uniqueModels(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const name = raw.trim().replace(/^models\//, "");
      if (isSafeModelName(name) && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

function versionParts(name: string): number[] {
  const withoutDate = name.replace(/-20\d{6}$/, "");
  const match = /-([0-9]+(?:[.-][0-9]+)*)/.exec(withoutDate);
  if (!match) return [];
  return match[1].split(/[.-]/).map(part => Number(part));
}

function compareModelsDesc(a: string, b: string): number {
  const va = versionParts(a);
  const vb = versionParts(b);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (vb[i] ?? 0) - (va[i] ?? 0);
    if (diff !== 0) return diff;
  }
  const aDated = /-20\d{6}$/.test(a) ? 1 : 0;
  const bDated = /-20\d{6}$/.test(b) ? 1 : 0;
  if (aDated !== bDated) return aDated - bDated;
  return b.localeCompare(a, undefined, { numeric: true });
}

export function parseOllamaListModels(stdout: string): string[] {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const start = lines.findIndex(line => /^NAME\b/i.test(line));
  const rows = start >= 0 ? lines.slice(start + 1) : lines;
  return uniqueModels(rows.map(line => line.split(/\s+/)[0] ?? ""));
}

export function parseCodexConfigModel(toml: string): string | null {
  const match = /^\s*model\s*=\s*["']([^"']+)["']/m.exec(toml);
  return match && isSafeModelName(match[1].trim()) ? match[1].trim() : null;
}

export function parseCodexCacheModels(json: string): string[] {
  try {
    const root = asObject(JSON.parse(json));
    if (!Array.isArray(root.models)) return [];
    const slugs = root.models
      .map(item => asObject(item))
      .filter(item => item.visibility === "list" || (item.visibility !== "hide" && item.visibility !== "hidden"))
      .map(item => item.slug)
      .filter((slug): slug is string => typeof slug === "string");
    return uniqueModels(slugs);
  } catch {
    return [];
  }
}

export function parseClaudeHelpAliases(helpStdout: string): string[] {
  const section = /--model\b[\s\S]{0,260}?e\.g\.\s*([^)]+)\)/i.exec(helpStdout);
  if (!section) return [];
  const quoted = Array.from(section[1].matchAll(/['"]([a-z][a-z0-9._-]*)['"]/gi), match => match[1].toLowerCase());
  return uniqueModels(quoted);
}

export function parseClaudeBinaryModels(binaryLatin1: string): string[] {
  const matches = binaryLatin1.match(/\bclaude-(?:opus|sonnet|haiku|fable)-[0-9][a-z0-9.-]*\b/g) ?? [];
  const filtered = matches.filter(name => !/-v1$/i.test(name) && !name.endsWith("."));
  return uniqueModels(filtered).sort(compareModelsDesc).slice(0, 30);
}

export function parseClaudeSettingsModels(json: string): string[] {
  try {
    const root = asObject(JSON.parse(json));
    const found: string[] = [];
    if (typeof root.model === "string") found.push(root.model);
    const env = asObject(root.env);
    for (const [key, value] of Object.entries(env)) {
      if (/^ANTHROPIC_DEFAULT_.*_MODEL$/i.test(key) && typeof value === "string") found.push(value);
    }
    return uniqueModels(found);
  } catch {
    return [];
  }
}

export function parseGeminiSettingsModels(json: string): string[] {
  try {
    const root = asObject(JSON.parse(json));
    const found: string[] = [];
    if (typeof root.model === "string") found.push(root.model);
    else {
      const nested = asObject(root.model);
      if (typeof nested.name === "string") found.push(nested.name);
    }
    return uniqueModels(found);
  } catch {
    return [];
  }
}

export function parseGeminiBinaryModels(binaryLatin1: string): string[] {
  const matches = binaryLatin1.match(/\bgemini-[0-9][a-z0-9.-]*\b/g) ?? [];
  const filtered = matches.filter(name => !name.endsWith("."));
  return uniqueModels(filtered).sort(compareModelsDesc).slice(0, 30);
}

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const trimmed = base.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].join(sep);
}

async function fetchLocalModels(kind: LocalKind, settings: AiSettings, deps: AiDependencies): Promise<string[] | null> {
  const base = endpointBase((settings.local === kind && settings.localUrl) || localDefaults[kind], true);
  if (!base) return null;
  const reply = await deps.http.request({ method: "GET", url: kind === "ollama"
    ? apiPath(base, "/api", "/tags") : apiPath(base, "/v1", "/models") });
  if (reply.status < 200 || reply.status >= 300 || reply.text.length > 262_144) return null;
  const result = asObject(JSON.parse(reply.text));
  const items: unknown = kind === "ollama" ? result.models : result.data;
  if (!Array.isArray(items)) return [];
  return uniqueModels(items.slice(0, 50).map(item => asObject(item)[kind === "ollama" ? "name" : "id"])
    .filter((name): name is string => typeof name === "string"));
}

async function fetchApiModels(kind: ApiKind, settings: AiSettings, deps: AiDependencies, key: string): Promise<string[] | null> {
  const base = endpointBase((kind === "openai" && settings.apiUrl) || apiDefaults[kind], false);
  if (!base || !key) return null;
  const url = kind === "gemini" ? apiPath(base, "/v1beta", "/models") : apiPath(base, "/v1", "/models");
  const headers: Record<string, string> = kind === "gemini" ? { "x-goog-api-key": key } :
    kind === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } :
    { Authorization: "Bearer " + key };
  try {
    const reply = await deps.http.request({ method: "GET", url, headers });
    if (reply.status < 200 || reply.status >= 300 || reply.text.length > 262_144) return null;
    const result = asObject(JSON.parse(reply.text));
    const items: unknown = kind === "gemini" ? result.models : result.data;
    if (!Array.isArray(items)) return [];
    return uniqueModels(items.slice(0, 50).map(item => asObject(item)[kind === "gemini" ? "name" : "id"])
      .filter((name): name is string => typeof name === "string"));
  } catch {
    return null;
  }
}

async function detectCliModels(
  kind: CliKind,
  exe: string,
  helpStdout: string,
  settings: AiSettings,
  deps: AiDependencies,
  workspaceDir: string,
): Promise<string[]> {
  const cli = deps.cli;
  if (!cli) return [];
  const home = cli.homeDir?.() ?? "";
  const readFile = cli.readFile?.bind(cli);

  if (kind === "codex") {
    const codexDir = cli.env?.("CODEX_HOME") || (home ? joinPath(home, ".codex") : "");
    if (!codexDir || !readFile) return [];
    const [configText, cacheText] = await Promise.all([
      readFile(joinPath(codexDir, "config.toml"), "utf8"),
      readFile(joinPath(codexDir, "models_cache.json"), "utf8"),
    ]);
    const configured = configText ? parseCodexConfigModel(configText) : null;
    const cached = cacheText ? parseCodexCacheModels(cacheText) : [];
    return uniqueModels(configured ? [configured] : [], cached);
  }

  if (kind === "claude") {
    const aliases = parseClaudeHelpAliases(helpStdout);
    const claudeDir = cli.env?.("CLAUDE_CONFIG_DIR") || (home ? joinPath(home, ".claude") : "");
    const settingsText = claudeDir && readFile ? await readFile(joinPath(claudeDir, "settings.json"), "utf8") : null;
    const configured = settingsText ? parseClaudeSettingsModels(settingsText) : [];
    let bundled = binaryModelCache.get(exe);
    if (!bundled && readFile) {
      const raw = await readFile(exe, "latin1");
      bundled = raw ? parseClaudeBinaryModels(raw) : [];
      if (bundled.length) binaryModelCache.set(exe, bundled);
    }
    return uniqueModels(configured, aliases, bundled ?? []);
  }

  if (kind === "gemini") {
    const geminiDir = cli.env?.("GEMINI_CLI_HOME") || (home ? joinPath(home, ".gemini") : "");
    const settingsText = geminiDir && readFile ? await readFile(joinPath(geminiDir, "settings.json"), "utf8") : null;
    const configured = settingsText ? parseGeminiSettingsModels(settingsText) : [];
    let bundled = binaryModelCache.get(exe);
    if (!bundled && readFile) {
      const raw = await readFile(exe, "latin1");
      bundled = raw ? parseGeminiBinaryModels(raw) : [];
      if (bundled.length) binaryModelCache.set(exe, bundled);
    }
    return uniqueModels(configured, bundled ?? []);
  }

  let cliModels: string[] = [];
  try {
    const list = await cli.runner.run(exe, ["list"], {
      cwd: workspaceDir, timeoutMs: 4500, stdin: "", env: { OLLAMA_HOST: "http://127.0.0.1:11434" },
    });
    if (list.code === 0) cliModels = parseOllamaListModels(list.stdout);
  } catch { /* fallback to HTTP tags */ }
  if (!cliModels.length) {
    cliModels = (await fetchLocalModels("ollama", settings, deps).catch(() => null)) ?? [];
  }
  return uniqueModels(cliModels);
}

async function detectCliProvider(kind: CliKind, settings: AiSettings, deps: AiDependencies): Promise<DetectedProvider> {
  const label = cliNames[kind];
  if (!deps.cli) return { label, status: "desktopOnly", models: [] };
  let workspace;
  try {
    const exe = await deps.cli.executable(kind);
    if (!exe) return { label, status: "unavailable", models: [] };
    workspace = await deps.cli.workspace();
    const spec = cliSpecs[kind];
    const help = await deps.cli.runner.run(exe, spec.help, { cwd: workspace.dir, timeoutMs: 4500, stdin: "" });
    const available = help.code === 0 && spec.guards.every(guard => help.stdout.includes(guard));
    if (!available) return { label, status: "unavailable", models: [] };
    const models = await detectCliModels(kind, exe, help.stdout, settings, deps, workspace.dir);
    return { label, status: "available", models };
  } catch {
    return { label, status: "unavailable", models: [] };
  } finally {
    await workspace?.cleanup().catch(() => undefined);
  }
}

export async function checkActiveProvider(settings: AiSettings, deps: AiDependencies, key = ""): Promise<ProviderCheckResult> {
  if (settings.provider === "off") {
    return { label: "Off", connected: false, status: "unavailable", models: [] };
  }
  if (settings.provider === "cli") {
    const detected = await detectCliProvider(settings.cli, settings, deps);
    return {
      label: detected.label,
      connected: detected.status === "available",
      status: detected.status,
      models: detected.models,
    };
  }
  if (settings.provider === "local") {
    const label = settings.local === "ollama" ? "Ollama" : "LM Studio";
    const models = await fetchLocalModels(settings.local, settings, deps).catch(() => null);
    if (!models) return { label, connected: false, status: "unavailable", models: [] };
    return { label, connected: true, status: "available", models };
  }
  const label = apiLabels[settings.api];
  if (!key) return { label, connected: false, status: "needsKey", models: [] };
  const models = await fetchApiModels(settings.api, settings, deps, key);
  if (!models) return { label, connected: false, status: "unavailable", models: [] };
  return { label, connected: true, status: "available", models };
}

export async function detectModelsForProvider(settings: AiSettings, deps: AiDependencies, key = ""): Promise<string[]> {
  return (await checkActiveProvider(settings, deps, key)).models;
}

export async function detectProviders(settings: AiSettings, deps: AiDependencies): Promise<DetectedProvider[]> {
  if (settings.provider === "off") return [];
  const cli = Object.keys(cliNames) as CliKind[];
  const local = Object.keys(localDefaults) as LocalKind[];
  return Promise.all([
    ...cli.map(kind => detectCliProvider(kind, settings, deps)),
    ...local.map(async kind => {
      const label = kind === "ollama" ? "Ollama" : "LM Studio";
      try {
        const models = await fetchLocalModels(kind, settings, deps);
        if (!models) return { label, status: "unavailable" as const, models: [] };
        return { label, status: "available" as const, models };
      } catch {
        return { label, status: "unavailable" as const, models: [] };
      }
    }),
  ]);
}
