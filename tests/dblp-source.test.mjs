import assert from "node:assert/strict";
import test from "node:test";
import { DBLP_ENDPOINT, DblpSource, buildDblpQuery, parseDblpBindings } from "../scripts/dblp-source.mjs";

const binding = (author, ordinal) => ({
  publication: { value: "https://dblp.org/rec/conf/example/Example26" },
  title: { value: "An LLM accelerator." }, year: { value: "2026" }, venue: { value: "Example" },
  doi: { value: "https://doi.org/10.1234/example" },
  url: { value: "https://doi.org/10.1234/example" },
  type: { value: "http://purl.org/net/nknouf/ns/bibtex#Inproceedings" },
  author: { value: author }, ordinal: { value: String(ordinal) }
});
const payload = { results: { bindings: [binding("Second Author", 2), binding("First Author", 1), binding("First Author", 1)] } };
const jsonResponse = (body = payload) => new Response(JSON.stringify(body), {
  headers: { "content-type": "application/sparql-results+json" }
});

test("maps real SPARQL rows to the search result contract and preserves author order and DOI ids", () => {
  const records = parseDblpBindings(payload).result.hits.hit;
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].info.authors.author, ["First Author", "Second Author"]);
  assert.equal(records[0].info.doi, "10.1234/example");
  assert.equal(records[0].info.key, "conf/example/Example26");
  assert.equal(records[0].info.venue, "Example");
});

test("rejects malformed payloads instead of interpreting them as successful empty collection", () => {
  assert.throws(() => parseDblpBindings({ error: "temporarily unavailable" }), /no results.bindings/);
  assert.throws(() => parseDblpBindings({ results: { bindings: [{ title: { value: "Fake" } }] } }), /invalid publication/);
  assert.deepEqual(parseDblpBindings({ results: { bindings: [] } }).result.hits.hit, []);
});

test("bounds limits and safely builds title, conference alias and year filters", () => {
  const query = buildDblpQuery('LLM "accelerator"', { limit: 3, venue: ["SC", "Supercomputing"], year: "2026" });
  assert.match(query, /CONTAINS\(LCASE\(STR\(\?title\)\), "llm"\)/);
  assert.match(query, /\(\^\|\[\^A-Za-z0-9\]\)SC/);
  assert.match(query, /STR\(\?year\) = "2026"/);
  assert.match(query, /LIMIT 3/);
  assert.throws(() => buildDblpQuery("LLM", { limit: -1 }), /limit/);
  assert.throws(() => buildDblpQuery("LLM", { year: '2026) } UNION {' }), /year/);
});

test("uses the documented API and caches repeated backfill queries without new requests", async () => {
  const requests = [];
  const source = new DblpSource({ fetchFn: async (url, options) => {
    requests.push({ url: String(url), options });
    return jsonResponse();
  }, sleep: async () => {} });
  const a = await source.search("LLM accelerator", { limit: 3 });
  assert.equal(await source.search("LLM accelerator", { limit: 3 }), a);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).origin + new URL(requests[0].url).pathname, DBLP_ENDPOINT);
  assert.equal(requests[0].options.headers.Accept, "application/sparql-results+json");
  assert.ok(requests[0].options.signal);
  assert.equal(source.health.status, "healthy");
  assert.equal(source.health.returnedRecords, 1);
});

test("retries transient rate limits with bounded waits and preserves successful metadata", async () => {
  let calls = 0;
  const waits = [];
  const source = new DblpSource({ sleep: async (ms) => waits.push(ms), fetchFn: async () => {
    calls += 1;
    return calls === 1 ? new Response("retry later", { status: 429, headers: { "retry-after": "9999" } }) : jsonResponse();
  } });
  await source.search("LLM");
  assert.equal(calls, 2);
  assert.equal(waits[0], 30_000);
  assert.equal(source.health.successfulQueries, 1);
});

test("detects HTML challenges before JSON parsing and stops after repeated source failures", async () => {
  let calls = 0;
  const source = new DblpSource({ sleep: async () => {}, fetchFn: async () => {
    calls += 1;
    return new Response("<!doctype html>verification", { status: 202, headers: { "content-type": "text/html" } });
  } });
  for (let i = 0; i < 3; i += 1) await assert.rejects(source.search(`LLM ${i}`), /HTTP 202.*HTML verification/);
  await assert.rejects(source.search("LLM another"), /three consecutive failed/);
  assert.equal(calls, 3);
  assert.equal(source.health.status, "failed");
  assert.equal(source.health.failedQueries, 3);
});
