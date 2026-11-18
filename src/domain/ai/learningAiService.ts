import { appendCallouts, callout } from "../callout";
import { webUrl } from "../evidenceVerifier";
import { patchTopic, readTopic } from "../frontmatter";
import { recordEvidence, topicState } from "../rubric";
import { runProvider } from "./chain";
import { buildPrompt } from "./promptBuilder";
import { validateOutput } from "./outputValidator";
import type { AiAction, AiAxis, AiProvider, Evaluation, LearningContext, PreparedAi, SourceContext, TeachOutput } from "./types";

export class LearningAiService {
  constructor(private readonly factory: () => AiProvider | null, private readonly secrets: () => string[]) {}

  prepare<K extends AiAction>(action: K, input: LearningContext): PreparedAi<K> | null {
    if (action === "evaluate" && (!input.axis || !input.answer?.trim())) return null;
    const provider = this.factory();
    if (!provider) return null;
    return { action, provider, ...buildPrompt(action, input, this.secrets()) };
  }

  async send<K extends AiAction>(prepared: PreparedAi<K> | null, approved: boolean) {
    if (!prepared || !approved) return null;
    const raw = await runProvider(prepared.provider, prepared.prompt, approved, this.secrets());
    return raw ? validateOutput(prepared.action, raw, prepared.sources.length) : null;
  }
}

const plain = (text: string) => text.replace(/[\\[<>&]/g, char => "\\" + char);

export function saveAiTeaching(markdown: string, result: TeachOutput, sources: readonly SourceContext[],
    day: string, label: string): string {
  const lines = ["independent_problem: " + plain(result.problem), "ai_explanation: " + plain(result.explanation),
    ...result.steps.map(plain)];
  for (const ref of result.source_refs) {
    const source = sources[ref - 1];
    if (!source) continue;
    const url = webUrl(source.url);
    lines.push("ai_source: " + plain(source.title) + (url ? " · " + url : ""));
  }
  return patchTopic(markdown, { cl_updated: day },
    body => appendCallouts(body, callout("teach", label + " · " + day, lines.join("\n"))));
}

export function saveAiEvaluation(markdown: string, axis: AiAxis, result: Evaluation, day: string, title: string) {
  const note = readTopic(markdown);
  if (!note) throw new Error("Unsupported learning note");
  const rubric = recordEvidence(note.topic.cl_axes, axis, result.score, "observed_ai", day);
  return patchTopic(markdown, { cl_axes: rubric, cl_updated: day,
    cl_state: topicState(note.topic.cl_state, rubric, note.topic.cl_state === "needs_reassessment") },
  body => appendCallouts(body, callout("feedback", title + " · " + day,
    "axis: " + axis + "\nscore: " + result.score + "\nsource: observed_ai\ngap_hypothesis: " +
      plain(result.gap_hypothesis) + "\n\n" + plain(result.feedback))));
}
