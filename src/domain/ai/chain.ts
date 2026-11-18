import type { AiProvider, AiPrompt } from "./types";

export function redact(value: string, secrets: readonly string[] = []): string {
  const unique = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  const escaped = unique.map(secret => secret.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&"));
  const stripped = escaped.length ? value.replace(new RegExp(escaped.join("|"), "g"), "[REDACTED]") : value;
  return stripped.replace(/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/gi, "[REDACTED]");
}

export async function runProvider(provider: AiProvider | null, prompt: AiPrompt, approved: boolean,
    secrets: readonly string[] = []): Promise<string | null> {
  if (!provider || !approved) return null;
  try {
    const raw = await provider.generate(prompt);
    return raw.length <= 32_000 ? redact(raw, secrets) : null;
  } catch {
    // Transport errors can contain private URLs, headers or request bodies.
    return null;
  }
}
