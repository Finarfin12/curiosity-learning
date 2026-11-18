export interface AiHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}
export interface HttpClient {
  request(input: AiHttpRequest): Promise<{ status: number; text: string }>;
}

export function endpointBase(input: string, local: boolean): string | null {
  try {
    const url = new URL(input);
    if (url.username || url.password || url.search || url.hash) return null;
    if (local) {
      if ((url.protocol !== "http:" && url.protocol !== "https:") ||
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    } else if (url.protocol !== "https:") return null;
    return url.href.replace(/\/+$/, "");
  } catch { return null; }
}

export function apiPath(base: string, prefix: string, path: string) {
  return (base.endsWith(prefix) ? base : base + prefix) + path;
}
