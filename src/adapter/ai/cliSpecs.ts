import { asObject } from "../../domain/ai/outputValidator";
import type { CliKind } from "../../domain/ai/types";

export function isSafeModelName(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/.test(model) && !model.includes("..");
}

export const cliNames: Record<CliKind, string> = {
  claude: "Claude Code", codex: "Codex CLI", gemini: "Gemini CLI", ollama: "Ollama CLI", agy: "Antigravity CLI",
};

/**
 * Antigravity CLI (agy 1.5.14) is DETECT-ONLY: its models are listed (`agy models`) but it never runs a question.
 * Verified on the developer PC (evidence in the 0.5.0 report):
 *  - `agy --help` has no flag that disables tools: `--sandbox` only restricts the terminal, `--mode plan` prints
 *    "has no effect while slash command expansion is disabled" (and slash commands must stay disabled), and the keys
 *    of `--settings` are not documented in --help.
 *  - Real run with -p --output-format json --disable-slash-commands --sandbox: the agent wrote a file AND ran a shell command.
 *  - Real run with --settings {"toolPermission":"request-review","allowNonWorkspaceAccess":false}: it still wrote a file
 *    and read a file OUTSIDE the workspace (the shell command was refused by the sandbox).
 * Rule: run a CLI only when all of its tools are verifiably off. Not verified => detect only.
 */
export const agyDetectOnlyReason =
  "Detect only: the Antigravity CLI cannot be run for questions because no verified flag disables all of its tools " +
  "(in a real test it still wrote files and read files outside its workspace).";

/** Flags every agy command line must carry if it is ever enabled, and flags it must never carry. */
export const agyRequiredArgs: string[][] = [["-p"], ["--output-format", "json"], ["--disable-slash-commands"], ["--sandbox"]];
export const agyForbiddenArgs = [
  "--dangerously-skip-permissions", "--continue", "-c", "--conversation", "--remote-control", "--remote-agent",
  "--prompt-interactive", "-i", "--add-dir", "--agent", "--project", "--new-project",
];

/** Refuse an argument list that lacks a required flag or contains a forbidden one (defense in depth). */
export function assertCliArgs(kind: CliKind, args: string[]): void {
  if (kind !== "agy") return;
  for (const bad of agyForbiddenArgs) {
    if (args.includes(bad)) throw new Error("forbidden argument: " + bad);
  }
  for (const guard of agyRequiredArgs) {
    const at = args.indexOf(guard[0]);
    if (at < 0 || !guard.every((part, offset) => args[at + offset] === part)) {
      throw new Error("safety flag missing: " + guard.join(" "));
    }
  }
}

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
  /** When set, the CLI is detected and its models are listed, but it is never run. The text says why. */
  detectOnly?: string;
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
  agy: {
    // agy prints --help to stderr and the plugin does not read stderr, so detection uses `agy models` instead of --help.
    help: ["--help"], guards: [], detectOnly: agyDetectOnlyReason,
    args: () => { throw new Error(agyDetectOnlyReason); },
    parse: () => { throw new Error(agyDetectOnlyReason); },
  },
  ollama: {
    help: ["run", "--help"], guards: ["--nowordwrap"],
    args: model => ["run", model, "--nowordwrap"],
    parse: stdout => stdout.trim(),
  },
};
