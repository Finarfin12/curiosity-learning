import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { agyDetectOnlyReason, agyForbiddenArgs, agyRequiredArgs, assertCliArgs, cliNames, cliSpecs } from "../src/adapter/ai/cliSpecs";
import { checkActiveProvider, detectProviders, parseAgyModels } from "../src/adapter/ai/detector";
import { makeAiProvider } from "../src/adapter/ai/factory";
import { cliProvider } from "../src/adapter/ai/providers";
import type { CliEnvironment, RunOptions } from "../src/adapter/ai/runner";
import { defaultAi, normalizeAi, type AiSettings, type CliKind } from "../src/domain/ai/types";

// Sanitized real output of `agy models` on the developer PC (2026-11-21): header line, then id<TAB>display name.
const AGY_LISTING = [
  "Fetching available models...",
  "gemini-4-neon-high\tGemini 4 Neon (High)",
  "gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)",
  "gemini-pro-orchestrator-neon\tOrchestrator (Neon)",
  "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
  "claude-opus-5-5-high\tClaude Opus 5.5 (High)",
  "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
  "",
].join("\r\n");

const http = { request: vi.fn() };
const settings = (cli: CliKind): AiSettings => ({ ...defaultAi, provider: "cli", cli });

function env(kind: string, over: { installed?: boolean; run?: CliEnvironment["runner"]["run"]; files?: Record<string, string> } = {}) {
  const calls: string[][] = [];
  const run = vi.fn((file: string, args: string[], opts: RunOptions) => {
    void file; void opts;
    calls.push(args);
    return over.run ? over.run(file, args, opts) : Promise.resolve({ code: 0, stdout: "" });
  });
  const cleanup = vi.fn(() => Promise.resolve());
  const workspace = vi.fn(() => Promise.resolve({ dir: "/empty", write: vi.fn(() => Promise.resolve("x")), cleanup }));
  const executable = vi.fn(() => Promise.resolve(over.installed === false ? null : "/fixture/" + kind));
  const cli: CliEnvironment = {
    runner: { run }, executable, workspace,
    readFile: (p: string) => Promise.resolve(over.files?.[p] ?? null), homeDir: () => "/home/u", env: () => undefined,
  };
  return { cli, run, calls, workspace, cleanup, executable };
}

test("A1: parses `agy models`: id<TAB>name, header dropped, duplicates and unsafe ids dropped, original order kept", () => {
  const parsed = parseAgyModels(AGY_LISTING);
  expect(parsed.ids).toEqual(["gemini-4-neon-high", "gemini-4-neon-xhigh", "gemini-pro-orchestrator-neon", "gemini-3.8-flash-low", "claude-opus-5-5-high", "gpt-oss-120b-medium"]);
  expect(parsed.labels["gemini-4-neon-high"]).toBe("Gemini 4 Neon (High)");
  expect(parsed.labels["gemini-3.8-flash-low"]).toBe("Gemini 3.8 Flash (Low)");
  const nasty = parseAgyModels("--flag\tNope\nhas space\tNo\nok-1\t\nok-1\tDuplicate\n\tNoId\nplain line\nok-2\tTwo");
  expect(nasty.ids).toEqual(["ok-1", "ok-2"]);
  expect(nasty.labels["ok-1"]).toBe("ok-1");
  expect(parseAgyModels("").ids).toEqual([]);
  expect(parseAgyModels("Fetching available models...\n").ids).toEqual([]);
  expect(parseAgyModels(Array.from({ length: 200 }, (_, i) => `m-${i}\tModel ${i}`).join("\n")).ids).toHaveLength(60);
});

test("A1: detection runs ONLY `agy models`, lists names for ids, marks the provider detect-only", async () => {
  const { cli, calls, cleanup } = env("agy", { run: () => Promise.resolve({ code: 0, stdout: AGY_LISTING }) });
  const result = await checkActiveProvider(settings("agy"), { http, cli });
  expect(calls).toEqual([["models"]]);
  expect(result).toMatchObject({ label: "Antigravity CLI", connected: true, status: "available", detectOnly: true });
  expect(result.models).toHaveLength(6);
  expect(result.labels?.["claude-opus-5-5-high"]).toBe("Claude Opus 5.5 (High)");
  expect(cleanup).toHaveBeenCalled();
});

test("A1: the listing is also part of the all-providers check, with display names", async () => {
  const { cli } = env("agy", { run: (_f, args) => Promise.resolve(args[0] === "models" ? { code: 0, stdout: AGY_LISTING } : { code: 1, stdout: "" }) });
  const all = await detectProviders({ ...defaultAi, provider: "cli" }, { http: { request: vi.fn(() => Promise.reject(new Error("down"))) }, cli });
  const agy = all.find(p => p.label === cliNames.agy);
  expect(agy).toMatchObject({ status: "available", detectOnly: true });
  expect(agy?.models).toHaveLength(6);
});

test("A2: agy not installed => Unavailable, no models, nothing run", async () => {
  const { cli, run, workspace } = env("agy", { installed: false });
  const result = await checkActiveProvider(settings("agy"), { http, cli });
  expect(result).toMatchObject({ connected: false, status: "unavailable", models: [] });
  expect(run).not.toHaveBeenCalled();
  expect(workspace).not.toHaveBeenCalled();
  const mobile = await checkActiveProvider(settings("agy"), { http });
  expect(mobile).toMatchObject({ connected: false, status: "desktopOnly", models: [] });
});

test("A3: `agy models` failing, timing out or crashing => empty list, clear status, no throw", async () => {
  const failing = env("agy", { run: () => Promise.resolve({ code: 1, stdout: "not logged in" }) });
  expect(await checkActiveProvider(settings("agy"), { http, cli: failing.cli })).toMatchObject({ connected: false, status: "unavailable", models: [] });
  const timeout = env("agy", { run: () => Promise.reject(new Error("AI CLI unavailable")) });
  expect(await checkActiveProvider(settings("agy"), { http, cli: timeout.cli })).toMatchObject({ connected: false, status: "unavailable", models: [] });
  const garbage = env("agy", { run: () => Promise.resolve({ code: 0, stdout: "\u0000\u0001 garbage without tabs" }) });
  expect(await checkActiveProvider(settings("agy"), { http, cli: garbage.cli })).toMatchObject({ connected: true, models: [] });
  // the models command is given a longer timeout than --help
  const seen: number[] = [];
  const timed = env("agy", { run: (_f, _a, opts) => { seen.push(opts.timeoutMs); return Promise.resolve({ code: 0, stdout: AGY_LISTING }); } });
  await checkActiveProvider(settings("agy"), { http, cli: timed.cli });
  expect(seen).toEqual([15_000]);
});

test("A4: guard: every required flag must be present and every forbidden flag is refused", () => {
  expect(agyRequiredArgs).toEqual([["-p"], ["--output-format", "json"], ["--disable-slash-commands"], ["--sandbox"]]);
  const good = ["-p", "--output-format", "json", "--disable-slash-commands", "--sandbox", "--model", "x"];
  expect(() => assertCliArgs("agy", good)).not.toThrow();
  for (const guard of agyRequiredArgs) {
    const without = good.filter((_, i) => !(i >= good.indexOf(guard[0]) && i < good.indexOf(guard[0]) + guard.length));
    expect(() => assertCliArgs("agy", without), guard.join(" ")).toThrow(/missing/);
  }
  expect(() => assertCliArgs("agy", ["-p", "--output-format", "text", "--disable-slash-commands", "--sandbox"])).toThrow(/output-format json/);
  for (const bad of ["--dangerously-skip-permissions", "--continue", "-c", "--conversation", "--remote-control", "--prompt-interactive", "--remote-agent", "--add-dir"]) {
    expect(agyForbiddenArgs).toContain(bad);
    expect(() => assertCliArgs("agy", [...good, bad]), bad).toThrow(/forbidden/);
  }
  expect(() => assertCliArgs("claude", ["anything"])).not.toThrow(); // other CLIs are unaffected
});

test("A4: agy is detect-only: no provider is built, a direct call refuses before any file or process access", async () => {
  expect(cliSpecs.agy.detectOnly).toBe(agyDetectOnlyReason);
  expect(() => cliSpecs.agy.args("m")).toThrow(/Detect only/);
  expect(() => cliSpecs.agy.parse("{}")).toThrow(/Detect only/);
  const { cli, run, workspace, executable } = env("agy");
  expect(makeAiProvider({ ...settings("agy"), model: "gemini-3.8-flash-low" }, { http, cli }, "")).toBeNull();
  await expect(cliProvider(cli, "agy", "gemini-3.8-flash-low").generate({ system: "s", context: "c" })).rejects.toThrow(/Detect only/);
  expect(run).not.toHaveBeenCalled();
  expect(workspace).not.toHaveBeenCalled();
  expect(executable).not.toHaveBeenCalled();
});

test("A4: the saved CLI choice 'agy' survives settings normalization; unknown values still fall back to Claude", () => {
  expect(normalizeAi({ cli: "agy" }).cli).toBe("agy");
  expect(normalizeAi({ cli: "nonsense" as CliKind }).cli).toBe("claude");
});

test("A5: Gemini CLI not installed => Unavailable with no invented models; installed (fixture) => 0.4.4 behaviour kept", async () => {
  const absent = env("gemini", { installed: false });
  expect(await checkActiveProvider(settings("gemini"), { http, cli: absent.cli })).toMatchObject({ connected: false, status: "unavailable", models: [] });
  expect(absent.run).not.toHaveBeenCalled();
  const present = env("gemini", {
    files: { "/home/u/.gemini/settings.json": JSON.stringify({ model: { name: "gemini-fixture-pro" } }) },
    run: (_f, args) => Promise.resolve(args.includes("--help") ? { code: 0, stdout: cliSpecs.gemini.guards.join("\n") } : { code: 0, stdout: "" }),
  });
  const result = await checkActiveProvider(settings("gemini"), { http, cli: present.cli });
  expect(result).toMatchObject({ connected: true, status: "available" });
  expect(result.models).toContain("gemini-fixture-pro");
  expect(result.detectOnly).toBeUndefined();
  expect(cliSpecs.gemini.detectOnly).toBeUndefined();
  expect(cliSpecs.claude.detectOnly).toBeUndefined();
  expect(cliSpecs.codex.detectOnly).toBeUndefined();
});

test("A6: no hardcoded model identifiers anywhere in src (only fixtures in tests)", () => {
  const SRC = resolve(__dirname, "..", "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(SRC);
  const pattern = /["'`](?:gpt-\d[\w.-]*|claude-(?:opus|sonnet|haiku|fable)-\d[\w.-]*|gemini-\d[\w.-]*|llama\d[\w.:-]*|qwen\d[\w.:-]*)["'`]/i;
  const offenders = files.filter(f => pattern.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  expect(offenders.map(f => f.replace(SRC, ""))).toEqual([]);
});
