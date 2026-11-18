import { requestUrl } from "obsidian";
import type { HttpClient } from "./http";

export const obsidianAiHttp: HttpClient = {
  async request(input) {
    let timer: number | undefined;
    try {
      return await Promise.race([
        requestUrl({ ...input, throw: false }),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error("AI request timed out")), input.method === "GET" ? 3500 : 45_000);
        }),
      ]);
    } catch { throw new Error("AI request failed"); }
    finally { if (timer !== undefined) window.clearTimeout(timer); }
  },
};
