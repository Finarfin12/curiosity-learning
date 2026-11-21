import type { Axis, Score } from "../types";

export type CliKind = "claude" | "codex" | "gemini" | "ollama" | "agy";
export type LocalKind = "ollama" | "lmstudio";
export type ApiKind = "openai" | "anthropic" | "gemini";
export type AiMode = "off" | "cli" | "local" | "api";

export interface AiSettings {
  provider: AiMode;
  cli: CliKind;
  local: LocalKind;
  api: ApiKind;
  localUrl: string;
  apiUrl: string;
  model: string;
}

export const defaultAi: AiSettings = {
  provider: "off", cli: "claude", local: "ollama", api: "openai", localUrl: "", apiUrl: "", model: "",
};

export function normalizeAi(value?: Partial<AiSettings> | null): AiSettings {
  const from = value ?? {};
  return {
    provider: from.provider === "local" || from.provider === "api" || from.provider === "cli" ? from.provider : "off",
    cli: from.cli === "codex" || from.cli === "gemini" || from.cli === "ollama" || from.cli === "agy" ? from.cli : "claude",
    local: from.local === "lmstudio" ? "lmstudio" : "ollama",
    api: from.api === "anthropic" || from.api === "gemini" ? from.api : "openai",
    localUrl: typeof from.localUrl === "string" ? from.localUrl.trim() : "",
    apiUrl: typeof from.apiUrl === "string" ? from.apiUrl.trim() : "",
    model: typeof from.model === "string" ? from.model.trim() : "",
  };
}

export type AiAxis = Exclude<Axis, "retention">;
export type AiAction = "teach" | "diagnostic" | "equivalent" | "evaluate";
export interface SourceContext { title: string; excerpt: string; url?: string }
export interface LearningContext {
  language: "id" | "en";
  goal: string;
  question: string;
  explanation?: string;
  gap?: string;
  answer?: string;
  axis?: AiAxis;
  mode?: "socratic" | "devil";
  sources?: SourceContext[];
}
export interface AiPrompt { system: string; context: string }
export interface AiProvider { readonly label: string; generate(prompt: AiPrompt): Promise<string> }
export interface TeachOutput { explanation: string; steps: [string, string, string]; problem: string; source_refs: number[] }
export interface Evaluation { score: Score; gap_hypothesis: string; feedback: string }
export interface AiOutputs {
  teach: TeachOutput;
  diagnostic: { question: string };
  equivalent: { problem: string };
  evaluate: Evaluation;
}
export interface AiPreview {
  language: string;
  goal: string;
  question: string;
  answer?: string;
  explanation?: string;
  gap?: string;
  axis?: AiAxis;
  mode?: "socratic" | "devil";
  sources?: { id: number; title: string; excerpt: string }[];
}

export interface PreparedAi<K extends AiAction = AiAction> {
  action: K;
  prompt: AiPrompt;
  preview: AiPreview;
  provider: AiProvider;
  sources: SourceContext[];
}
