import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseLogLine } from "../src/parse.ts";

const GPTBOT_UA = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot";
const COMBINED = `132.196.86.12 - - [24/Nov/2026:10:15:32 +0000] "GET /products/wool-runner?variant=1 HTTP/1.1" 200 51234 "-" "${GPTBOT_UA}"`;
const T = Date.UTC(2026, 10, 24, 10, 15, 32);

describe("NCSA Combined and Common", () => {
  test("reads a Combined line (Apache and nginx's default)", () => {
    assert.deepEqual(parseLogLine(COMBINED), {
      ip: "132.196.86.12",
      time: T,
      method: "GET",
      target: "/products/wool-runner?variant=1",
      status: 200,
      bytes: 51234,
      userAgent: GPTBOT_UA,
    });
    assert.deepEqual(parseLogLine(COMBINED, "combined"), parseLogLine(COMBINED));
  });

  test("reads a Common line, with no user agent", () => {
    const line = `2001:db8::7 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326`;
    assert.deepEqual(parseLogLine(line), { ip: "2001:db8::7", time: Date.UTC(2000, 9, 10, 20, 55, 36), method: "GET", target: "/apache_pb.gif", status: 200, bytes: 2326, userAgent: null });
    assert.deepEqual(parseLogLine(line, "common"), parseLogLine(line));
    assert.equal(parseLogLine(line, "combined"), null);
  });

  test("--format common ignores the referer and user agent", () => {
    assert.equal(parseLogLine(COMBINED, "common")?.userAgent, null);
  });

  test("time zone offsets are applied", () => {
    assert.equal(parseLogLine(COMBINED.replace("+0000", "+0530"))?.time, T - (5 * 60 + 30) * 60_000);
    assert.equal(parseLogLine(COMBINED.replace("+0000", "-0800"))?.time, T + 8 * 3_600_000);
  });

  test('"-" for no body is 0 bytes, and "-" for the user agent or client is null', () => {
    const line = `- - - [24/Nov/2026:10:15:32 +0000] "HEAD / HTTP/1.1" 304 - "-" "-"`;
    assert.deepEqual(parseLogLine(line), { ip: null, time: T, method: "HEAD", target: "/", status: 304, bytes: 0, userAgent: null });
  });

  test("Apache escapes: backslash-quote, double backslash, \\xhh and \\t", () => {
    const line = `192.0.2.1 - - [24/Nov/2026:10:15:32 +0000] "GET /a\\"b HTTP/1.1" 404 10 "-" "Bot \\"quoted\\" \\\\path\\x41\\tend"`;
    const entry = parseLogLine(line);
    assert.equal(entry?.target, '/a"b');
    assert.equal(entry?.userAgent, 'Bot "quoted" \\pathA\tend');
  });

  test("nginx escapes: \\x22 for a quote and \\x5C for a backslash", () => {
    const line = `192.0.2.1 - - [24/Nov/2026:10:15:32 +0000] "GET /q?x=\\x22a\\x22 HTTP/1.1" 200 1 "-" "say \\x22hi\\x22 \\x5C ok"`;
    const entry = parseLogLine(line);
    assert.equal(entry?.target, '/q?x="a"');
    assert.equal(entry?.userAgent, 'say "hi" \\ ok');
  });

  test("escaped bytes of a non-ASCII character are decoded as UTF-8, as both servers escape them", () => {
    const line = `192.0.2.1 - - [24/Nov/2026:10:15:32 +0000] "GET /caf\\xC3\\xA9 HTTP/1.1" 200 1 "-" "Bot \\xE2\\x9C\\x93"`;
    const entry = parseLogLine(line);
    assert.equal(entry?.target, `/caf${String.fromCodePoint(0xe9)}`);
    assert.equal(entry?.userAgent, `Bot ${String.fromCodePoint(0x2713)}`);
  });

  test("an unreadable request line keeps the rest of the record", () => {
    const line = `203.0.113.77 - - [18/Nov/2026:09:12:44 +0000] "\\x16\\x03\\x01\\x02\\x00" 400 157 "-" "-"`;
    const entry = parseLogLine(line);
    assert.equal(entry?.status, 400);
    assert.equal(entry?.method, null);
    assert.equal(entry?.target, null);
  });

  test("extra fields after the user agent are ignored (nginx with $http_x_forwarded_for)", () => {
    assert.equal(parseLogLine(`${COMBINED} "198.51.100.7" rt=0.012`)?.userAgent, GPTBOT_UA);
  });

  test("CRLF line endings and surrounding blanks are fine", () => {
    assert.deepEqual(parseLogLine(`  ${COMBINED}\r\n`), parseLogLine(COMBINED));
  });

  test("malformed lines are null", () => {
    const bad = [
      "",
      "   ",
      "garbage",
      "# a comment",
      COMBINED.replace("[24/Nov/2026:10:15:32 +0000]", "[24/Foo/2026:10:15:32 +0000]"),
      COMBINED.replace("[24/Nov/2026:10:15:32 +0000]", "[2026-11-24T10:15:32Z]"),
      COMBINED.replace(" 200 ", " OK "),
      COMBINED.replace(" 200 ", " 999 "),
      COMBINED.replace(" 51234 ", " lots "),
      COMBINED.slice(0, COMBINED.indexOf("wool")), // cut inside the request
      COMBINED.replace('"GET', "GET"),
    ];
    for (const line of bad) assert.equal(parseLogLine(line), null, line);
    assert.equal(parseLogLine(COMBINED.slice(0, COMBINED.lastIndexOf('"')), "combined"), null);
    assert.equal(parseLogLine(42 as unknown as string), null);
  });

  test("a line with an unclosed user agent still reads as Common in auto mode", () => {
    const line = `192.0.2.1 - - [24/Nov/2026:10:15:32 +0000] "GET / HTTP/1.1" 200 5 "-" "never closed`;
    assert.equal(parseLogLine(line)?.status, 200);
    assert.equal(parseLogLine(line)?.userAgent, null);
    assert.equal(parseLogLine(line, "combined"), null);
  });

  test("absolute-form targets are kept as logged", () => {
    assert.equal(parseLogLine(COMBINED.replace("/products/wool-runner?variant=1", "http://shop.example/products/x"))?.target, "http://shop.example/products/x");
  });
});

describe("JSON lines", () => {
  test("nginx: a log_format with escape=json and variable names as keys", () => {
    const line = JSON.stringify({
      remote_addr: "132.196.86.12",
      time_iso8601: "2026-11-24T10:15:32+00:00",
      request: "GET /products/wool-runner HTTP/1.1",
      status: "200",
      body_bytes_sent: "51234",
      http_referer: "",
      http_user_agent: GPTBOT_UA,
    });
    assert.deepEqual(parseLogLine(line), { ip: "132.196.86.12", time: T, method: "GET", target: "/products/wool-runner", status: 200, bytes: 51234, userAgent: GPTBOT_UA });
    assert.deepEqual(parseLogLine(line, "json"), parseLogLine(line));
  });

  test("nginx: request_method, request_uri, $time_local and $msec", () => {
    const base = { remote_addr: "192.0.2.1", request_method: "GET", request_uri: "/a?b=1", status: 404, bytes_sent: 99, http_user_agent: "x" };
    assert.deepEqual(parseLogLine(JSON.stringify({ ...base, time_local: "24/Nov/2026:10:15:32 +0000" })), { ip: "192.0.2.1", time: T, method: "GET", target: "/a?b=1", status: 404, bytes: 99, userAgent: "x" });
    assert.equal(parseLogLine(JSON.stringify({ ...base, msec: "1795515332.123" }))?.time, 1795515332123);
  });

  test("Caddy: the structured access log", () => {
    const line = JSON.stringify({
      level: "info",
      ts: T / 1000 + 0.5241024,
      logger: "http.log.access",
      msg: "handled request",
      request: {
        remote_ip: "10.0.0.2",
        remote_port: "41342",
        client_ip: "216.73.216.40",
        proto: "HTTP/2.0",
        method: "GET",
        host: "shop.example",
        uri: "/llms.txt",
        headers: { "User-Agent": ["ClaudeBot/1.0"], Accept: ["*/*"] },
      },
      bytes_read: 0,
      duration: 0.0009,
      size: 10900,
      status: 200,
      resp_headers: {},
    });
    assert.deepEqual(parseLogLine(line), { ip: "216.73.216.40", time: T + 524, method: "GET", target: "/llms.txt", status: 200, bytes: 10900, userAgent: "ClaudeBot/1.0" });
  });

  test("Caddy without client_ip falls back to remote_ip", () => {
    const line = JSON.stringify({ request: { remote_ip: "192.0.2.9", method: "GET", uri: "/", headers: {} }, status: 200 });
    assert.equal(parseLogLine(line)?.ip, "192.0.2.9");
    assert.equal(parseLogLine(line)?.userAgent, null);
  });

  test("Cloudflare Logpush http_requests, with each timestamp format", () => {
    const base = {
      ClientIP: "2001:db8::5",
      ClientRequestMethod: "GET",
      ClientRequestPath: "/products/x",
      ClientRequestURI: "/products/x?ref=ai",
      ClientRequestUserAgent: "PerplexityBot/1.0",
      EdgeResponseStatus: 200,
      EdgeResponseBytes: 3100,
      OriginResponseStatus: 0,
    };
    const expected = { ip: "2001:db8::5", time: T, method: "GET", target: "/products/x?ref=ai", status: 200, bytes: 3100, userAgent: "PerplexityBot/1.0" };
    for (const stamp of [T * 1_000_000, T / 1000, "2026-11-24T10:15:32Z"]) {
      assert.deepEqual(parseLogLine(JSON.stringify({ ...base, EdgeStartTimestamp: stamp })), expected, String(stamp));
    }
  });

  test('"-" and empty strings count as missing, as nginx writes them', () => {
    const line = JSON.stringify({ remote_addr: "-", request_uri: "/", status: "200", http_user_agent: "-" });
    assert.deepEqual(parseLogLine(line), { ip: null, time: null, method: null, target: "/", status: 200, bytes: null, userAgent: null });
  });

  test("JSON that isn't a request, or isn't valid, is null", () => {
    for (const line of ['{"level":"info","msg":"server running"}', "{not json", "[1,2,3]", "{}", '{"status":"teapot"}', "null"]) {
      assert.equal(parseLogLine(line, "json"), null, line);
    }
    assert.equal(parseLogLine(COMBINED, "json"), null);
    assert.equal(parseLogLine('{"request":{"uri":"/x","headers":{"User-Agent":"not-an-array"}}}')?.userAgent, null);
  });

  test("JSON keys that are prototype names don't confuse lookups", () => {
    assert.equal(parseLogLine('{"__proto__":{"status":200},"request":{"constructor":1}}'), null);
  });
});

test("never throws on random input, and stays fast on hostile lines", () => {
  let seed = 1;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const alphabet = ' "\\[]{}:/-x0123456789abcdefGET HTTP+,.\t';
  for (let i = 0; i < 20_000; i++) {
    let line = random() < 0.5 ? COMBINED.slice(0, Math.floor(random() * COMBINED.length)) : "";
    for (let j = Math.floor(random() * 80); j > 0; j--) line += alphabet[Math.floor(random() * alphabet.length)];
    for (const format of ["auto", "combined", "common", "json"] as const) parseLogLine(line, format);
  }
  const start = performance.now();
  parseLogLine(`1 - - [24/Nov/2026:10:15:32 +0000] "${"\\".repeat(500_000)}`);
  parseLogLine(`1 - - [24/Nov/2026:10:15:32 +0000] "GET / HTTP/1.1" 200 1 "${"\\x".repeat(250_000)}" "a"`);
  parseLogLine(`${" [".repeat(250_000)}`);
  parseLogLine(`{"a":${"[".repeat(5000)}`);
  assert.ok(performance.now() - start < 1000);
});
