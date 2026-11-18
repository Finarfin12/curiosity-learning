import { callout } from "./callout";

export type EvidenceTier = "meta_analysis_sr" | "rct" | "observational" | "expert_preprint" | "tertiary_wiki";
export type VerificationStatus = "verified_doi" | "verified_url" | "unverified_manual";
export const sources = ["Crossref", "OpenAlex", "PubMed", "Semantic Scholar", "Wikipedia"] as const;
export type SourceName = typeof sources[number];
export interface Citation {
  title: string;
  doi?: string;
  url?: string;
  types?: string[];
  year?: string;
  authors?: string[];
}
export interface Evidence extends Citation {
  source: SourceName | "manual";
  tier: EvidenceTier;
  verification: VerificationStatus;
}

export function normalizeDoi(input = ""): string | undefined {
  const value = input.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  return /^10\.\d{4,9}\/[^\s<>"\\]+$/i.test(value) ? value.toLowerCase() : undefined;
}

export function webUrl(input = ""): string | undefined {
  try {
    const url = new URL(input.trim());
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { return undefined; }
  return undefined;
}

export function classify(citation: Citation, source: Evidence["source"]): EvidenceTier {
  const url = citation.url ? webUrl(citation.url) : undefined;
  const host = url ? new URL(url).hostname : "";
  const types = (citation.types ?? []).join(" ").replace(/[_-]/g, " ");
  const terms = citation.title + " " + types;
  if (source === "Wikipedia" || /(?:^|\.)wikipedia\.org$/.test(host)) return "tertiary_wiki";
  if (/\b(meta[\s-]*analys(?:is|es)|systematic review)\b/i.test(terms)) return "meta_analysis_sr";
  if (/\b(randomi[sz]ed (?:controlled )?(?:clinical )?trial|clinical trial|randomizedcontrolledtrial|clinicaltrial)\b/i.test(terms)) return "rct";
  if (/\b(preprint|posted content|book|proceedings|conference|book chapter)\b/i.test(types) ||
      /(?:^|\.)(?:arxiv|biorxiv|ssrn)\.(?:org|com)$/.test(host)) return "expert_preprint";
  if (/\b(journal article|journalarticle|article|observational)\b/i.test(types)) return "observational";
  return "tertiary_wiki";
}

export function identified(citation: Citation, source: SourceName): Evidence | null {
  const doi = normalizeDoi(citation.doi);
  const url = webUrl(citation.url);
  if (!citation.title.trim() || (!doi && !url)) return null;
  return { ...citation, doi, url, source, tier: classify(citation, source),
    verification: doi ? "verified_doi" : "verified_url" };
}

const common = new Set(["the", "of", "and", "in", "a", "an", "for", "on", "to", "by", "dan", "yang", "di", "ke", "dari"]);
function tokens(title: string) {
  return new Set((title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(token => !common.has(token)));
}

export function titleOverlap(expected: string, actual: string): number {
  const left = tokens(expected);
  const right = tokens(actual);
  const commonCount = [...left].filter(token => right.has(token)).length;
  return commonCount / (Math.max(left.size, right.size) || 1);
}

export function manualEvidence(citation: Citation, match?: Evidence): Evidence {
  const doi = normalizeDoi(citation.doi);
  const url = webUrl(citation.url);
  if (match && titleOverlap(citation.title, match.title) >= 0.6) {
    if (doi && match.doi === doi) return match;
    if (!doi && url && (match.url === url || (match.doi && "https://doi.org/" + match.doi === url))) return { ...citation, url, source: match.source,
      tier: match.tier, verification: "verified_url" };
  }
  return { ...citation, doi, url, source: "manual", tier: classify(citation, "manual"),
    verification: "unverified_manual" };
}

const plainMarkdown = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\[<>&]/g, char => "\\" + char);

export function evidenceBlock(evidence: Evidence, day: string, tertiaryNote: string): string {
  const lines = [
    "source: " + evidence.source,
    "verification: " + evidence.verification,
    "evidence_tier: " + evidence.tier,
  ];
  if (evidence.doi) lines.push("DOI: https://doi.org/" + evidence.doi);
  if (evidence.url) lines.push("URL: " + evidence.url);
  if (evidence.year) lines.push("Year: " + evidence.year);
  if (evidence.authors?.length) lines.push("Authors: " + evidence.authors.map(plainMarkdown).join(", "));
  if (evidence.tier === "tertiary_wiki") lines.push("", tertiaryNote);
  return callout("evidence", plainMarkdown(evidence.title) + " · " + day, lines.join("\n"));
}
