import { asObject } from "../../domain/ai/outputValidator";
import type { CliKind } from "../../domain/ai/types";

export function isSafeModelName(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/.test(model) && !model.includes("..");
}

export const cliNames: Record<CliKind, string> = {
  claude: "Claude Code", codex: "Codex CLI", gemini: "Gemini CLI", ollama: "Ollama CLI",
};

export const geminiPolicy = JSON.stringify({
  tools: { core: ["curiosity_no_tools"] },
  context: { fileName: [] },
  hooksConfig: { enabled: false },
  security: { disableYoloMode: true },
  telemetry: { enabled: false },
});

interface CliSpec {
  help: string[];
  guards: string[];
  args(model: string): string[];
  parse(stdout: string): string;
}

function jsonField(output: string, field: string) {
  const content = asObject(JSON.parse(output));
  return content.is_error !== true && typeof content[field] === "string" ? content[field] : "";
}

function codexText(stdout: string) {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const event = asObject(JSON.parse(line));
      const item = asObject(event.item);
      if (event.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") return item.text;
    } catch { /* Ignore non-event lines. */ }
  }
  return "";
}

const modelFlag = (model: string) => model ? ["--model", model] : [];
export const cliSpecs: Record<CliKind, CliSpec> = {
  claude: {
    help: ["--help"], guards: ["--safe-mode", "--tools", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "--permission-prompts"],
    args: model => ["-p", "--tools", "", "--safe-mode", "--strict-mcp-config", "--disable-slash-commands",
      "--permission-mode", "dontAsk", "--permission-prompts", "none", "--no-session-persistence",
      "--output-format", "json", ...modelFlag(model)],
    parse: output => jsonField(output, "result"),
  },
  codex: {
    help: ["exec", "--help"], guards: ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--sandbox", "--disable"],
    args: model => ["--ask-for-approval", "never", "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral",
      "--sandbox", "read-only", "--skip-git-repo-check", "--disable", "shell_tool", "--disable", "multi_agent",
      "--disable", "skill_mcp_dependency_install", "-c", 'web_search="disabled"', "-c", "mcp_servers={}",
      "--json", ...modelFlag(model), "-"],
    parse: codexText,
  },
  gemini: {
    help: ["--help"], guards: ["--extensions", "--output-format", "--approval-mode"],
    args: model => ["--extensions", "none", "--approval-mode", "default", "--output-format", "json",
      ...modelFlag(model)],
    parse: output => jsonField(output, "response"),
  },
  ollama: {
    help: ["run", "--help"], guards: ["--nowordwrap"],
    args: model => ["run", model, "--nowordwrap"],
    parse: stdout => stdout.trim(),
  },
};
