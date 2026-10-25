// Official programmatic interface, documented at:
// https://blog.dblp.org/2024/09/09/introducing-our-public-sparql-query-service/
export const DBLP_ENDPOINT = "https://sparql.dblp.org/sparql";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildDblpQuery(query, { limit = 12, venue, year } = {}) {
  const terms = String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) throw new Error("DBLP query must contain search terms.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("DBLP result limit must be an integer from 1 to 1000.");
  }
  if (year !== undefined && !/^\d{4}$/.test(String(year))) {
    throw new Error("DBLP conference year must contain four digits.");
  }
  const conditions = [...new Set(terms)].map((term) =>
    `CONTAINS(LCASE(STR(?title)), ${JSON.stringify(term)})`);
  if (venue) {
    const venues = Array.isArray(venue) ? venue : [venue];
    const patterns = venues.map((name) => {
      const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `REGEX(STR(?venue), ${JSON.stringify(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`)}, "i")`;
    });
    conditions.push(`(${patterns.join(" || ")})`);
  }
  if (year) conditions.push(`STR(?year) = ${JSON.stringify(String(year))}`);
  return `PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT ?publication ?title ?year ?venue ?doi ?url ?type ?author ?ordinal WHERE {
  { SELECT DISTINCT ?publication ?title ?year ?venue WHERE {
      ?publication dblp:title ?title ; dblp:yearOfPublication ?year .
      OPTIONAL { ?publication dblp:publishedIn ?venue }
      FILTER(${conditions.join(" && ")})
    } ORDER BY DESC(?year) ?publication LIMIT ${limit}
  }
  OPTIONAL { ?publication dblp:doi ?doi }
  OPTIONAL { ?publication dblp:primaryDocumentPage ?url }
  OPTIONAL { ?publication dblp:bibtexType ?type }
  OPTIONAL { ?publication dblp:hasSignature ?signature .
    ?signature a dblp:AuthorSignature ; dblp:signatureDblpName ?author ; dblp:signatureOrdinal ?ordinal .
  }
} ORDER BY DESC(?year) ?publication ?ordinal`;
}

export function parseDblpBindings(json) {
  if (!Array.isArray(json?.results?.bindings)) {
    throw new Error("DBLP SPARQL response has no results.bindings array.");
  }
  const records = new Map();
  for (const row of json.results.bindings) {
    const publication = row.publication?.value;
    if (!/^https:\/\/dblp\.org\/rec\/[^\s]+$/.test(publication ?? "") || !row.title?.value) {
      throw new Error("DBLP SPARQL response contains an invalid publication record.");
    }
    let record = records.get(publication);
    if (!record) {
      record = {
        info: {
          key: publication.slice("https://dblp.org/rec/".length),
          title: row.title.value,
          year: row.year?.value ?? "",
          venue: row.venue?.value ?? "",
          doi: (row.doi?.value ?? "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
          url: publication,
          ee: row.url?.value ?? "",
          type: row.type?.value?.split("#").at(-1) ?? ""
        },
        authors: new Map()
      };
      records.set(publication, record);
    }
    if (row.author?.value) {
      record.authors.set(row.author.value, Number(row.ordinal?.value) || Number.MAX_SAFE_INTEGER);
    }
  }
  return { result: { hits: { hit: [...records.values()].map(({ info, authors }) => ({
    info: { ...info, authors: { author: [...authors].sort((a, b) => a[1] - b[1]).map(([name]) => name) } }
  })) } } };
}

export class DblpSource {
  constructor({ fetchFn = fetch, sleep = wait, spacingMs = 1200, timeoutMs = 20_000 } = {}) {
    this.fetchFn = fetchFn;
    this.sleep = sleep;
    this.spacingMs = spacingMs;
    this.timeoutMs = timeoutMs;
    this.attempted = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.skipped = 0;
    this.records = 0;
    this.consecutiveFailures = 0;
    this.lastError = "";
    this.cache = new Map();
  }

  get unavailable() { return this.consecutiveFailures >= 3; }

  get health() {
    return {
      endpoint: DBLP_ENDPOINT,
      status: this.failed > 0 ? (this.succeeded > 0 ? "degraded" : "failed")
        : this.succeeded > 0 ? "healthy" : "not-requested",
      attemptedQueries: this.attempted,
      successfulQueries: this.succeeded,
      failedQueries: this.failed,
      skippedQueries: this.skipped,
      returnedRecords: this.records,
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  async search(query, options = {}) {
    const sparql = buildDblpQuery(query, options);
    if (this.cache.has(sparql)) return this.cache.get(sparql);
    if (this.unavailable) throw new Error("DBLP source unavailable after three consecutive failed queries.");
    if (this.attempted > 0) await this.sleep(this.spacingMs);
    this.attempted += 1;
    try {
      const url = new URL(DBLP_ENDPOINT);
      url.searchParams.set("query", sparql);
      const result = parseDblpBindings(await this.fetchJson(url));
      this.succeeded += 1;
      this.consecutiveFailures = 0;
      this.records += result.result.hits.hit.length;
      this.cache.set(sparql, result);
      return result;
    } catch (error) {
      this.failed += 1;
      this.consecutiveFailures += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async fetchJson(url) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetchFn(url, {
          headers: { Accept: "application/sparql-results+json", "User-Agent": "PaperDigestAgent/1.0 (daily research metadata)" },
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
          const retryAfter = Number(response.headers.get("retry-after"));
          await response.body?.cancel();
          await this.sleep(Math.min(30_000, Math.max(this.spacingMs, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 1500 * (attempt + 1))));
          continue;
        }
        const type = response.headers.get("content-type") ?? "";
        if (response.status !== 200 || !/application\/(?:sparql-results\+)?json\b/i.test(type)) {
          await response.body?.cancel();
          throw new Error(`DBLP metadata endpoint returned HTTP ${response.status} (${type || "no content type"}); expected SPARQL JSON, not an HTML verification page.`);
        }
        return await response.json();
      } catch (error) {
        if (attempt < 2 && ["TimeoutError", "AbortError", "TypeError"].includes(error?.name)) {
          await this.sleep(1500 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
  }
}
