import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createFetcher, type FetcherOptions } from "../src/index.ts";
import { gzipBomb, startServer, type TestServer } from "./server.ts";

let server: TestServer;
let base = "";

before(async () => {
  server = await startServer();
  base = server.base;
});

after(() => server.close());

const MiB = 1024 * 1024;
const fetcher = (options: Partial<FetcherOptions> = {}) => createFetcher({ timeoutMs: 2000, userAgent: "fetcher-test", ...options });

/** Runs `fn` and returns how many requests the server received meanwhile. */
async function counting(fn: () => Promise<unknown>): Promise<number> {
  const from = server.requests.length;
  await fn();
  return server.requests.length - from;
}

describe("get", () => {
  test("reads a 2xx body and sends the User-Agent and Accept", async () => {
    const { record, headers, body } = await fetcher().get(`${base}/ok`, { maxBytes: 1024, accept: "text/plain" });
    assert.deepEqual({ ...record, durationMs: 0 }, { url: `${base}/ok`, finalUrl: `${base}/ok`, status: 200, redirects: 0, durationMs: 0, bytes: 2, error: null });
    assert.equal(headers?.get("content-type"), "text/plain");
    assert.equal(new TextDecoder().decode(body!), "ok");
    const sent = server.requests.at(-1)!.headers;
    assert.deepEqual([sent["user-agent"], sent.accept], ["fetcher-test", "text/plain"]);
  });

  test("a status other than 2xx is not an error, and its body is not read", async () => {
    const { record, headers, body } = await fetcher().get(`${base}/server-error`, { maxBytes: 1024 });
    assert.deepEqual([record.status, record.error, record.bytes, body], [500, null, null, null]);
    assert.ok(headers);
  });

  test("passes a 2xx body through read, with its headers and URL", async () => {
    const seen: string[] = [];
    const { record, body } = await fetcher().get(`${base}/301`, {
      maxBytes: 1024,
      read: (bytes, headers, url) => {
        seen.push(url, headers.get("content-type") ?? "");
        return new TextDecoder().decode(bytes).toUpperCase();
      },
    });
    assert.equal(body, "OK");
    assert.deepEqual(seen, [`${base}/ok`, "text/plain"]);
    assert.equal(record.bytes, 2);
  });

  test("an error thrown by read is the record's error", async () => {
    const { record, body } = await fetcher().get(`${base}/ok`, {
      maxBytes: 1024,
      read: () => {
        throw new Error("unreadable");
      },
    });
    assert.deepEqual([record.status, record.error, body], [200, "unreadable", null]);
  });

  test("a URL that isn't absolute http or https is an error, not a request", async () => {
    const f = fetcher();
    for (const url of ["/ok", "ftp://example.com/file", "not a url"]) {
      const { record, body } = await f.get(url, { maxBytes: 1024 });
      assert.deepEqual([record.finalUrl, record.status, record.error, body], [url, null, "not an absolute http or https URL", null]);
    }
    assert.equal(f.used, 0);
  });

  test("the fragment is never part of the request", async () => {
    const { record } = await fetcher().get(`${base}/ok#top`, { maxBytes: 1024 });
    assert.deepEqual([record.url, record.finalUrl], [`${base}/ok#top`, `${base}/ok`]);
  });

  test("bad options throw", () => {
    assert.throws(() => fetcher({ timeoutMs: 0 }), /timeoutMs must be a whole number, 1 or more/);
    assert.throws(() => fetcher({ maxRedirects: -1 }), /maxRedirects must be a whole number, 0 or more/);
    assert.throws(() => fetcher({ maxRequests: 1.5 }), /maxRequests must be a whole number, 0 or more/);
  });
});

describe("redirects", () => {
  test("are followed one hop at a time, and each hop is a request", async () => {
    const f = fetcher();
    const requests = await counting(async () => {
      const { record, body } = await f.get(`${base}/n/3`, { maxBytes: 1024 });
      assert.deepEqual([record.finalUrl, record.status, record.redirects, record.error], [`${base}/n/0`, 200, 3, null]);
      assert.ok(body);
    });
    assert.deepEqual([requests, f.used], [4, 4]);
  });

  test("stop after maxRedirects", async () => {
    const f = fetcher();
    const { record, headers } = await f.get(`${base}/n/9`, { maxBytes: 1024 });
    assert.deepEqual([record.finalUrl, record.status, record.redirects, record.error], [`${base}/n/4`, 301, 5, "still redirecting after 5 redirects"]);
    assert.equal(headers?.get("location"), "/n/3");
    assert.equal(f.used, 6);
    const { record: none } = await fetcher({ maxRedirects: 0 }).get(`${base}/301`, { maxBytes: 1024 });
    assert.equal(none.error, "still redirecting after 0 redirects");
  });

  test("a loop stops as soon as it comes back", async () => {
    const f = fetcher();
    const { record } = await f.get(`${base}/loop-a`, { maxBytes: 1024 });
    assert.deepEqual([record.finalUrl, record.redirects, record.error], [`${base}/loop-b`, 1, `redirects in a loop (back to ${base}/loop-a)`]);
    assert.equal(f.used, 2);
    assert.equal((await f.get(`${base}/self`, { maxBytes: 1024 })).record.error, `redirects in a loop (back to ${base}/self)`);
  });

  test("only to http and https URLs", async () => {
    const { record, body } = await fetcher().get(`${base}/ftp-location`, { maxBytes: 1024 });
    assert.deepEqual([record.status, record.error, body], [302, 'redirects to "ftp://example.com/file", which is not an http or https URL', null]);
    assert.equal((await fetcher().get(`${base}/bad-location`, { maxBytes: 1024 })).record.error, 'redirects to "http://bad host/", which is not an http or https URL');
  });

  test("a Location sent as raw UTF-8 is read as UTF-8, as inspectRedirects() reads it", async () => {
    const { record } = await fetcher().get(`${base}/utf8-location`, { maxBytes: 1024 });
    assert.deepEqual([record.finalUrl, record.redirects], [`${base}/caf%C3%A9`, 1]);
    assert.equal(server.requests.at(-1)!.url, "/caf%C3%A9");
  });

  test("several different Locations stop the chain; one repeated is followed", async () => {
    const f = fetcher();
    const { record } = await f.get(`${base}/two-locations`, { maxBytes: 1024 });
    assert.deepEqual([record.status, record.redirects, record.error], [301, 0, "redirects to 2 different Locations at once"]);
    assert.equal(f.used, 1);
    const same = await f.get(`${base}/same-location-twice`, { maxBytes: 1024 });
    assert.deepEqual([same.record.finalUrl, same.record.status, same.record.error], [`${base}/ok`, 200, null]);
  });

  test("a redirect status without a Location ends the chain", async () => {
    const { record } = await fetcher().get(`${base}/no-location`, { maxBytes: 1024 });
    assert.deepEqual([record.status, record.redirects, record.error], [301, 0, null]);
  });
});

describe("limits", () => {
  test("the request budget counts every hop and refuses the rest", async () => {
    const f = fetcher({ maxRequests: 2 });
    const requests = await counting(async () => {
      const { record } = await f.get(`${base}/n/3`, { maxBytes: 1024 });
      assert.deepEqual([record.finalUrl, record.status, record.redirects], [`${base}/n/1`, null, 2]);
      assert.equal(record.error, "not requested: the run's limit of 2 requests was reached");
    });
    assert.deepEqual([requests, f.used], [2, 2]);
  });

  test("budgetError words the refusal, and the counted fetch shares the budget", async () => {
    const f = fetcher({ maxRequests: 1, budgetError: "over budget" });
    assert.equal((await f.fetch(`${base}/ok`)).status, 200);
    await assert.rejects(f.fetch(`${base}/ok`), /^Error: over budget$/);
    assert.equal((await f.get(`${base}/ok`, { maxBytes: 1024 })).record.error, "over budget");
    assert.equal(f.used, 1);
  });

  test("a request that never answers times out", async () => {
    const { record } = await fetcher({ timeoutMs: 200 }).get(`${base}/never`, { maxBytes: 1024 });
    assert.deepEqual([record.status, record.error], [null, "timed out after 200 ms"]);
  });

  test("the timeout covers the body", async () => {
    const { record, body } = await fetcher({ timeoutMs: 300 }).get(`${base}/stall`, { maxBytes: 1024 });
    assert.deepEqual([record.status, record.error, body], [200, "timed out after 300 ms", null]);
  });

  test("an endless body stops at maxBytes", async () => {
    const begin = Date.now();
    const { record, headers, body } = await fetcher().get(`${base}/endless`, { maxBytes: MiB });
    assert.deepEqual([record.status, record.bytes, body], [200, null, null]);
    assert.equal(record.error, `the body is larger than ${MiB} bytes, so reading stopped`);
    assert.ok(headers, "the headers are kept");
    assert.ok(Date.now() - begin < 2000);
  });

  test("the cap applies after decompression: a gzip bomb stops at maxBytes", async () => {
    assert.ok(gzipBomb().length < MiB);
    const { record } = await fetcher().get(`${base}/gzip-bomb`, { maxBytes: MiB, tooLargeError: "too large" });
    assert.deepEqual([record.status, record.error], [200, "too large"]);
  });

  test("bodies of redirects and other statuses are cancelled unread", async () => {
    const cancelled: string[] = [];
    const respond = (url: string, status: number, headers: Record<string, string> = {}) =>
      new Response(new ReadableStream({ cancel: () => void cancelled.push(url) }), { status, headers });
    const fake: typeof fetch = async (input) => {
      const url = String(input);
      return url.endsWith("/a") ? respond(url, 301, { location: "/b" }) : respond(url, 404);
    };
    const { record } = await fetcher({ fetch: fake }).get("https://example.test/a", { maxBytes: 1024 });
    assert.deepEqual([record.status, record.redirects], [404, 1]);
    assert.deepEqual(cancelled, ["https://example.test/a", "https://example.test/b"]);
  });

  test("a request that fails says why in one line", async () => {
    const failing = (cause: Error): typeof fetch => async () => {
      throw new TypeError("fetch failed", { cause });
    };
    const error = async (cause: Error) => (await fetcher({ fetch: failing(cause) }).get("https://example.test/", { maxBytes: 1 })).record.error;
    // A host with several addresses fails with an AggregateError whose message is empty.
    assert.equal(await error(Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" })), "fetch failed: ECONNREFUSED");
    assert.equal(await error(new Error("getaddrinfo ENOTFOUND example.test")), "fetch failed: getaddrinfo ENOTFOUND example.test");
  });
});

describe("cacheHops", () => {
  test("each URL is requested once: shared links and redirects to one page share its response", async () => {
    const f = fetcher();
    let reads = 0;
    const options = { maxBytes: 1024, cacheHops: true, read: () => ++reads };
    const requests = await counting(async () => {
      const [a, b] = await Promise.all([f.get(`${base}/ok`, options), f.get(`${base}/ok`, options)]);
      const c = await f.get(`${base}/301`, options);
      const d = await f.get(`${base}/302`, options);
      assert.deepEqual([a.body, b.body, c.body, d.body], [1, 1, 1, 1]);
      assert.deepEqual([c.record.redirects, c.record.finalUrl, d.record.finalUrl], [1, `${base}/ok`, `${base}/ok`]);
    });
    assert.deepEqual([requests, f.used, reads], [3, 3, 1]);
  });

  test("failures are shared too, and gets without cacheHops always request", async () => {
    const f = fetcher({ maxRequests: 3 });
    assert.equal((await f.get(`${base}/server-error`, { maxBytes: 1024, cacheHops: true })).record.status, 500);
    assert.equal((await f.get(`${base}/server-error`, { maxBytes: 1024, cacheHops: true })).record.status, 500);
    assert.equal(f.used, 1);
    await f.get(`${base}/server-error`, { maxBytes: 1024 });
    await f.get(`${base}/server-error`, { maxBytes: 1024 });
    assert.equal(f.used, 3);
  });

  test("gets with another read function or other options don't share hops", async () => {
    const f = fetcher();
    const url = `${base}/ok`;
    const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    const length = (bytes: Uint8Array) => bytes.byteLength;
    const requests = await counting(async () => {
      assert.equal((await f.get(url, { maxBytes: 1024, cacheHops: true, read: text })).body, "ok");
      assert.equal((await f.get(url, { maxBytes: 1024, cacheHops: true, read: length })).body, 2);
      assert.ok((await f.get(url, { maxBytes: 1024, cacheHops: true })).body instanceof Uint8Array);
      const small = await f.get(url, { maxBytes: 1, cacheHops: true, read: text });
      assert.deepEqual([small.body, small.record.error], [null, "the body is larger than 1 bytes, so reading stopped"]);
      assert.equal((await f.get(url, { maxBytes: 1024, accept: "text/html", cacheHops: true, read: text })).body, "ok");
      // The same function and options share the first response.
      assert.equal((await f.get(url, { maxBytes: 1024, cacheHops: true, read: text })).body, "ok");
    });
    assert.equal(requests, 5);
  });
});
