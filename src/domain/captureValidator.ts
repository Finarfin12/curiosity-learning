import type { Confidence } from "./types";

export const MAX_CAPTURE_URI = 8000;
export const captureLimits = { capture_id: 80, title: 160, url: 1000, selection: 2500, question: 400, prior_guess: 600 } as const;
export interface Capture {
  v: "1";
  capture_id: string;
  title: string;
  url: string;
  selection: string;
  question: string;
  prior_guess: string;
  confidence: Confidence;
}

const unsafe = (value: string, multiline: boolean) =>
  Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return (code < 32 && !(multiline && ["\r", "\n", "\t"].includes(char))) ||
      (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
  }) || /<\s*\/?\s*(?:script|iframe|object|embed|img|svg|style|link)\b/i.test(value);

export function validateCapture(input: Record<string, unknown>): Capture | null {
  if (input.v !== "1") return null;
  const fields: Record<keyof typeof captureLimits, string> = {
    capture_id: "", title: "", url: "", selection: "", question: "", prior_guess: "",
  };
  for (const [key, limit] of Object.entries(captureLimits) as [keyof typeof captureLimits, number][]) {
    const raw = input[key] ?? "";
    if (typeof raw !== "string" || raw.length > limit ||
        unsafe(raw, key === "selection" || key === "question" || key === "prior_guess")) return null;
    fields[key] = raw.replace(/\r\n?/g, "\n").trim();
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(fields.capture_id) ||
      !fields.title || /[/\\]|\.\./.test(fields.title) || !fields.selection || !fields.question) return null;
  if (!/^https?:\/\//i.test(fields.url) || /[\s\\]/.test(fields.url)) return null;
  // URL paths may have separators, but path dot segments are rejected before URL normalization.
  const pathname = fields.url.replace(/^https?:\/\/[^/?#]+/i, "").split(/[?#]/)[0];
  try {
    if (decodeURIComponent(pathname).split(/[\\/]/).some(segment => /^\.{1,2}$/.test(segment))) return null;
    const url = new URL(fields.url);
    if (!url.hostname || url.username || url.password) return null;
  } catch { return null; }
  const confidence = input.confidence ?? "50";
  if (confidence !== "50" && confidence !== "70" && confidence !== "90") return null;
  return { v: "1", ...fields, confidence: Number(confidence) as Confidence };
}

export function captureQuery(capture: Capture) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(capture)) params.set(key, String(value));
  return params;
}

export function captureUri(capture: Capture) {
  return "obsidian://curiosity-capture?" + captureQuery(capture).toString().replaceAll("+", "%20");
}

export function uniqueBase(title: string, id: string) {
  const safe = title.replace(/[<>:"/\\|?*#^[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 70);
  return (safe || "Capture") + " - " + id;
}
