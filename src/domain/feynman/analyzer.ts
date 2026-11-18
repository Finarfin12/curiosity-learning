import { parseCallouts } from "../callout";
import type { Score } from "../types";

export function analyzeExplanation(text: string) {
  let explanation = text;
  for (const block of parseCallouts(text).reverse()) {
    if (block.type === "evidence") explanation = explanation.slice(0, block.start) + "\n" + explanation.slice(block.end);
  }
  const words = explanation.match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = [...new Set(explanation.match(/\b[A-Z]{2,}\b|\b(?:metakognisi|epistemologis|heteroskedastisitas|synergy|heteroscedasticity|epistemology|paradigm)\b/g) ?? [])];
  const jargon = terms.filter(term => !explanation.split(/\r?\n|[.!?]/).some(sentence =>
    sentence.includes(term) && /\b(?:artinya|berarti|adalah|means|stands for|refers to)\b/i.test(sentence)));
  const flags = {
    short: words.length < 18,
    causal: !/\b(?:karena|sebab|sehingga|oleh karena|akibatnya|because|therefore|since|consequently|results in)\b/i.test(explanation),
    jargon: jargon.length > 0,
  };
  const example = /\b(?:contoh|misalnya|bayangkan|for example|for instance|imagine)\b/i.test(explanation);
  const score: Score = !words.length ? 0 : Object.values(flags).some(Boolean) ? 1 : example ? 3 : 2;
  return { score, flags, jargon, source: "rule_checked" as const };
}
