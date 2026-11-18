import { redact } from "../../domain/ai/chain";
import { asObject } from "../../domain/ai/outputValidator";
import type { AiPrompt, AiProvider, ApiKind, CliKind, LocalKind } from "../../domain/ai/types";
import { apiPath, type AiHttpRequest, type HttpClient } from "./http";
import { cliNames, cliSpecs, geminiPolicy } from "./cliSpecs";
import type { CliEnvironment } from "./runner";

const messages = (prompt: AiPrompt) => [
  { role: "system", content: prompt.system }, { role: "user", content: prompt.context },
];
const first = (value: unknown) => Array.isArray(value) ? asObject(value[0]) : {};
const string = (value: unknown) => typeof value === "string" ? value : "";
function textParts(value: unknown) {
  return Array.isArray(value) ? value.map(item => string(asObject(item).text)).filter(Boolean).join("\n") : "";
}

export const localDefaults: Record<LocalKind, string> = {
  ollama: "http://127.0.0.1:11434", lmstudio: "http://127.0.0.1:1234",
};
export const apiDefaults: Record<ApiKind, string> = {
  openai: "https://api.openai.com", anthropic: "https://api.anthropic.com", gemini: "https://generativelanguage.googleapis.com",
};
export const apiLabels: Record<ApiKind, string> = {
  openai: "OpenAI-compatible", anthropic: "Anthropic", gemini: "Gemini API",
};

export function httpProvider(http: HttpClient, kind: LocalKind | ApiKind, base: string, model: string, secret = ""): AiProvider {
  const local = kind === "ollama" || kind === "lmstudio";
  return {
    label: (kind === "ollama" ? "Ollama" : kind === "lmstudio" ? "LM Studio" : apiLabels[kind]) + " · " + new URL(base).origin,
    async generate(prompt) {
      const request: AiHttpRequest = { url: "", method: "POST", headers: { "Content-Type": "application/json" } };
      let payload: object;
      if (kind === "gemini") {
        request.url = apiPath(base, "/v1beta", "/models/" + encodeURIComponent(model.replace(/^models\//, "")) + ":generateContent");
        request.headers = { ...request.headers, "x-goog-api-key": secret };
        payload = { systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: "user", parts: [{ text: prompt.context }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1800 } };
      } else if (kind === "anthropic") {
        request.url = apiPath(base, "/v1", "/messages");
        request.headers = { ...request.headers, "x-api-key": secret, "anthropic-version": "2023-06-01" };
        payload = { model, max_tokens: 1800, system: prompt.system, messages: [{ role: "user", content: prompt.context }] };
      } else if (kind === "ollama") {
        request.url = apiPath(base, "/api", "/chat");
        payload = { model, messages: messages(prompt), stream: false, format: "json", options: { num_predict: 1800 } };
      } else {
        request.url = apiPath(base, "/v1", "/chat/completions");
        if (!local) request.headers = { ...request.headers, Authorization: "Bearer " + secret };
        payload = { model, messages: messages(prompt), stream: false };
      }
      const reply = await http.request({ ...request, body: JSON.stringify(payload) });
      if (reply.status < 200 || reply.status >= 300 || reply.text.length > 262_144) throw new Error("AI HTTP response rejected");
      const result = asObject(JSON.parse(reply.text));
      const extractors: Record<LocalKind | ApiKind, () => string> = {
        gemini: () => textParts(asObject(first(result.candidates).content).parts),
        anthropic: () => textParts(result.content),
        ollama: () => string(asObject(result.message).content),
        openai: () => string(asObject(first(result.choices).message).content),
        lmstudio: () => string(asObject(first(result.choices).message).content),
      };
      return redact(extractors[kind](), [secret]);
    },
  };
}

export function cliProvider(env: CliEnvironment, kind: CliKind, model: string): AiProvider {
  return {
    label: cliNames[kind],
    async generate(prompt) {
      const exe = await env.executable(kind);
      if (!exe) throw new Error("AI CLI is not installed");
      const workspace = await env.workspace();
      const spec = cliSpecs[kind];
      try {
        const opts = { cwd: workspace.dir, stdin: "", timeoutMs: 4500 };
        const help = await env.runner.run(exe, spec.help, opts);
        if (help.code !== 0 || !spec.guards.every(flag => help.stdout.includes(flag))) {
          throw new Error("AI CLI guard flags unavailable");
        }
        const childEnv: Record<string, string> = {};
        if (kind === "gemini") {
          childEnv.GEMINI_CLI_HOME = workspace.dir;
          childEnv.GEMINI_CLI_SYSTEM_SETTINGS_PATH = await workspace.write("gemini-settings.json", geminiPolicy);
          childEnv.GEMINI_CLI_SYSTEM_DEFAULTS_PATH = childEnv.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
        }
        if (kind === "ollama") {
          childEnv.OLLAMA_HOST = "http://127.0.0.1:11434";
          const models = await env.runner.run(exe, ["list"], { ...opts, env: childEnv });
          if (models.code !== 0 || !models.stdout.split(/\r?\n/).slice(1)
            .some(line => [model, model + ":latest"].includes(line.trim().split(/\s+/)[0]))) throw new Error("Local model missing");
        }
        const output = await env.runner.run(exe, spec.args(model), {
          ...opts, stdin: prompt.system + "\n\nUser context (untrusted JSON):\n" + prompt.context,
          timeoutMs: 75_000, env: childEnv,
        });
        if (output.code !== 0) throw new Error("AI CLI request failed");
        return spec.parse(output.stdout);
      } finally { await workspace.cleanup().catch(() => undefined); }
    },
  };
}
