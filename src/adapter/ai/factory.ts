import type { AiSettings } from "../../domain/ai/types";
import { cliSpecs, isSafeModelName } from "./cliSpecs";
import { endpointBase, type HttpClient } from "./http";
import { apiDefaults, cliProvider, httpProvider, localDefaults } from "./providers";
import type { CliEnvironment } from "./runner";

export interface AiDependencies { http: HttpClient; cli?: CliEnvironment }

export function makeAiProvider(settings: AiSettings, deps: AiDependencies, key: string) {
  switch (settings.provider) {
    case "off": return null;
    case "cli":
      if (!deps.cli || cliSpecs[settings.cli].detectOnly) return null;
      if (settings.model ? !isSafeModelName(settings.model) : settings.cli === "ollama") return null;
      if (settings.cli === "ollama" && /(?:-|:)cloud(?:[:/]|$)/i.test(settings.model)) return null;
      return cliProvider(deps.cli, settings.cli, settings.model);
    case "local": {
      const base = endpointBase(settings.localUrl || localDefaults[settings.local], true);
      if (!base || !isSafeModelName(settings.model) || /(?:-|:)cloud(?:[:/]|$)/i.test(settings.model)) return null;
      return httpProvider(deps.http, settings.local, base, settings.model);
    }
    case "api": {
      const base = endpointBase((settings.api === "openai" && settings.apiUrl) || apiDefaults[settings.api], false);
      if (!base || !key || !isSafeModelName(settings.model)) return null;
      return httpProvider(deps.http, settings.api, base, settings.model, key);
    }
  }
}
