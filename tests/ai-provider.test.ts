import { expect, test, vi } from "vitest";
import { cliDefaultModels, cliSpecs } from "../src/adapter/ai/cliSpecs";
import { detectModelsForProvider, detectProviders, parseOllamaListModels } from "../src/adapter/ai/detector";
import { makeAiProvider } from "../src/adapter/ai/factory";
import type { AiHttpRequest } from "../src/adapter/ai/http";
import { apiDefaultModels } from "../src/adapter/ai/providers";
import type { CliEnvironment, RunOptions } from "../src/adapter/ai/runner";
import { redact } from "../src/domain/ai/chain";
import { LearningAiService, saveAiEvaluation, saveAiTeaching } from "../src/domain/ai/learningAiService";
import { parseEvaluationOutput, parseTeachOutput, validateOutput } from "../src/domain/ai/outputValidator";
import { SYSTEM_RULES } from "../src/domain/ai/promptBuilder";
import { defaultAi, type AiSettings, type CliKind, type LearningContext } from "../src/domain/ai/types";
import { parseWorkedExample } from "../src/domain/fading";
import { parseCallouts } from "../src/domain/callout";
import { readTopic } from "../src/domain/frontmatter";
import { createTopic } from "../src/domain/templates";
import { day } from "./helpers";

const key = "fixture-key-not-a-real-key";
const synth = JSON.stringify({ score: 2, gap_hypothesis: "Add a boundary case.", feedback: "Clear causal explanation." });
const context: LearningContext = { language: "en", goal: "Explain equal fractions", question: "Why do they match?",
  answer: "Both terms are scaled by the same factor.", axis: "explanation" };

const note = () => createTopic({ goal: context.goal, question: context.question, guess: "The scale cancels.", confidence: 70 },
  day, "ai-fixture", "en");

function cliMock(kind: CliKind = "claude", adequate = true) {
  const spec = cliSpecs[kind];
  const stdout = kind === "claude" ? JSON.stringify({ result: synth }) :
    kind === "gemini" ? JSON.stringify({ response: synth }) :
    kind === "codex" ? JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: synth } }) : synth;
  const run = vi.fn((file: string, args: string[], opts: RunOptions) => {
    void file; void opts;
    if (args.includes("--help")) return Promise.resolve({ code: 0, stdout: adequate ? spec.guards.join("\n") : "" });
    if (args[0] === "list") return Promise.resolve({ code: 0, stdout: "NAME ID SIZE\nfixture:latest 0123 2GB" });
    return Promise.resolve({ code: 0, stdout });
  });
  const write = vi.fn(() => Promise.resolve("QA/gemini-settings.json"));
  const cleanup = vi.fn(() => Promise.resolve());
  const cli: CliEnvironment = { runner: { run }, executable: () => Promise.resolve("/fixture/" + kind),
    workspace: () => Promise.resolve({ dir: "/empty-qa", write, cleanup }) };
  return { cli, run, write, cleanup };
}

test("KT-11: off and rejected approval produce zero HTTP or process calls", async () => {
  const request = vi.fn();
  const { cli, run } = cliMock();
  const factory = () => makeAiProvider(defaultAi, { http: { request }, cli }, key);
  const service = new LearningAiService(factory, () => [key]);
  expect(service.prepare("evaluate", context)).toBeNull();
  expect(await detectProviders(defaultAi, { http: { request }, cli })).toEqual([]);
  const candidate = new LearningAiService(() => makeAiProvider({ ...defaultAi, provider: "cli" },
    { http: { request }, cli }, key), () => [key]);
  expect(await candidate.send(candidate.prepare("evaluate", context), false)).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("KT-11: approved context is clipped, masked and applied as observed AI only after selection", async () => {
  const request = vi.fn((body: AiHttpRequest) => {
    expect(body.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(body.body).toContain("Use no tools");
    expect(body.body).not.toContain(key);
    return Promise.resolve({ status: 200, text: JSON.stringify({ message: { content: synth } }) });
  });
  const provider = { ...defaultAi, provider: "local", model: "fixture" } as const;
  const ai = new LearningAiService(() => makeAiProvider(provider, { http: { request } }, ""), () => [key]);
  const prepared = ai.prepare("evaluate", { ...context, answer: key + " <context> " + "a".repeat(2100) })!;
  expect(prepared.prompt.context).toContain("[REDACTED] ‹context›");
  expect(JSON.parse(prepared.prompt.context) as unknown).toEqual(prepared.preview);
  expect(prepared.preview).toMatchObject({ axis: "explanation", language: "English" });
  expect(prepared.prompt.context.length).toBeLessThan(2000);
  expect(request).not.toHaveBeenCalled();
  const result = await ai.send(prepared, true);
  const saved = saveAiEvaluation(note(), "explanation", result!, day, "AI evaluation");
  expect(saved).toContain('explanation: "2 (ai)"');
  expect(saved).not.toContain(key);
  const rubric = readTopic(saved)?.topic.cl_axes;
  expect(rubric?.explanation).toMatchObject({ score: 2, source: "observed_ai" });
  expect(rubric?.retention.score).toBe("not_tested");
  expect(request).toHaveBeenCalledTimes(1);
});

test("KT-11: malformed or fabricated output returns null and leaves the manual path usable", async () => {
  const request = vi.fn(() => Promise.resolve({ status: 200, text: '{"message":{"content":"not JSON"}}' }));
  const ai = new LearningAiService(() => makeAiProvider({ ...defaultAi, provider: "local", model: "fixture" },
    { http: { request } }, ""), () => []);
  const original = note();
  expect(await ai.send(ai.prepare("evaluate", context), true)).toBeNull();
  expect(readTopic(original)?.topic.cl_axes.explanation.score).toBe("not_tested");
  expect(parseEvaluationOutput('{"score":4,"gap_hypothesis":"gap","feedback":"good"}')).toBeNull();
  expect(validateOutput("diagnostic", '{"question":"One? Two?"}', 0)).toBeNull();
  expect(validateOutput("equivalent", '{"problem":"Read https://invented.example"}', 0)).toBeNull();
  expect(SYSTEM_RULES).toContain("Never invent or output DOI, URLs, or bibliographic citations");
});

test("KT-11: echoes redact known credentials and transport exceptions stay private", async () => {
  expect(redact("x " + key + " k.", [key, "k"])).toBe("x [REDACTED] [REDACTED].");
  const provider = { ...defaultAi, provider: "api", model: "fixture" } as const;
  const request = vi.fn(() => Promise.resolve({
    status: 200, text: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ score: 2, gap_hypothesis: "Spacing", feedback: key }) } }],
    }),
  }));
  const ai = new LearningAiService(() => makeAiProvider(provider, { http: { request } }, key), () => [key]);
  const approved = ai.prepare("evaluate", context)!;
  const result = await ai.send(approved, true);
  expect(result?.feedback).toBe("[REDACTED]");
  expect(saveAiEvaluation(note(), "explanation", result!, day, "AI")).not.toContain(key);
  request.mockRejectedValueOnce(Object.assign(new Error("HTTP header Authorization: " + key), { cause: key }));
  expect(await ai.send(approved, true)).toBeNull();
  const { cli, run } = cliMock();
  run.mockRejectedValueOnce(new Error("CLI error " + key));
  const cliAi = new LearningAiService(() => makeAiProvider({ ...defaultAi, provider: "cli" },
    { cli, http: { request } }, ""), () => [key]);
  expect(await cliAi.send(cliAi.prepare("evaluate", context), true)).toBeNull();
});

test("KT-11: teaching shows numbered source references and remains compatible with fading", async () => {
  const generated = { explanation: "Model the same-size parts.", steps: ["Find the common denominator", "Rewrite each fraction", "Add the parts"],
    problem: "How would you add one third to one fourth?", source_refs: [1] };
  const ai = new LearningAiService(() => ({ label: "Fixture", generate: () => Promise.resolve(JSON.stringify(generated)) }), () => []);
  const session = ai.prepare("teach", { ...context, sources: [{ title: "Recorded source", excerpt: "A unit fraction is one part.",
    url: "https://example.org/source" }] })!;
  const reply = await ai.send(session, true);
  const saved = saveAiTeaching(note(), reply!, session.sources, day, "AI explanation");
  const teach = parseCallouts(readTopic(saved)!.body).find(block => block.type === "teach");
  expect(teach?.title).toContain("AI explanation");
  expect(teach?.body).toContain("https://example.org/source");
  expect(parseWorkedExample(teach!.body)).toMatchObject({ explanation: generated.explanation, steps: generated.steps });
  expect(parseTeachOutput(JSON.stringify({ ...generated, source_refs: [2] }), 1)).toBeNull();
  expect(parseTeachOutput(JSON.stringify({ ...generated, explanation: "See DOI 10.1234/fake" }), 1)).toBeNull();
});

test.each(["claude", "codex", "gemini", "ollama"] as const)("KT-11: %s uses guarded invocation and context only on stdin", async kind => {
  const { cli, run, write, cleanup } = cliMock(kind);
  const settings: AiSettings = { ...defaultAi, provider: "cli", cli: kind, model: "fixture" };
  const request = vi.fn();
  const ai = new LearningAiService(() => makeAiProvider(settings, { cli, http: { request } }, ""), () => []);
  expect(await ai.send(ai.prepare("evaluate", context), true)).toMatchObject({ score: 2 });
  const [, args, options] = run.mock.calls[run.mock.calls.length - 1];
  expect(args.join(" ")).not.toContain(context.answer);
  expect(options.stdin).toContain(context.answer);
  expect(options.cwd).toBe("/empty-qa");
  expect(cleanup).toHaveBeenCalled();
  if (kind === "gemini") {
    expect(options.env?.GEMINI_CLI_HOME).toBe("/empty-qa");
    expect(write).toHaveBeenCalledWith("gemini-settings.json", expect.stringContaining("curiosity_no_tools"));
  }
  if (kind === "ollama") expect(options.env?.OLLAMA_HOST).toBe("http://127.0.0.1:11434");
  expect(request).not.toHaveBeenCalled();
});

test("KT-11: missing flags, invalid model, absent desktop and unsafe endpoints fail closed", async () => {
  const { cli, run } = cliMock("claude", false);
  const http = { request: vi.fn() };
  const ai = new LearningAiService(() => makeAiProvider({ ...defaultAi, provider: "cli" }, { cli, http }, ""), () => []);
  expect(await ai.send(ai.prepare("evaluate", context), true)).toBeNull();
  expect(run).toHaveBeenCalledTimes(1);
  expect(makeAiProvider({ ...defaultAi, provider: "cli" }, { http }, "")).toBeNull();
  expect(makeAiProvider({ ...defaultAi, provider: "cli", model: "--tools" }, { cli, http }, "")).toBeNull();
  expect(makeAiProvider({ ...defaultAi, provider: "local", model: "fixture", localUrl: "http://not-local.example" }, { http }, "")).toBeNull();
  expect(makeAiProvider({ ...defaultAi, provider: "api", model: "fixture", apiUrl: "http://not-tls.example" }, { http }, key)).toBeNull();
  expect(http.request).not.toHaveBeenCalled();
});

test("KT-11: Anthropic, Gemini and LM Studio use the expected request and response formats", async () => {
  for (const [config, path, header, reply] of [
    [{ provider: "api", api: "anthropic" }, "/v1/messages", "x-api-key", { content: [{ text: synth }] }],
    [{ provider: "api", api: "gemini" }, "/v1beta/models/fixture:generateContent", "x-goog-api-key",
      { candidates: [{ content: { parts: [{ text: synth }] } }] }],
    [{ provider: "local", local: "lmstudio" }, "/v1/chat/completions", "",
      { choices: [{ message: { content: synth } }] }],
  ] as const) {
    const request = vi.fn((input: AiHttpRequest) => {
      expect(new URL(input.url).pathname).toBe(path);
      if (header) expect(input.headers?.[header]).toBe(key);
      else expect(input.headers?.Authorization).toBeUndefined();
      return Promise.resolve({ status: 200, text: JSON.stringify(reply) });
    });
    const provider = makeAiProvider({ ...defaultAi, ...config, model: "fixture" }, { http: { request } }, key)!;
    expect(await provider.generate({ system: SYSTEM_RULES, context: "{}" })).toBe(synth);
  }
});

test("KT-11: detectModelsForProvider lists CLI, Local HTTP, and Cloud API models while staying zero-call when off", async () => {
  const offHttp = { request: vi.fn() };
  const offCli = cliMock("claude");
  expect(await detectModelsForProvider(defaultAi, { http: offHttp, cli: offCli.cli }, key)).toEqual([]);
  expect(offHttp.request).not.toHaveBeenCalled();
  expect(offCli.run).not.toHaveBeenCalled();

  expect(parseOllamaListModels("NAME ID SIZE MODIFIED\nqwen2.5:7b abc 4.7 GB 2 days ago\nllama3.2:latest def 2.0 GB 1 day ago"))
    .toEqual(["qwen2.5:7b", "llama3.2:latest"]);

  for (const kind of ["claude", "codex", "gemini"] as const) {
    const { cli } = cliMock(kind);
    const models = await detectModelsForProvider({ ...defaultAi, provider: "cli", cli: kind }, { http: offHttp, cli });
    expect(models).toEqual(cliDefaultModels[kind]);
  }

  const ollamaCli = cliMock("ollama");
  expect(await detectModelsForProvider({ ...defaultAi, provider: "cli", cli: "ollama" },
    { http: offHttp, cli: ollamaCli.cli })).toEqual(["fixture:latest"]);

  const localHttp = vi.fn((req: AiHttpRequest) => {
    if (req.url.endsWith("/api/tags")) {
      return Promise.resolve({ status: 200, text: JSON.stringify({ models: [{ name: "qwen2.5:7b" }, { name: "nomic:v1" }] }) });
    }
    return Promise.resolve({ status: 200, text: JSON.stringify({ data: [{ id: "deepseek-r1-distill" }] }) });
  });
  expect(await detectModelsForProvider({ ...defaultAi, provider: "local", local: "ollama" },
    { http: { request: localHttp } })).toEqual(["qwen2.5:7b", "nomic:v1"]);
  expect(await detectModelsForProvider({ ...defaultAi, provider: "local", local: "lmstudio" },
    { http: { request: localHttp } })).toEqual(["deepseek-r1-distill"]);

  const apiHttp = vi.fn((req: AiHttpRequest) => {
    if (req.url.includes("/v1beta/models")) {
      return Promise.resolve({ status: 200, text: JSON.stringify({ models: [{ name: "models/gemini-2.5-pro-exp" }] }) });
    }
    return Promise.resolve({ status: 200, text: JSON.stringify({ data: [{ id: "custom-model-1" }] }) });
  });
  const openAiModels = await detectModelsForProvider({ ...defaultAi, provider: "api", api: "openai" },
    { http: { request: apiHttp } }, key);
  expect(openAiModels).toEqual(["custom-model-1", ...apiDefaultModels.openai]);
  const geminiModels = await detectModelsForProvider({ ...defaultAi, provider: "api", api: "gemini" },
    { http: { request: apiHttp } }, key);
  expect(geminiModels).toEqual(["gemini-2.5-pro-exp", ...apiDefaultModels.gemini]);
  const anthropicNoKey = await detectModelsForProvider({ ...defaultAi, provider: "api", api: "anthropic" },
    { http: offHttp }, "");
  expect(anthropicNoKey).toEqual(apiDefaultModels.anthropic);
});

