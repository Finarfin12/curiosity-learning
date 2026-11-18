import type { State } from "./types";

export interface PrereqTarget { path: string; basename: string; goal: string; state: State }

function targetName(reference: string) {
  const value = reference.trim();
  const link = /^\[\[(.+?)\]\]$/.exec(value);
  return (link ? link[1].split("|")[0].split("#")[0] : value).trim().replace(/\.md$/i, "").normalize("NFC").toLowerCase();
}

export function splitPrereqs(input: string): string[] {
  return [...new Set(input.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

export function prerequisites(references: readonly string[], topics: readonly PrereqTarget[], currentPath: string) {
  const candidates = topics.filter(topic => topic.path !== currentPath);
  return references.map(reference => {
    const wanted = targetName(reference);
    const exact = candidates.filter(topic => targetName(topic.path) === wanted);
    const matches = exact.length ? exact : candidates.filter(topic =>
      targetName(topic.basename) === wanted || targetName(topic.goal) === wanted);
    const target = matches.length === 1 ? matches[0] : undefined;
    const status = matches.length > 1 ? "ambiguous" : !target ? "missing" :
      target.state === "demonstrated_in_context" ? "ready" : "untested";
    return { reference, status, target };
  });
}
