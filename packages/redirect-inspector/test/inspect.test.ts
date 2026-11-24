import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { inspectRedirects, type RedirectResult } from "../src/index.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer, type TestServer } from "./server.ts";

let server: TestServer;
let base = "";

before(async () => {
  server = await startServer();
  base = server.base;
});

after(() => server.close());

const rules = (r: RedirectResult) => r.findings.map((f) => f.rule);
const finding = (r: RedirectResult, rule: string) => r.findings.find((f) => f.rule === rule);

/** A fake fetch that answers from a table of URL -> [status, location], for https cases. */
function fakeFetch(table: Record<string, [number, string?]>): typeof fetch {
  return async (input) => {
    const entry = table[String(input)];
    if (!entry) throw new Error(`unexpected request ${String(input)}`);
    const [status, location] = entry;
    return new Response(null, { status, headers: location ? { location } : {} });
  };
}

describe("successful chains", () => {
  test("a 200 with no redirects has no findings beyond plain HTTP", async () => {
    const r = await inspectRedirects(`${base}/ok`);
    assert.equal(r.hops.length, 1);
    assert.equal(r.finalUrl, `${base}/ok`);
    assert.equal(r.finalStatus, 200);
    assert.deepEqual(rules(r), ["https-missing"]);
    assert.equal(r.valid, true);
    assert.equal(r.warningCount, 1);
  });

  test("records every hop with status, Location and timing", async () => {
    const r = await inspectRedirects(`${base}/301`);
    assert.equal(r.hops.length, 2);
    const [first, last] = r.hops;
    assert.equal(first.url, `${base}/301`);
    assert.equal(first.status, 301);
    assert.equal(first.statusText, "Moved Permanently");
    assert.equal(first.location, "/ok");
    assert.ok(first.durationMs >= 0);
    assert.equal(last.url, `${base}/ok`);
    assert.equal(last.location, null);
    assert.equal(r.finalStatus, 200);
  });

  for (const status of [301, 308]) {
    test(`a single ${status} is not flagged`, async () => {
      const r = await inspectRedirects(`${base}/${status}`);
      assert.deepEqual(rules(r), ["https-missing"]);
    });
  }

  for (const status of [302, 303, 307]) {
    test(`a ${status} that reaches a page warns that it is temporary`, async () => {
      const r = await inspectRedirects(`${base}/${status}`);
      const f = finding(r, "redirect-temporary");
      assert.equal(f?.severity, "warning");
      assert.equal(f?.hop, 1);
      assert.match(f?.message ?? "", new RegExp(`^${status} is a temporary redirect.*If the move is permanent, use 301 or 308\\.$`));
      assert.equal(r.valid, true);
    });
  }

  test("a temporary redirect to an error page is not reported as temporary", async () => {
    const r = await inspectRedirects("https://example.test/old", {
      fetch: fakeFetch({ "https://example.test/old": [302, "/gone"], "https://example.test/gone": [404] }),
    });
    assert.ok(!rules(r).includes("redirect-temporary"));
    assert.ok(rules(r).includes("final-status"));
  });

  test("resolves a relative Location against the request URL without flagging it", async () => {
    const r = await inspectRedirects(`${base}/relative`);
    assert.equal(r.hops[0].location, "ok?from=relative");
    assert.equal(r.finalUrl, `${base}/ok?from=relative`);
    assert.deepEqual(rules(r), ["https-missing"]);

    const dot = await inspectRedirects(`${base}/dir/dot-relative`);
    assert.equal(dot.finalUrl, `${base}/ok`);
    assert.equal(dot.valid, true);
  });

  test("a chain of more than one redirect warns to point straight at the final URL", async () => {
    const r = await inspectRedirects(`${base}/chain`);
    assert.deepEqual(r.hops.map((h) => h.status), [301, 301, 200]);
    const f = finding(r, "redirect-chain");
    assert.equal(f?.severity, "warning");
    assert.equal(f?.message, `2 redirects in a row. Point the first URL directly to the final one (${base}/ok).`);
  });

  test("each temporary hop in a chain gets its own warning", async () => {
    const r = await inspectRedirects(`${base}/temporary-chain`);
    assert.deepEqual(r.findings.filter((f) => f.rule === "redirect-temporary").map((f) => f.hop), [1, 2]);
  });
});

describe("broken chains", () => {
  test("detects a loop between two URLs", async () => {
    const r = await inspectRedirects(`${base}/loop-a`);
    assert.equal(r.hops.length, 2);
    const f = finding(r, "redirect-loop");
    assert.equal(f?.severity, "error");
    assert.equal(f?.hop, 2);
    assert.match(f?.message ?? "", /loop-a, which is already in the chain/);
    assert.equal(r.valid, false);
    assert.equal(r.finalStatus, 301);
    assert.ok(!rules(r).includes("redirect-chain"), "no chain advice for a loop");
    assert.ok(!rules(r).includes("https-missing"), "no https advice for a loop");
  });

  test("detects a URL that redirects to itself", async () => {
    const r = await inspectRedirects(`${base}/self`);
    assert.equal(r.hops.length, 1);
    assert.deepEqual(rules(r), ["redirect-loop"]);
  });

  test("a redirect to the same URL with an empty fragment is a loop at once", async () => {
    const r = await inspectRedirects(`${base}/empty-fragment`);
    assert.equal(r.hops.length, 1);
    assert.deepEqual(rules(r), ["redirect-loop"]);
    assert.equal(finding(r, "redirect-loop")?.hop, 1);
  });

  test("follows 10 redirects by default and stops at the 11th", async () => {
    const ten = await inspectRedirects(`${base}/n/10`);
    assert.equal(ten.hops.length, 11);
    assert.equal(ten.finalStatus, 200);
    assert.ok(!rules(ten).includes("too-many-hops"));

    const eleven = await inspectRedirects(`${base}/n/11`);
    assert.equal(eleven.hops.length, 11);
    const f = finding(eleven, "too-many-hops");
    assert.equal(f?.severity, "error");
    assert.equal(f?.hop, 11);
    assert.equal(eleven.finalUrl, `${base}/n/1`);
  });

  test("maxHops changes the limit", async () => {
    assert.ok(rules(await inspectRedirects(`${base}/n/3`, { maxHops: 2 })).includes("too-many-hops"));
    assert.ok(!rules(await inspectRedirects(`${base}/n/3`, { maxHops: 3 })).includes("too-many-hops"));
    const none = await inspectRedirects(`${base}/301`, { maxHops: 0 });
    assert.equal(none.hops.length, 1);
    assert.ok(rules(none).includes("too-many-hops"));
  });

  test("a redirect with no Location is an error", async () => {
    const r = await inspectRedirects(`${base}/no-location`);
    assert.deepEqual(rules(r), ["location-missing"]);
    assert.equal(r.findings[0].hop, 1);
    assert.equal(r.finalStatus, 301);
  });

  test("a Location that isn't a URL is an error", async () => {
    const r = await inspectRedirects(`${base}/bad-location`);
    assert.deepEqual(rules(r), ["location-invalid"]);
    assert.equal(r.hops[0].location, "http://bad host/");
  });

  test("a Location with a non-http scheme is an error", async () => {
    const r = await inspectRedirects(`${base}/ftp-location`);
    assert.deepEqual(rules(r), ["location-scheme"]);
    assert.match(r.findings[0].message, /uses the ftp scheme/);
    assert.equal(server.requests.some((req) => req.url === "/file"), false);
  });

  test("a final 4xx or 5xx is an error", async () => {
    const missing = await inspectRedirects(`${base}/to-missing`);
    assert.equal(missing.finalStatus, 404);
    const f = finding(missing, "final-status");
    assert.equal(f?.severity, "error");
    assert.equal(f?.hop, 2);
    assert.match(f?.message ?? "", /^Ends in 404 Not Found, not a 2xx success\.$/);
    assert.ok(!rules(missing).includes("redirect-chain"));

    const broken = await inspectRedirects(`${base}/server-error`);
    assert.ok(rules(broken).includes("final-status"));
  });

  test("a final 304 to an unconditional request is an error", async () => {
    const r = await inspectRedirects(`${base}/not-modified`);
    const f = finding(r, "final-3xx");
    assert.equal(f?.severity, "error");
    assert.match(f?.message ?? "", /304 Not Modified/);
  });

  test("a 300 is not followed, even with a Location", async () => {
    const r = await inspectRedirects(`${base}/multiple-choices`);
    assert.equal(r.hops.length, 1);
    assert.match(finding(r, "final-3xx")?.message ?? "", /Ends in 300/);
  });
});

describe("HTTPS", () => {
  test("an https to http redirect is an error, and the chain is still followed", async () => {
    const r = await inspectRedirects("https://example.test/", {
      fetch: fakeFetch({ "https://example.test/": [301, "http://example.test/page"], "http://example.test/page": [200] }),
    });
    const f = finding(r, "https-downgrade");
    assert.equal(f?.severity, "error");
    assert.equal(f?.hop, 1);
    assert.equal(r.finalStatus, 200);
  });

  test("http that redirects to https gets no https warning", async () => {
    const r = await inspectRedirects("http://example.test/", {
      fetch: fakeFetch({ "http://example.test/": [301, "https://example.test/"], "https://example.test/": [200] }),
    });
    assert.deepEqual(r.findings, []);
    assert.equal(r.valid, true);
  });

  test("https from the start gets no https warning", async () => {
    const r = await inspectRedirects("https://example.test/", { fetch: fakeFetch({ "https://example.test/": [200] }) });
    assert.deepEqual(r.findings, []);
  });

  test("http that stays on http warns", async () => {
    const r = await inspectRedirects(`${base}/301`);
    const f = finding(r, "https-missing");
    assert.equal(f?.severity, "warning");
    assert.equal(f?.hop, null);
  });
});

describe("requests", () => {
  test("times out a server that never answers", async () => {
    const started = Date.now();
    const r = await inspectRedirects(`${base}/never`, { timeoutMs: 200 });
    assert.ok(Date.now() - started < 2_000);
    assert.equal(r.hops.length, 0);
    assert.equal(r.finalStatus, null);
    assert.equal(r.finalUrl, `${base}/never`);
    const f = finding(r, "request-failed");
    assert.equal(f?.severity, "error");
    assert.match(f?.message ?? "", /timed out after 200 ms/);
  });

  test("a timeout mid-chain keeps the hops before it", async () => {
    const r = await inspectRedirects(`${base}/to-never`, { timeoutMs: 200 });
    assert.equal(r.hops.length, 1);
    assert.equal(r.finalUrl, `${base}/never`);
    assert.equal(r.finalStatus, null);
    assert.deepEqual(rules(r), ["request-failed"]);
  });

  test("a refused connection is a failed request, not an exception", async () => {
    // A port that was just free. (fetch itself refuses port 1 as a "bad port".)
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));
    // localhost can resolve to ::1 and 127.0.0.1, which fails with an AggregateError that has no message.
    for (const host of ["127.0.0.1", "localhost"]) {
      const r = await inspectRedirects(`http://${host}:${port}/`, { timeoutMs: 2_000 });
      assert.deepEqual(rules(r), ["request-failed"]);
      assert.match(r.findings[0].message, new RegExp(`^Request to http://${host}:${port}/ failed: fetch failed: .*ECONNREFUSED.*\\.$`));
    }
  });

  test("GET doesn't wait for the body", async () => {
    const r = await inspectRedirects(`${base}/endless`, { timeoutMs: 2_000 });
    assert.equal(r.finalStatus, 200);
  });

  test("uses GET by default and HEAD when asked", async () => {
    const get = await inspectRedirects(`${base}/get-only`);
    assert.equal(get.finalStatus, 200);
    const head = await inspectRedirects(`${base}/get-only`, { method: "HEAD" });
    assert.equal(head.finalStatus, 405);
    const seen = server.requests.filter((req) => req.url === "/get-only").map((req) => req.method);
    assert.deepEqual(seen.slice(-2), ["GET", "HEAD"]);
  });

  test("sends the User-Agent on every hop", async () => {
    await inspectRedirects(`${base}/chain`, { userAgent: "test-agent/1" });
    const agents = server.requests.slice(-3).map((req) => req.headers["user-agent"]);
    assert.deepEqual(agents, ["test-agent/1", "test-agent/1", "test-agent/1"]);
  });

  test("a Location without a fragment keeps the request's fragment", async () => {
    const r = await inspectRedirects("https://example.test/a#top", {
      fetch: fakeFetch({ "https://example.test/a#top": [301, "/b"], "https://example.test/b#top": [200] }),
    });
    assert.equal(r.finalUrl, "https://example.test/b#top");
  });

  test("an empty fragment in Location is kept, not replaced by the request's", async () => {
    const r = await inspectRedirects("https://example.test/a#top", {
      fetch: fakeFetch({ "https://example.test/a#top": [301, "/b#"], "https://example.test/b#": [200] }),
    });
    assert.equal(r.finalUrl, "https://example.test/b#");
  });

  test("decodes a Location sent as raw UTF-8, as browsers do", async () => {
    const r = await inspectRedirects(`${base}/utf8-location`);
    assert.equal(r.hops[0].location, "/café");
    assert.equal(r.hops[1].url, `${base}/caf%C3%A9`);
    // A Latin-1 byte that isn't valid UTF-8 is left alone.
    const latin1 = await inspectRedirects("https://example.test/", {
      fetch: fakeFetch({ "https://example.test/": [301, "/café"], "https://example.test/caf%C3%A9": [200] }),
    });
    assert.equal(latin1.finalStatus, 200);
  });

  test("throws for a missing, relative or non-http start URL, and for bad options", async () => {
    await assert.rejects(inspectRedirects("not a url"), TypeError);
    await assert.rejects(inspectRedirects("/relative"), TypeError);
    await assert.rejects(inspectRedirects("ftp://example.com/"), /Only http and https/);
    await assert.rejects(inspectRedirects(`${base}/ok`, { maxHops: -1 }), RangeError);
    await assert.rejects(inspectRedirects(`${base}/ok`, { timeoutMs: 0 }), RangeError);
  });

  test("refuses a fetch that hides redirects, as browsers do", async () => {
    const opaque = (async () => ({ type: "opaqueredirect", status: 0, statusText: "", headers: new Headers(), body: null }) as unknown as Response) as typeof fetch;
    await assert.rejects(inspectRedirects("https://example.test/", { fetch: opaque }), /hides redirect responses/);
  });
});
