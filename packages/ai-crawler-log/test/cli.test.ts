// End-to-end tests: run the real CLI as a child process on temp files and stdin. The operators'
// IP lists come from a local HTTP server (local-fetch.ts redirects the CLI's fetches there), so no
// test touches the external network.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { RANGE_URLS } from "../src/crawlers.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const PRELOAD = pathToFileURL(fileURLToPath(new URL("./local-fetch.ts", import.meta.url))).href;
const GPTBOT_LIST = "https://openai.com/gptbot.json";
const ANTHROPIC_LIST = "https://claude.com/crawling/bots.json";

const UA = {
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
  claudebot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
};
const entry = (ip: string, path: string, ua: string, status = 200) => `${ip} - - [24/Nov/2026:10:00:00 +0000] "GET ${path} HTTP/1.1" ${status} 512 "-" "${ua}"`;

const LOG = `${[
  entry("132.196.86.12", "/products/wool-runner", UA.gptbot),
  entry("132.196.86.13", "/robots.txt", UA.gptbot),
  entry("203.0.113.5", "/wp-login.php", UA.gptbot, 404),
  entry("203.0.113.6", "/products/wool-runner", UA.gptbot),
  entry("216.73.216.40", "/products/old-shoe", UA.claudebot, 404),
  entry("216.73.216.40", "/llms.txt", UA.claudebot),
  entry("192.0.2.1", "/", UA.chrome),
  "this line is not a log line",
].join("\n")}\n`;
const CLEAN_LOG = `${entry("132.196.86.12", "/products/wool-runner", UA.gptbot)}\n${entry("192.0.2.1", "/", UA.chrome)}\n`;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], stdin?: string | Buffer, nodeOptions: string[] = []): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeOptions, "--conditions=websync-source", "--import", PRELOAD, CLI, ...args], { env: { ...process.env, LOCAL_LISTS: base } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

type Route = { status?: number; body?: string } | ((res: ServerResponse) => void);
let routes: Map<string, Route>;
let requests: { url: string; headers: IncomingHttpHeaders }[] = [];
let server: Server;
let base = "";
let dir = "";

const list = (...prefixes: string[]) => JSON.stringify({ creationTime: "2026-11-24T00:00:00Z", prefixes: prefixes.map((p) => (p.includes(":") ? { ipv6Prefix: p } : { ipv4Prefix: p })) });

function defaultRoutes(): Map<string, Route> {
  const map = new Map<string, Route>(RANGE_URLS.map((url) => [url, { body: list("192.0.2.250/32") }]));
  map.set(GPTBOT_LIST, { body: list("132.196.86.0/24", "2001:db8:aaaa::/48") });
  map.set(ANTHROPIC_LIST, { body: list("216.73.216.0/22") });
  return map;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "ai-crawler-log-"));
  writeFileSync(join(dir, "access.log"), LOG);
  writeFileSync(join(dir, "clean.log"), CLEAN_LOG);
  writeFileSync(join(dir, "access.log.gz"), gzipSync(LOG));
  // logrotate and `cat a.gz b.gz` produce several gzip members in one file.
  writeFileSync(join(dir, "multi.gz"), Buffer.concat([gzipSync(LOG), gzipSync(CLEAN_LOG)]));
  writeFileSync(join(dir, "broken.gz"), gzipSync(LOG).subarray(0, 40));
  writeFileSync(join(dir, "garbage.log"), "one\ntwo\nthree\n");
  writeFileSync(join(dir, "long-line.log"), `${"x".repeat(200_000)}\n${CLEAN_LOG}`);
  // Readable lines but for their length: a user agent past 64 KiB, then (last, with no newline) a long field after it.
  const longUa = entry("132.196.86.12", "/", `GPTBot/1.4 ${"x".repeat(70_000)}`);
  writeFileSync(join(dir, "long-fields.log"), `${longUa}\n${CLEAN_LOG}${entry("132.196.86.12", "/", UA.gptbot)} "${"x".repeat(70_000)}"`);
  writeFileSync(join(dir, "bad-ranges.json"), "{ not json");
  writeFileSync(join(dir, "empty.log"), "");

  server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").slice(1));
    requests.push({ url, headers: req.headers });
    const route = routes.get(url);
    if (typeof route === "function") return route(res);
    res.writeHead(route?.status ?? (route ? 200 : 404), { "content-type": "application/json" });
    res.end(route?.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const fresh = () => {
  routes = defaultRoutes();
  requests = [];
};

interface JsonReport {
  sources: string[];
  ipLists: { from: string; loaded: { url: string; creationTime: string | null; prefixes: number }[]; failed: { url: string; error: string }[] };
  lines: number;
  parsed: number;
  unparsed: number;
  crawlers: { token: string; requests: number; verified: number; spoofed: number; unverified: number; verification: string; spoofedNetworks: unknown; llmsTxt: number; productPages: number }[];
  other: { requests: number; bytes: number | null };
  highlights: string[];
}
const json = (r: RunResult) => JSON.parse(r.stdout) as JsonReport;
const stats = (report: JsonReport, token: string) => report.crawlers.find((c) => c.token === token)!;

describe("text report", () => {
  test("shows the table, highlights and top paths, and exits 1 when requests were spoofed", async () => {
    fresh();
    const r = await run([join(dir, "access.log")]);
    assert.equal(r.code, 1, r.stderr);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /access\.log: 8 lines, 1 unreadable, 2026-11-24 10:00 to 2026-11-24 10:00 UTC$/m);
    assert.match(r.stdout, new RegExp(`^IP lists: ${RANGE_URLS.length} of ${RANGE_URLS.length} fetched from the operators\\.$`, "m"));
    assert.match(r.stdout, /^AI crawler +Operator +Requests +Verified +Spoofed +Products +4xx +5xx$/m);
    assert.match(r.stdout, /^GPTBot +OpenAI +4 +2 +2 +1 +0 +0$/m);
    assert.match(r.stdout, /^ClaudeBot +Anthropic +2 +2 +0 +1 +1 +0$/m);
    assert.match(r.stdout, /^ {2}- 2 requests claimed GPTBot from addresses OpenAI doesn't publish\.$/m);
    assert.match(r.stdout, /^ {2}- ClaudeBot got 1 error response \(4xx or 5xx\)\.$/m);
    assert.match(r.stdout, /^ {4}1 {2}\/llms\.txt$/m);
    assert.match(r.stdout, /^Other requests: 1$/m);
  });

  test("never prints a client address; --show-networks prints /24 networks of spoofed requests only", async () => {
    fresh();
    const plain = await run([join(dir, "access.log")]);
    for (const ip of ["132.196.86.12", "203.0.113.5", "203.0.113.6", "216.73.216.40", "192.0.2.1", "203.0.113.0"]) assert.ok(!plain.stdout.includes(ip), ip);
    const networks = await run([join(dir, "access.log"), "--show-networks"]);
    assert.match(networks.stdout, /^ {2}GPTBot: 203\.0\.113\.0\/24 \(2\)$/m);
    assert.ok(!networks.stdout.includes("203.0.113.5"));
    assert.ok(!networks.stdout.includes("132.196.86."));
  });

  test("exits 0 when nothing was spoofed", async () => {
    fresh();
    const r = await run([join(dir, "clean.log")]);
    assert.equal(r.code, 0, r.stderr);
  });

  test("sends a fixed User-Agent and requests only the table's IP lists, once each", async () => {
    fresh();
    await run([join(dir, "clean.log")]);
    assert.deepEqual(requests.map((r) => r.url).sort(), [...RANGE_URLS].sort());
    assert.match(String(requests[0].headers["user-agent"]), /^ai-crawler-log\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/idrisiRehan\/websync-plugins\)$/);
  });
});

describe("inputs", () => {
  test("gzipped files, several gzip members, plain files and stdin give the same counts", async () => {
    fresh();
    const plain = json(await run([join(dir, "access.log"), "--json"]));
    const gz = json(await run([join(dir, "access.log.gz"), "--json"]));
    const stdin = json(await run(["-", "--json"], LOG));
    const stdinGz = json(await run(["-", "--json"], gzipSync(LOG)));
    for (const r of [gz, stdin, stdinGz]) {
      assert.deepEqual(r.crawlers, plain.crawlers);
      assert.equal(r.lines, 8);
    }
    assert.deepEqual(stdin.sources, ["stdin"]);
    const multi = json(await run([join(dir, "multi.gz"), "--json"]));
    assert.equal(multi.lines, 10);
  });

  test("several files are added up", async () => {
    fresh();
    const r = json(await run([join(dir, "access.log"), join(dir, "clean.log"), "--json"]));
    assert.equal(r.lines, 10);
    assert.equal(stats(r, "GPTBot").requests, 5);
    assert.deepEqual(r.sources, [join(dir, "access.log"), join(dir, "clean.log")]);
  });

  test("an overlong line is cut and counted as unreadable", async () => {
    fresh();
    const r = json(await run([join(dir, "long-line.log"), "--json"]));
    assert.deepEqual([r.lines, r.parsed, r.unparsed], [3, 2, 1]);
  });

  test("a line over 64 KiB is unreadable even when its start reads as a log line", async () => {
    fresh();
    const r = json(await run([join(dir, "long-fields.log"), "--json"]));
    assert.deepEqual([r.lines, r.parsed, r.unparsed], [4, 2, 2]);
    assert.equal(stats(r, "GPTBot").requests, 1);
    assert.equal(r.other.requests, 1);
  });

  test("memory stays bounded when every line is long and has its own path and user agent", async () => {
    fresh();
    const lines = Array.from({ length: 2000 }, (_, i) => entry("192.0.2.1", `/products/p${i}`, `meta-externalagent/1.1 ${"x".repeat(60_000)}${i}`));
    // Keys or cached user agents that kept their whole line alive would hold about 120 MB.
    const r = await run(["-", "--no-verify", "--json"], lines.join("\n"), ["--max-old-space-size=48"]);
    assert.equal(r.code, 0, r.stderr.slice(0, 300));
    assert.equal(stats(json(r), "meta-externalagent").productPages, 2000);
  });

  test("an empty file gives an empty report", async () => {
    fresh();
    const r = await run([join(dir, "empty.log"), "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(json(r).lines, 0);
  });

  test("--format and --product are applied", async () => {
    fresh();
    const common = json(await run([join(dir, "access.log"), "--json", "--format", "common"]));
    assert.equal(stats(common, "GPTBot").requests, 0);
    const products = json(await run([join(dir, "access.log"), "--json", "--product", "/wp-*.php", "--product", "/llms"]));
    assert.equal(stats(products, "GPTBot").productPages, 0, "spoofed requests aren't counted");
    assert.equal(stats(products, "ClaudeBot").productPages, 1);
  });
});

describe("IP lists", () => {
  test("--dump-ranges prints every list; --ranges reads it back without any request", async () => {
    fresh();
    const dump = await run(["--dump-ranges"]);
    assert.equal(dump.code, 0, dump.stderr);
    const data = JSON.parse(dump.stdout) as { fetched: string; lists: Record<string, { creationTime: string; prefixes: string[] }> };
    assert.deepEqual(Object.keys(data.lists).sort(), [...RANGE_URLS].sort());
    assert.deepEqual(data.lists[GPTBOT_LIST], { creationTime: "2026-11-24T00:00:00Z", prefixes: ["132.196.86.0/24", "2001:db8:aaaa::/48"] });
    const file = join(dir, "ranges.json");
    writeFileSync(file, dump.stdout);

    requests = [];
    const offline = await run([join(dir, "access.log"), "--ranges", file, "--json"]);
    assert.equal(offline.code, 1, offline.stderr);
    assert.equal(requests.length, 0);
    const report = json(offline);
    assert.equal(report.ipLists.from, "file");
    assert.deepEqual([stats(report, "GPTBot").verified, stats(report, "GPTBot").spoofed], [2, 2]);

    // A file without some lists says which, instead of reporting "1 of 1".
    writeFileSync(file, JSON.stringify({ lists: { [GPTBOT_LIST]: data.lists[GPTBOT_LIST] } }));
    const partial = await run([join(dir, "access.log"), "--ranges", file]);
    assert.match(partial.stdout, new RegExp(`^IP lists: 1 of ${RANGE_URLS.length} read from .*Not loaded: https://openai\\.com/searchbot\\.json \\(not in the ranges file\\)`, "m"));
  });

  test("a list that fails to load leaves its crawlers unchecked and says why", async () => {
    fresh();
    routes.set(GPTBOT_LIST, { status: 503 });
    routes.set(ANTHROPIC_LIST, { body: "<html>no prefixes here</html>" });
    const r = await run([join(dir, "access.log"), "--json"]);
    assert.equal(r.code, 0, "nothing is spoofed when nothing could be checked");
    const report = json(r);
    assert.deepEqual(report.ipLists.failed, [
      { url: GPTBOT_LIST, error: "HTTP 503" },
      { url: ANTHROPIC_LIST, error: "no IP prefixes found in the response" },
    ]);
    assert.equal(stats(report, "GPTBot").verification, "unchecked");
    assert.deepEqual([stats(report, "GPTBot").spoofed, stats(report, "GPTBot").unverified], [0, 4]);
    const text = await run([join(dir, "access.log")]);
    assert.match(text.stdout, new RegExp(`Not loaded: ${GPTBOT_LIST.replace(/\./g, "\\.")} \\(HTTP 503\\)`));
    assert.match(text.stdout, /^GPTBot +OpenAI +4 +- +- +2 +1 +0$/m);
  });

  // Two runs, so the size cap never races the short timeout: under load, 5 MiB can take longer than 300 ms.
  test("a list request that hangs times out", async () => {
    fresh();
    routes.set(GPTBOT_LIST, () => {}); // never answers
    const r = await run([join(dir, "access.log"), "--json", "--timeout", "300"]);
    // Only the hanging list is asserted: on a loaded machine another may time out as well.
    assert.deepEqual(json(r).ipLists.failed.find((l) => l.url === GPTBOT_LIST), { url: GPTBOT_LIST, error: "timed out after 300 ms" });
    assert.equal(stats(json(r), "GPTBot").verification, "unchecked");
  });

  test("a list that is too large is cut off", async () => {
    fresh();
    routes.set(ANTHROPIC_LIST, (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      for (let i = 0; i < 5; i++) res.write(chunk);
      res.end();
    });
    const report = json(await run([join(dir, "access.log"), "--json", "--timeout", "120000"]));
    assert.deepEqual(report.ipLists.failed, [{ url: ANTHROPIC_LIST, error: "larger than 4 MiB" }]);
  });

  test("--dump-ranges exits 1 when some lists fail, 2 when all do", async () => {
    fresh();
    routes.set(GPTBOT_LIST, { status: 500 });
    const some = await run(["--dump-ranges"]);
    assert.equal(some.code, 1);
    assert.match(some.stderr, /couldn't fetch https:\/\/openai\.com\/gptbot\.json \(HTTP 500\)/);
    assert.ok(!(GPTBOT_LIST in (JSON.parse(some.stdout) as { lists: object }).lists));
    routes = new Map();
    const none = await run(["--dump-ranges"]);
    assert.equal(none.code, 2);
    assert.equal(none.stdout, "");
  });

  test("--no-verify makes no request and flags nothing", async () => {
    fresh();
    const r = await run([join(dir, "access.log"), "--no-verify", "--json"]);
    assert.equal(r.code, 0);
    assert.equal(requests.length, 0);
    const report = json(r);
    assert.equal(report.ipLists.from, "off");
    assert.equal(stats(report, "GPTBot").spoofed, 0);
    assert.match((await run([join(dir, "access.log"), "--no-verify"])).stdout, /^IP lists: not loaded \(--no-verify\)/m);
  });
});

describe("--json", () => {
  test("has the documented shape", async () => {
    fresh();
    const report = json(await run([join(dir, "access.log"), "--json"]));
    assert.deepEqual(Object.keys(report), ["sources", "ipLists", "lines", "parsed", "unparsed", "firstSeen", "lastSeen", "crawlers", "other", "highlights"]);
    assert.deepEqual(Object.keys(report.crawlers[0]), [
      "token", "operator", "kind", "purpose", "ipRanges", "verification", "requests", "verified", "spoofed", "unverified", "status", "bytes",
      "firstSeen", "lastSeen", "productPages", "robotsTxt", "llmsTxt", "sitemaps", "topPaths", "topProducts", "topErrors", "spoofedNetworks",
    ]);
    assert.equal(report.ipLists.loaded.length, RANGE_URLS.length);
    assert.deepEqual(report.ipLists.loaded.find((l) => l.url === GPTBOT_LIST), { url: GPTBOT_LIST, creationTime: "2026-11-24T00:00:00Z", prefixes: 2 });
    assert.equal(stats(report, "GPTBot").spoofedNetworks, null);
    assert.ok(!JSON.stringify(report).includes("203.0.113.5"), "no client address in the JSON");
    assert.ok(report.highlights.length > 0);
  });
});

describe("errors (exit code 2)", () => {
  const cases: [string, string[], RegExp][] = [
    ["no input", [], /Give one or more log files/],
    ["missing file", ["nope.log"], /File not found: nope\.log/],
    ["a directory", ["."], /Not a file: \./],
    ["stdin twice", ["-", "-"], /Stdin \(-\) can be read only once/],
    ["--ranges with --no-verify", ["x.log", "--ranges", "r.json", "--no-verify"], /Use --ranges or --no-verify, not both/],
    ["unknown format", ["x.log", "--format", "apache"], /--format must be one of auto, combined, common, json/],
    ["bad --top", ["x.log", "--top", "0"], /--top must be a whole number from 1 to 100/],
    ["bad --timeout", ["x.log", "--timeout", "fast"], /--timeout must be a whole number/],
    ["unknown option", ["x.log", "--verbose"], /Unknown option '--verbose'/],
    ["--dump-ranges with files", ["--dump-ranges", "x.log"], /--dump-ranges takes no files/],
  ];
  for (const [name, args, message] of cases) {
    test(name, async () => {
      fresh();
      const r = await run(args);
      assert.equal(r.code, 2);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /^ai-crawler-log: /);
      assert.match(r.stderr, message);
      assert.equal(r.stderr.trim().split("\n").length, 1);
    });
  }

  test("a bad --product pattern, a bad ranges file, broken gzip and a log with no readable line", async () => {
    fresh();
    const product = await run([join(dir, "access.log"), "--product", "products/", "--no-verify"]);
    assert.match(product.stderr, /A product pattern is a path fragment starting with "\/"/);
    const ranges = await run([join(dir, "access.log"), "--ranges", join(dir, "bad-ranges.json")]);
    assert.match(ranges.stderr, /The ranges file is not valid JSON/);
    const gz = await run([join(dir, "broken.gz"), "--no-verify"]);
    assert.match(gz.stderr, /broken\.gz: looks gzipped but could not be decompressed/);
    const garbage = await run([join(dir, "garbage.log"), "--no-verify"]);
    assert.match(garbage.stderr, /None of the 3 lines could be read as an access log\./);
    for (const r of [product, ranges, gz, garbage]) assert.equal(r.code, 2);
  });

  test("--help and --version exit 0", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage:/);
    const version = await run(["-v"]);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });
});
