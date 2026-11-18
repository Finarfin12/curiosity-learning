import { identified, manualEvidence, normalizeDoi, webUrl, type Citation,
  type Evidence, type SourceName } from "../domain/evidenceVerifier";

export interface ScholarlySettings {
  enableScholarlySearch: boolean;
  scholarlyMailto: string;
  openAlexApiKey: string;
  semanticScholarApiKey: string;
}

export interface HttpClient {
  get(url: string, headers?: Record<string, string>): Promise<unknown>;
}
type ObjectData = Record<string, unknown>;
const obj = (data: unknown): ObjectData =>
  data !== null && typeof data === "object" && !Array.isArray(data) ? data as ObjectData : {};
const arr = (data: unknown): unknown[] => Array.isArray(data) ? data : [];
const str = (data: unknown): string => typeof data === "string" ? data : "";
const strs = (data: unknown): string[] => arr(data).map(str).filter(Boolean);
const year = (data: unknown): string => /^\d{4}$/.test(String(data)) ? String(data) : "";
const records = (data: unknown) => arr(data).map(obj);
const named = (data: unknown) => records(data).map(person => str(person.name)).filter(Boolean);
const endpoint = (base: string, params: Record<string, string>) => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.href;
};

function crossref(item: ObjectData): Citation {
  const date = arr(obj(item.published ?? item.issued)["date-parts"])[0];
  return { title: strs(item.title)[0] ?? "", doi: str(item.DOI),
    url: str(obj(obj(item.resource).primary).URL) || str(item.URL), types: [str(item.type), str(item.subtype), ...strs(item["publication-type"])],
    year: year(arr(date)[0]), authors: records(item.author)
      .map(person => [str(person.given), str(person.family)].filter(Boolean).join(" ")).filter(Boolean) };
}

function openAlex(item: ObjectData): Citation {
  const source = obj(obj(item.primary_location).source);
  return { title: str(item.title) || str(item.display_name), doi: str(item.doi),
    url: str(obj(item.primary_location).landing_page_url) || str(item.id),
    types: [str(item.type), str(item.type_crossref), str(source.type)],
    year: year(item.publication_year), authors: records(item.authorships)
      .map(person => str(obj(person.author).display_name)).filter(Boolean) };
}

function semantic(item: ObjectData): Citation {
  const ids = obj(item.externalIds);
  return { title: str(item.title), doi: str(ids.DOI), url: str(item.url),
    year: year(item.year), authors: named(item.authors),
    types: [...strs(item.publicationTypes), ...(ids.ArXiv ? ["preprint"] : [])] };
}

function pubmed(item: ObjectData, id: string): Citation {
  const doi = records(item.articleids).find(entry => entry.idtype === "doi");
  return { title: str(item.title), doi: str(doi?.value), url: "https://pubmed.ncbi.nlm.nih.gov/" + id + "/",
    types: strs(item.pubtype), year: year(str(item.pubdate).slice(0, 4)), authors: named(item.authors) };
}

const crossrefWorks = "https://api.crossref.org/works";
const ncbi = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

export class ScholarlyApi {
  private pubmedTurn: Promise<void> = Promise.resolve();
  private lastPubmedStart = -Infinity;

  constructor(private readonly http: HttpClient, private readonly settings: () => ScholarlySettings,
    private readonly now = Date.now, private readonly wait = sleep) {}

  private approved(consent: boolean) {
    const settings = this.settings();
    if (!settings.enableScholarlySearch || !consent) throw new Error("Scholarly lookup requires approval");
    return settings;
  }

  private async get(url: string, headers?: Record<string, string>): Promise<ObjectData> {
    try { return obj(await this.http.get(url, headers)); }
    catch { throw new Error("Scholarly provider unavailable"); }
  }

  async search(source: SourceName, keywords: string, language: "id" | "en", consent: boolean): Promise<Evidence[]> {
    const settings = this.approved(consent);
    const q = keywords.trim();
    if (!q || q.length > 300) throw new Error("Invalid search keyword");
    const results = await this.fetchSource(source, q, language, settings);
    return results.flatMap(result => identified(result, source) ?? []);
  }

  private async fetchSource(source: SourceName, q: string, lang: "id" | "en", settings: ScholarlySettings) {
    switch (source) {
      case "Crossref": {
        const data = await this.get(endpoint(crossrefWorks, { query: q, rows: "5", mailto: settings.scholarlyMailto }));
        return records(obj(data.message).items).slice(0, 5).map(crossref);
      }
      case "OpenAlex": {
        const data = await this.get(endpoint("https://api.openalex.org/works",
          { search: q, per_page: "5", api_key: settings.openAlexApiKey }));
        return records(data.results).slice(0, 5).map(openAlex);
      }
      case "PubMed":
        return this.fetchPubmed(q);
      case "Semantic Scholar": {
        const data = await this.get(endpoint("https://api.semanticscholar.org/graph/v1/paper/search", { query: q, limit: "5",
          fields: "title,year,authors,externalIds,url,publicationTypes" }),
        settings.semanticScholarApiKey ? { "x-api-key": settings.semanticScholarApiKey } : undefined);
        return records(data.data).slice(0, 5).map(semantic);
      }
      case "Wikipedia": {
        const origin = lang === "id" ? "https://id.wikipedia.org" : "https://en.wikipedia.org";
        const data = await this.get(endpoint(origin + "/w/rest.php/v1/search/page", { q, limit: "3" }));
        return records(data.pages).slice(0, 3).flatMap(item => {
          const key = str(item.key);
          return key && key !== "." && key !== ".."
            ? [{ title: str(item.title), url: origin + "/wiki/" + encodeURIComponent(key) }] : [];
        });
      }
    }
  }

  private async pubmedGet(path: string, params: Record<string, string>) {
    const previous = this.pubmedTurn;
    let release!: () => void;
    this.pubmedTurn = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const delay = this.lastPubmedStart + 340 - this.now();
      if (delay > 0) await this.wait(delay);
      this.approved(true);
      this.lastPubmedStart = this.now();
      return this.get(endpoint(ncbi + path, { db: "pubmed", retmode: "json", ...params }));
    } finally { release(); }
  }

  private async fetchPubmed(q: string) {
    const index = await this.pubmedGet("esearch.fcgi", { term: q, retmax: "5" });
    const ids = strs(obj(index.esearchresult).idlist).filter(id => /^\d+$/.test(id)).slice(0, 5);
    if (!ids.length) return [];
    const details = await this.pubmedGet("esummary.fcgi", { id: ids.join(",") });
    const result = obj(details.result);
    return ids.map(id => pubmed(obj(result[id]), id));
  }

  async verify(citation: Citation, consent: boolean): Promise<Evidence> {
    const settings = this.approved(consent);
    const doi = normalizeDoi(citation.doi);
    if (doi) {
      try {
        const item = await this.get(endpoint(crossrefWorks + "/" + encodeURIComponent(doi),
          { mailto: settings.scholarlyMailto }));
        return manualEvidence(citation, identified(crossref(obj(item.message)), "Crossref") ?? undefined);
      } catch { return manualEvidence(citation); }
    }
    const url = webUrl(citation.url);
    if (!url || !citation.title.trim() || citation.title.length > 300) return manualEvidence(citation);
    const host = new URL(url).hostname;
    try {
      const source = host === "id.wikipedia.org" || host === "en.wikipedia.org" ? "Wikipedia" : "Crossref";
      const matches = await this.search(source, citation.title, host === "id.wikipedia.org" ? "id" : "en", consent);
      return manualEvidence(citation, matches.find(item => item.url === url || (item.doi && "https://doi.org/" + item.doi === url)));
    } catch { return manualEvidence(citation); }
  }
}
