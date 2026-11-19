import { asObject } from "../../domain/ai/outputValidator";
import type { AiSettings, ApiKind, CliKind, LocalKind } from "../../domain/ai/types";
import { cliDefaultModels, cliNames, cliSpecs, isSafeModelName } from "./cliSpecs";
import type { AiDependencies } from "./factory";
import { apiPath, endpointBase } from "./http";
import { apiDefaultModels, apiDefaults, localDefaults } from "./providers";

export interface DetectedProvider {
  label: string;
  status: "available" | "unavailable" | "desktopOnly";
  models: string[];
}

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

export function parseOllamaListModels(stdout: string): string[] {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const start = lines.findIndex(line => /^NAME\b/i.test(line));
  const rows = start >= 0 ? lines.slice(start + 1) : lines;
  return uniqueModels(rows.map(line => line.split(/\s+/)[0] ?? ""));
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
  return uniqueModels(items.slice(0, 30).map(item => asObject(item)[kind === "ollama" ? "name" : "id"])
    .filter((name): name is string => typeof name === "string"));
}

async function fetchApiModels(kind: ApiKind, settings: AiSettings, deps: AiDependencies, key: string): Promise<string[]> {
  const base = endpointBase((kind === "openai" && settings.apiUrl) || apiDefaults[kind], false);
  if (!base || !key) return [];
  const url = kind === "gemini" ? apiPath(base, "/v1beta", "/models") : apiPath(base, "/v1", "/models");
  const headers: Record<string, string> = kind === "gemini" ? { "x-goog-api-key": key } :
    kind === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } :
    { Authorization: "Bearer " + key };
  try {
    const reply = await deps.http.request({ method: "GET", url, headers });
    if (reply.status < 200 || reply.status >= 300 || reply.text.length > 262_144) return [];
    const result = asObject(JSON.parse(reply.text));
    const items: unknown = kind === "gemini" ? result.models : result.data;
    if (!Array.isArray(items)) return [];
    return uniqueModels(items.slice(0, 30).map(item => asObject(item)[kind === "gemini" ? "name" : "id"])
      .filter((name): name is string => typeof name === "string"));
  } catch { return []; }
}

async function detectCliProvider(kind: CliKind, settings: AiSettings, deps: AiDependencies): Promise<DetectedProvider> {
  const label = cliNames[kind];
  const defaults = cliDefaultModels[kind];
  if (!deps.cli) return { label, status: "desktopOnly", models: [...defaults] };
  let workspace;
  try {
    const exe = await deps.cli.executable(kind);
    if (!exe) return { label, status: "unavailable", models: [...defaults] };
    workspace = await deps.cli.workspace();
    const spec = cliSpecs[kind];
    const help = await deps.cli.runner.run(exe, spec.help, { cwd: workspace.dir, timeoutMs: 4500, stdin: "" });
    const available = help.code === 0 && spec.guards.every(guard => help.stdout.includes(guard));
    if (!available) return { label, status: "unavailable", models: [...defaults] };
    if (kind === "ollama") {
      let cliModels: string[] = [];
      try {
        const list = await deps.cli.runner.run(exe, ["list"], {
          cwd: workspace.dir, timeoutMs: 4500, stdin: "", env: { OLLAMA_HOST: "http://127.0.0.1:11434" },
        });
        if (list.code === 0) cliModels = parseOllamaListModels(list.stdout);
      } catch { /* fallback to HTTP tags */ }
      if (!cliModels.length) {
        cliModels = (await fetchLocalModels("ollama", settings, deps).catch(() => null)) ?? [];
      }
      return { label, status: "available", models: uniqueModels(cliModels, defaults) };
    }
    return { label, status: "available", models: [...defaults] };
  } catch { return { label, status: "unavailable", models: [...defaults] }; }
  finally { await workspace?.cleanup().catch(() => undefined); }
}

export async function detectModelsForProvider(settings: AiSettings, deps: AiDependencies, key = ""): Promise<string[]> {
  if (settings.provider === "off") return [];
  if (settings.provider === "cli") {
    const detected = await detectCliProvider(settings.cli, settings, deps);
    return detected.models;
  }
  if (settings.provider === "local") {
    return (await fetchLocalModels(settings.local, settings, deps).catch(() => null)) ?? [];
  }
  const defaults = apiDefaultModels[settings.api];
  const dynamic = await fetchApiModels(settings.api, settings, deps, key);
  return uniqueModels(dynamic, defaults);
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
      } catch { return { label, status: "unavailable" as const, models: [] }; }
    }),
  ]);
}
