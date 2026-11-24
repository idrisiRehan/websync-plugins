import { test } from "node:test";
import assert from "node:assert/strict";
import { RANGE_URLS } from "../src/crawlers.ts";
import { dumpLists, fetchLists, readLists } from "../src/ranges.ts";

const GPTBOT_LIST = "https://openai.com/gptbot.json";

test("fetchLists asks only for the table's URLs and reports each failure", async () => {
  const asked: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    asked.push(url);
    if (url === GPTBOT_LIST) return new Response(JSON.stringify({ creationTime: "t", prefixes: [{ ipv4Prefix: "132.196.86.0/24" }] }));
    if (url.includes("perplexity")) throw new TypeError("fetch failed", { cause: Object.assign(new Error(""), { code: "ECONNREFUSED" }) });
    return new Response("gone", { status: 404 });
  };
  const lists = await fetchLists({ fetch: fakeFetch, timeoutMs: 1000, userAgent: "test" });
  assert.deepEqual(asked.sort(), [...RANGE_URLS].sort());
  assert.deepEqual(lists.find((l) => l.url === GPTBOT_LIST), { url: GPTBOT_LIST, prefixes: ["132.196.86.0/24"], creationTime: "t", error: null });
  assert.equal(lists.find((l) => l.url.includes("perplexitybot"))?.error, "fetch failed: ECONNREFUSED");
  assert.equal(lists.find((l) => l.url.includes("claude"))?.error, "HTTP 404");
});

test("a list with no valid IP range fails instead of making every request look spoofed", async () => {
  const fakeFetch: typeof fetch = async (input) =>
    String(input) === GPTBOT_LIST ? new Response(JSON.stringify({ prefixes: [{ ipv4Prefix: "132.196.86.0/33" }, { ipv4Prefix: "not an address" }] })) : new Response("", { status: 404 });
  const lists = await fetchLists({ fetch: fakeFetch, timeoutMs: 1000, userAgent: "test" });
  assert.equal(lists.find((l) => l.url === GPTBOT_LIST)?.error, "no IP prefixes found in the response");
  for (const prefixes of [[], ["nonsense"]]) {
    assert.throws(() => readLists(JSON.stringify({ lists: { [GPTBOT_LIST]: { prefixes } } })), /with at least one IP range/);
  }
});

test("dumpLists and readLists round-trip; a list the file lacks reads back as not loaded", () => {
  const text = dumpLists(
    [
      { url: GPTBOT_LIST, prefixes: ["132.196.86.0/24"], creationTime: "t", error: null },
      { url: "https://claude.com/crawling/bots.json", prefixes: [], creationTime: null, error: "HTTP 500" },
    ],
    new Date("2026-11-24T00:00:00Z"),
  );
  assert.deepEqual(JSON.parse(text), { fetched: "2026-11-24T00:00:00.000Z", lists: { [GPTBOT_LIST]: { creationTime: "t", prefixes: ["132.196.86.0/24"] } } });
  const withExtra = JSON.stringify({ lists: { ...JSON.parse(text).lists, "https://example.com/other.json": { prefixes: ["1.2.3.4/32"] } } });
  const lists = readLists(withExtra);
  assert.deepEqual(lists.map((l) => l.url), RANGE_URLS);
  assert.deepEqual(lists.find((l) => l.url === GPTBOT_LIST), { url: GPTBOT_LIST, prefixes: ["132.196.86.0/24"], creationTime: "t", error: null });
  assert.ok(lists.filter((l) => l.url !== GPTBOT_LIST).every((l) => l.error === "not in the ranges file" && !l.prefixes.length));
});

test("readLists explains a bad file", () => {
  assert.throws(() => readLists("{"), /not valid JSON/);
  assert.throws(() => readLists("[]"), /no "lists" object/);
  assert.throws(() => readLists("null"), /no "lists" object/);
  assert.throws(() => readLists(JSON.stringify({ lists: { [GPTBOT_LIST]: { prefixes: [1] } } })), /needs a "prefixes" array of strings/);
  assert.throws(() => readLists(JSON.stringify({ lists: { [GPTBOT_LIST]: null } })), /needs a "prefixes" array/);
});
