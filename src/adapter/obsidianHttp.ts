import { requestUrl } from "obsidian";
import type { HttpClient } from "./scholarlyApi";

export const obsidianHttp: HttpClient = {
  async get(url, headers) {
    const response = await requestUrl({ url, headers: { Accept: "application/json", ...headers }, throw: false });
    if (response.status < 200 || response.status >= 300) throw new Error("Scholarly request failed");
    return response.json as unknown;
  },
};
