import { asObject } from "../../domain/ai/outputValidator";
import type { AiSettings, CliKind, LocalKind } from "../../domain/ai/types";
import { cliNames, cliSpecs } from "./cliSpecs";
import type { AiDependencies } from "./factory";
import { apiPath, endpointBase } from "./http";
import { localDefaults } from "./providers";

export async function detectProviders(settings: AiSettings, deps: AiDependencies) {
  if (settings.provider === "off") return [];
  const cli = Object.keys(cliNames) as CliKind[];
  const local = Object.keys(localDefaults) as LocalKind[];
  return Promise.all([
    ...cli.map(async kind => {
      const label = cliNames[kind];
      if (!deps.cli) return { label, status: "desktopOnly" as const, models: [] };
      let workspace;
      try {
        const exe = await deps.cli.executable(kind);
        if (!exe) return { label, status: "unavailable" as const, models: [] };
        workspace = await deps.cli.workspace();
        const spec = cliSpecs[kind];
        const help = await deps.cli.runner.run(exe, spec.help, { cwd: workspace.dir, timeoutMs: 4500, stdin: "" });
        const available = help.code === 0 && spec.guards.every(guard => help.stdout.includes(guard));
        return { label, status: available ? "available" as const : "unavailable" as const, models: [] };
      } catch { return { label, status: "unavailable" as const, models: [] }; }
      finally { await workspace?.cleanup().catch(() => undefined); }
    }),
    ...local.map(async kind => {
      const label = kind === "ollama" ? "Ollama" : "LM Studio";
      const base = endpointBase((settings.local === kind && settings.localUrl) || localDefaults[kind], true);
      try {
        if (!base) throw new Error("Invalid local URL");
        const reply = await deps.http.request({ method: "GET", url: kind === "ollama"
          ? apiPath(base, "/api", "/tags") : apiPath(base, "/v1", "/models") });
        if (reply.status < 200 || reply.status >= 300 || reply.text.length > 262_144) throw new Error("Unavailable");
        const result = asObject(JSON.parse(reply.text));
        const items: unknown = kind === "ollama" ? result.models : result.data;
        const models = Array.isArray(items) ? items.slice(0, 10).map(item => asObject(item)[kind === "ollama" ? "name" : "id"])
          .filter((name): name is string => typeof name === "string" && name.length <= 96) : [];
        return { label, status: "available" as const, models };
      } catch { return { label, status: "unavailable" as const, models: [] }; }
    }),
  ]);
}
