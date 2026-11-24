// End-to-end tests: run the real CLI as a child process against a local HTTP server, so no
// external network is involved.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], stdin?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    // The CLI stops reading at its size cap, so writing the rest can fail with EPIPE.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? "");
  });
}

const HARDENED = {
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=()",
};

let server: Server;
let base = "";

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/hardened" });
      res.end();
    } else if (req.url === "/hardened") {
      res.writeHead(200, HARDENED);
      res.end("body is never read");
    } else if (req.url === "/slow") {
      setTimeout(() => res.end(), 2_000);
    } else {
      res.writeHead(200, { "X-Powered-By": "Express" });
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

describe("CLI", () => {
  test("grades a URL and prints a text report", async () => {
    const r = await run([`${base}/hardened`]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Score 100\/100 \(strong\)/);
    assert.match(r.stdout, /PASS {2}Strict-Transport-Security/);
  });

  test("follows redirects and reports the final URL", async () => {
    const r = await run([`${base}/redirect`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.source, `${base}/hardened (HTTP 200)`);
    assert.equal(json.score, 100);
    assert.equal(json.rules.length, 7);
  });

  test("--min-score exits 1 when the score is below the threshold", async () => {
    const r = await run([`${base}/weak`, "--min-score", "80"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /WARN {2}Server info disclosure \(-5\)/);
  });

  test("--min-score exits 0 when the score meets the threshold", async () => {
    const r = await run([`${base}/hardened`, "--min-score", "100"]);
    assert.equal(r.code, 0);
  });

  test("--raw - reads curl -sI output from stdin", async () => {
    const r = await run(["--raw", "-", "--json"], "HTTP/2 200\r\nx-frame-options: DENY\r\n\r\n");
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.source, "stdin");
    assert.equal(json.rules.find((rule: { id: string }) => rule.id === "clickjack-ok")?.status, "passed");
  });

  test("--raw with no headers in the input is a usage error", async () => {
    const r = await run(["--raw", "-"], "nothing useful here");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No headers found/);
  });

  test("--raw input over 1 MB exits 2", async () => {
    const r = await run(["--raw", "-"], `X-A: b
`.repeat(200_000));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 1 MB/);
  });

  test("a request that exceeds --timeout exits 2 with a fixed message", async () => {
    const r = await run([`${base}/slow`, "--timeout", "200"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /timed out/);
  });

  test("an unreachable host exits 2", async () => {
    const r = await run(["http://127.0.0.1:1/", "--timeout", "2000"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^security-header-audit: /);
  });

  test("rejects non-http schemes", async () => {
    const r = await run(["file:///etc/passwd"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Only http and https/);
  });

  test("rejects a URL together with --raw", async () => {
    const r = await run([`${base}/hardened`, "--raw", "-"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /exactly one URL/);
  });

  test("rejects an out-of-range --min-score", async () => {
    const r = await run([`${base}/hardened`, "--min-score", "101"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--min-score must be a whole number/);
  });

  test("rejects unknown options with usage", async () => {
    const r = await run(["--nope"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Usage:/);
  });

  test("--version prints the package version", async () => {
    const r = await run(["--version"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  test("--help prints usage", async () => {
    const r = await run(["--help"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /--min-score/);
  });
});
