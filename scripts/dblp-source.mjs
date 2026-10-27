// Official programmatic interface, documented at:
// https://blog.dblp.org/2024/09/09/introducing-our-public-sparql-query-service/
export const DBLP_ENDPOINT = "https://sparql.dblp.org/sparql";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function queryOptions(query, { limit = 8, venue, year } = {}) {
  const terms = String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) throw new Error("DBLP query must contain search terms.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("DBLP result limit must be an integer from 1 to 1000.");
  }
  if (year !== undefined && !/^\d{4}$/.test(String(year))) {
    throw new Error("DBLP conference year must contain four digits.");
  }
  const conditions = [];
  if (venue) {
    const venues = Array.isArray(venue) ? venue : [venue];
    const patterns = venues.map((name) => {
      const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `REGEX(STR(?venue), ${JSON.stringify(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`)}, "i")`;
    });
    conditions.push(`(${patterns.join(" || ")})`);
  }
  return { terms: [...new Set(terms)], conditions, limit, venue, year };
}

export function buildDblpQuery(query, options = {}, { recentFallback = false } = {}) {
  const { terms, conditions, limit, venue, year } = queryOptions(query, options);
  const currentYear = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric" }).format(new Date()));
  const years = year ? [Number(year)] : recentFallback
    ? Array.from({ length: 4 }, (_, index) => currentYear - 2 + index) : [];
  if (recentFallback) {
    conditions.push(...terms.map((term) => `REGEX(?title, ${JSON.stringify(term)}, "i")`));
  }
  return `PREFIX dblp: <https://dblp.org/rdf/schema#>
PREFIX ql: <http://qlever.cs.uni-freiburg.de/builtin-functions/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?publication ?title ?year WHERE {
  ${years.length ? `VALUES ?year { ${years.map((value) => `"${value}"^^xsd:gYear`).join(" ")} }` : ""}
  ${recentFallback ? "" : `?text ql:contains-word ${JSON.stringify(terms.map((term) => `${term}*`).join(" "))} ; ql:contains-entity ?title .`}
  ?publication dblp:title ?title ; dblp:yearOfPublication ?year .
  ${venue ? "?publication dblp:publishedIn ?venue ." : ""}
  ${conditions.length ? `FILTER(${conditions.join(" && ")})` : ""}
} ORDER BY DESC(?year) ?publication LIMIT ${limit}`;
}

function validPublication(value) {
  if (!/^https:\/\/dblp\.org\/rec\/[^\s<>"{}|^`\\?#]+$/.test(value ?? "")) {
    throw new Error("DBLP SPARQL response contains an invalid publication record.");
  }
  return value;
}

export function buildDblpMetadataQuery(publications) {
  const ids = [...new Set(publications)].map(validPublication);
  if (ids.length === 0 || ids.length > 25) throw new Error("DBLP metadata batches must contain 1 to 25 publication ids.");
  const values = `VALUES ?publication { ${ids.map((id) => `<${id}>`).join(" ")} }`;
  // Repeat VALUES inside each optional group: otherwise QLever may build a
  // whole-dataset author-signature join before applying the outer candidate limit.
  return `PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT ?publication ?title ?year ?venue ?doi ?url ?type ?author ?ordinal WHERE {
  ${values}
  ?publication dblp:title ?title ; dblp:yearOfPublication ?year .
  OPTIONAL { ${values} ?publication dblp:publishedIn ?venue }
  OPTIONAL { ${values} ?publication dblp:doi ?doi }
  OPTIONAL { ${values} ?publication dblp:primaryDocumentPage ?url }
  OPTIONAL { ${values} ?publication dblp:bibtexType ?type }
  OPTIONAL { ${values} ?publication dblp:hasSignature ?signature .
    ?signature a dblp:AuthorSignature ; dblp:signatureDblpName ?author ; dblp:signatureOrdinal ?ordinal .
  }
} ORDER BY ?publication ?ordinal`;
}

export function parseDblpBindings(json) {
  if (!Array.isArray(json?.results?.bindings)) {
    throw new Error("DBLP SPARQL response has no results.bindings array.");
  }
  const records = new Map();
  for (const row of json.results.bindings) {
    const publication = validPublication(row.publication?.value);
    if (!row.title?.value) {
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
    this.metadataCache = new Map();
    this.httpRequests = 0;
    this.fallbackQueries = 0;
    this.maxServerQueryMs = 0;
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
      httpRequests: this.httpRequests,
      fallbackQueries: this.fallbackQueries,
      maxServerQueryMs: this.maxServerQueryMs,
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  async search(query, options = {}) {
    const sparql = buildDblpQuery(query, options);
    if (this.cache.has(sparql)) return this.cache.get(sparql);
    if (this.unavailable) throw new Error("DBLP source unavailable after three consecutive failed queries.");
    this.attempted += 1;
    try {
      let candidates;
      try {
        candidates = await this.fetchJson(sparql);
      } catch (error) {
        if (!["DBLP_QUERY_TIMEOUT", "DBLP_TEXT_INDEX_UNAVAILABLE"].includes(error?.code)) throw error;
        this.fallbackQueries += 1;
        candidates = await this.fetchJson(buildDblpQuery(query, options, { recentFallback: true }));
      }
      const ids = parseDblpBindings(candidates).result.hits.hit.map(({ info }) => info.url);
      const missing = ids.filter((id) => !this.metadataCache.has(id));
      for (let start = 0; start < missing.length; start += 25) {
        const batch = missing.slice(start, start + 25);
        const details = parseDblpBindings(await this.fetchJson(buildDblpMetadataQuery(batch)));
        for (const record of details.result.hits.hit) this.metadataCache.set(record.info.url, record);
        if (batch.some((id) => !this.metadataCache.has(id))) throw new Error("DBLP metadata response omitted a requested publication.");
      }
      const result = { result: { hits: { hit: ids.map((id) => this.metadataCache.get(id)) } } };
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

  async fetchJson(sparql) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (this.httpRequests > 0) await this.sleep(this.spacingMs);
        this.httpRequests += 1;
        const response = await this.fetchFn(DBLP_ENDPOINT, {
          method: "POST",
          body: sparql,
          headers: { Accept: "application/sparql-results+json", "Content-Type": "application/sparql-query",
            "User-Agent": "PaperDigestAgent/1.0 (daily research metadata)" },
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        const type = response.headers.get("content-type") ?? "";
        const isJson = /application\/(?:sparql-results\+)?json\b/i.test(type);
        const body = isJson ? await response.json() : null;
        const detail = body?.exception ?? body?.error?.message ?? body?.message ?? "";
        const text = typeof detail === "string" ? detail.slice(0, 500) : "";
        const queryTimeout = /operation timed out|query.*tim(?:ed? ?out|eout)/i.test(text);
        const textUnavailable = /text index|text.*not (?:loaded|available)|no.*text.*index/i.test(text);
        if ([429, 500, 502, 503, 504].includes(response.status) && !queryTimeout && !textUnavailable && attempt < 2) {
          const retryAfter = Number(response.headers.get("retry-after"));
          if (!response.bodyUsed) await response.body?.cancel();
          await this.sleep(Math.min(30_000, Math.max(this.spacingMs, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 1500 * (attempt + 1))));
          continue;
        }
        if (response.status !== 200 || !isJson || body?.exception || body?.error) {
          if (!response.bodyUsed) await response.body?.cancel();
          const error = new Error(`DBLP metadata endpoint returned HTTP ${response.status} (${type || "no content type"}): ${text || (type.includes("html") ? "HTML verification page, expected SPARQL JSON" : "unexpected response")}.`);
          error.status = response.status;
          error.code = queryTimeout ? "DBLP_QUERY_TIMEOUT" : textUnavailable ? "DBLP_TEXT_INDEX_UNAVAILABLE" : "DBLP_HTTP_ERROR";
          throw error;
        }
        this.maxServerQueryMs = Math.max(this.maxServerQueryMs, Number(body?.meta?.["query-time-ms"]) || 0);
        return body;
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
