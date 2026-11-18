import { expect, test, vi } from "vitest";
import { ScholarlyApi, type ScholarlySettings } from "../src/adapter/scholarlyApi";
import { classify, evidenceBlock, manualEvidence, normalizeDoi, sources, titleOverlap, webUrl } from "../src/domain/evidenceVerifier";

const settings = (): ScholarlySettings => ({ enableScholarlySearch: true,
  scholarlyMailto: "", openAlexApiKey: "", semanticScholarApiKey: "" });
const title = "Retrieval practice and memory retention";
const doi = "10.1234/retrieval";
const url = "https://publisher.example/article";
const q = "spaced repetition successive relearning";

test("KT-08: offline mode and missing approval never call HTTP", async () => {
  const get = vi.fn();
  const config = settings();
  const api = new ScholarlyApi({ get }, () => config);
  config.enableScholarlySearch = false;
  await expect(api.search("Crossref", q, "id", true)).rejects.toThrow("requires approval");
  await expect(api.verify({ title, doi }, true)).rejects.toThrow("requires approval");
  config.enableScholarlySearch = true;
  await expect(api.search("Crossref", q, "id", false)).rejects.toThrow("requires approval");
  await expect(api.verify({ title, url }, false)).rejects.toThrow("requires approval");
  expect(manualEvidence({ title, doi }).verification).toBe("unverified_manual");
  expect(get).not.toHaveBeenCalled();
});

test("KT-08: uses only approved terms, sends options only to their provider, and classifies five providers", async () => {
  const config = { ...settings(), scholarlyMailto: "fixture@example.org", openAlexApiKey: "fixture-open",
    semanticScholarApiKey: "fixture-semantic" };
  let clock = 0;
  const get = vi.fn(async (address: string, headers?: Record<string, string>): Promise<unknown> => {
    await Promise.resolve();
    const link = new URL(address);
    const params = link.searchParams;
    if (link.hostname !== "api.semanticscholar.org") expect(headers).toBeUndefined();
    switch (link.hostname) {
      case "api.crossref.org":
        expect(Object.fromEntries(params)).toEqual({ query: q, rows: "5", mailto: config.scholarlyMailto });
        return { message: { items: [{ title: ["Meta-analysis of retention"], DOI: doi, type: "journal-article" },
          { title: ["Invalid item"], URL: "javascript:alert(1)" }] } };
      case "api.openalex.org":
        expect(Object.fromEntries(params)).toEqual({ search: q, per_page: "5", api_key: config.openAlexApiKey });
        return { results: [{ title, doi: "https://doi.org/" + doi, type: "article" }] };
      case "eutils.ncbi.nlm.nih.gov":
        if (link.pathname.endsWith("/esearch.fcgi")) {
          expect(Object.fromEntries(params)).toEqual({ db: "pubmed", retmode: "json", term: q, retmax: "5" });
          return { esearchresult: { idlist: ["12", "bad-id"] } };
        }
        expect(Object.fromEntries(params)).toEqual({ db: "pubmed", retmode: "json", id: "12" });
        return { result: { 12: { title, pubtype: ["Randomized Controlled Trial"],
          articleids: [{ idtype: "doi", value: doi }] } } };
      case "api.semanticscholar.org":
        expect(Object.fromEntries(params)).toEqual({ query: q, limit: "5", fields: "title,year,authors,externalIds,url,publicationTypes" });
        expect(headers).toEqual({ "x-api-key": config.semanticScholarApiKey });
        return { data: [{ title, externalIds: { DOI: doi, ArXiv: "123" }, publicationTypes: ["JournalArticle"] }] };
      case "id.wikipedia.org":
        expect(Object.fromEntries(params)).toEqual({ q, limit: "3" });
        return { pages: [{ title: "Pengulangan berjeda", key: "Pengulangan_berjeda" }] };
      default: throw Error("Unexpected mock URL");
    }
  });
  const api = new ScholarlyApi({ get }, () => config, () => clock, ms => { clock += ms; return Promise.resolve(); });
  const results = await Promise.all(sources.map(source => api.search(source, " " + q + " ", "id", true)));
  expect(results.map(list => list[0]?.tier)).toEqual(["meta_analysis_sr", "observational", "rct", "expert_preprint", "tertiary_wiki"]);
  expect(results.map(list => list[0]?.verification)).toEqual(["verified_doi", "verified_doi", "verified_doi", "verified_doi", "verified_url"]);
  expect(results.every(list => list.length === 1)).toBe(true);
  expect(get).toHaveBeenCalledTimes(6);
  const block = evidenceBlock(results[4][0], "2026-11-19", "Introductory source.");
  expect(block).toContain("verification: verified_url");
  expect(block).toContain("evidence_tier: tertiary_wiki");
  expect(block).toContain("Introductory source.");
});

test("KT-08: shares PubMed rate limits across search and summary calls", async () => {
  let clock = 0;
  const starts: number[] = [];
  const api = new ScholarlyApi({ get: address => {
    starts.push(clock);
    return Promise.resolve(address.includes("esearch.fcgi")
      ? { esearchresult: { idlist: ["12"] } } : { result: { 12: { title } } });
  } }, settings, () => clock, ms => { clock += ms; return Promise.resolve(); });
  await Promise.all([api.search("PubMed", q, "en", true), api.search("PubMed", "memory", "en", true)]);
  expect(starts).toEqual([0, 340, 680, 1020]);
  expect(starts[3] - starts[0]).toBeGreaterThan(1000);
});

test("KT-08: manual verification requires matching identifiers and title tokens", async () => {
  const get = vi.fn((address: string) => {
    const link = new URL(address);
    if (link.pathname === "/works") {
      return Promise.resolve({ message: { items: [{ DOI: doi, title: [title], URL: url, type: "journal-article" }] } });
    }
    if (decodeURIComponent(link.pathname) === "/works/" + doi) {
      return Promise.resolve({ message: { DOI: doi, title: [title], type: "journal-article" } });
    }
    return Promise.reject(new Error("unavailable"));
  });
  const api = new ScholarlyApi({ get }, settings);
  expect(titleOverlap(title, "Retrieval practice and memory")).toBe(0.75);
  expect((await api.verify({ title: "Retrieval practice and memory", doi }, true)).verification).toBe("verified_doi");
  expect((await api.verify({ title: "Bacterial growth", doi }, true)).verification).toBe("unverified_manual");
  expect((await api.verify({ title, doi: "10.9999/fiction" }, true)).verification).toBe("unverified_manual");
  expect((await api.verify({ title, url }, true)).verification).toBe("verified_url");
  expect((await api.verify({ title, url: "https://elsewhere.example/article" }, true)).verification).toBe("unverified_manual");
  expect(normalizeDoi("not-doi")).toBeUndefined();
  expect(webUrl("file:///notes/a.md")).toBeUndefined();
  expect(classify({ title: "Course notes", url: "https://example.org" }, "manual")).toBe("tertiary_wiki");
});

test("KT-08: provider exceptions hide request details", async () => {
  const api = new ScholarlyApi({ get: () => Promise.reject(new Error("contains fixture token")) }, settings);
  await expect(api.search("OpenAlex", q, "en", true)).rejects.toThrow(/^Scholarly provider unavailable$/);
});

test("KT-08: imported metadata is stored as plain text rather than an embedded remote asset", () => {
  const citation = manualEvidence({ title: "![cover](https://example.org/a.png)",
    authors: ["<img src=https://example.org/b.png>"] });
  const block = evidenceBlock(citation, "2026-11-19", "Introductory source.");
  expect(block).toContain("!\\[cover]");
  expect(block).toContain("\\<img");
});
