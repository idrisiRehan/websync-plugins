// End-to-end tests: run the real CLI as a child process against temp files and a local HTTP
// server, so no external network is involved.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const GOOD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trail Running Shoes for Wet Ground | Example</title>
<meta name="description" content="Compare trail running shoes for mud and wet rock: grip, drop, weight and fit, with sizing advice and free returns within 30 days.">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="Trail shoes">
<meta property="og:type" content="website">
<meta property="og:image" content="https://example.com/a.jpg">
<meta property="og:url" content="https://example.com/">
</head>
<body><h1>Trail shoes</h1></body>
</html>
`;
const WARNING = GOOD.replace("<h1>Trail shoes</h1>", "<h2>Trail shoes</h2>");
const ERROR = GOOD.replace(/<title>.*<\/title>/, "");
const RELATIVE = GOOD.replace('href="https://example.com/"', 'href="/shoes/"');

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
    child.stdin.end(stdin ?? "");
  });
}

let dir = "";
let server: Server;
let base = "";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "metacheck-"));
  writeFileSync(join(dir, "good.html"), GOOD);
  writeFileSync(join(dir, "error.html"), ERROR);
  writeFileSync(join(dir, "warning.html"), WARNING);
  writeFileSync(join(dir, "relative.html"), RELATIVE);
  writeFileSync(join(dir, "bom.html"), `﻿${GOOD.replace('<meta charset="utf-8">\n', "")}`);

  server = createServer((req, res) => {
    if (req.url === "/shoes/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(RELATIVE);
    } else if (req.url === "/old") {
      res.writeHead(301, { location: "/shoes/" });
      res.end();
    } else if (req.url === "/ua") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(GOOD.replace("Trail shoes</h1>", `${req.headers["user-agent"]}</h1>`));
    } else if (req.url === "/huge") {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      for (let i = 0; i < 11; i++) res.write(chunk);
      res.end();
    } else if (req.url === "/image.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end("png");
    } else if (req.url === "/slow") {
      // Never answers; the client's timeout must fire.
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("CLI", () => {
  test("a clean file exits 0 with no problems", async () => {
    const r = await run([join(dir, "good.html")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /good\.html: "Trail Running Shoes for Wet Ground \| Example"/);
    assert.match(r.stdout, /No problems found\./);
  });

  test("errors exit 1 and show rule and message", async () => {
    const r = await run([join(dir, "error.html")]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /error\.html: no title/);
    assert.match(r.stdout, /ERROR {2}title-missing\n {7}The page has no <title>/);
    assert.match(r.stdout, /1 error, 0 warnings/);
  });

  test("warnings alone exit 0 and show the line", async () => {
    const r = await run([join(dir, "warning.html")]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /WARN {3}h1-missing/);
  });

  test("--max-warnings turns too many warnings into exit 1", async () => {
    assert.equal((await run([join(dir, "warning.html"), "--max-warnings", "0"])).code, 1);
    assert.equal((await run([join(dir, "warning.html"), "--max-warnings", "1"])).code, 0);
  });

  test("--json prints the full result with the source", async () => {
    const r = await run([join(dir, "error.html"), "--json"]);
    const json = JSON.parse(r.stdout);
    assert.equal(json.source, join(dir, "error.html"));
    assert.equal(json.valid, false);
    assert.equal(json.findings[0].rule, "title-missing");
    assert.equal(json.findings[0].line, null);
    assert.equal(json.metadata.canonical, "https://example.com/");
  });

  test("reads stdin with -", async () => {
    const r = await run(["-", "--json"], GOOD);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, "stdin");
  });

  test("--url resolves relative URLs for file and stdin input", async () => {
    const r = await run([join(dir, "relative.html"), "--json", "--url", "https://example.com/shoes/?a=1"]);
    assert.equal(JSON.parse(r.stdout).metadata.canonical, "https://example.com/shoes/");
    const s = await run(["-", "--json", "--url", "https://example.com/"], RELATIVE);
    assert.equal(JSON.parse(s.stdout).metadata.canonical, "https://example.com/shoes/");
  });

  test("keeps a byte order mark, which declares the encoding", async () => {
    const r = await run([join(dir, "bom.html")]);
    assert.equal(r.code, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /charset-missing/);
  });

  test("fetches a URL, follows redirects and lints against the final URL", async () => {
    const r = await run([`${base}/old`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.source, `${base}/shoes/ (HTTP 200)`);
    assert.equal(json.metadata.canonical, `${base}/shoes/`);
  });

  test("sends a metacheck user-agent", async () => {
    const r = await run([`${base}/ua`, "--json"]);
    assert.match(JSON.parse(r.stdout).metadata.headings[0].text, /^metacheck\/\d+\.\d+\.\d+ \(\+https:\/\/websync\.in\/tools\/seo-analyzer\/\)$/);
  });

  test("stops reading a response past 10 MB", async () => {
    const r = await run([`${base}/huge`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^metacheck: The page is larger than 10 MB/);
  });

  test("refuses a response that isn't HTML", async () => {
    const r = await run([`${base}/image.png`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /is image\/png, not HTML/);
  });

  test("an HTTP error status exits 2", async () => {
    const r = await run([`${base}/missing`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /HTTP 404/);
  });

  test("--timeout aborts a slow server with exit 2", async () => {
    const r = await run([`${base}/slow`, "--timeout", "200"]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim(), "metacheck: The request timed out.");
  });

  test("a missing file exits 2 with one line", async () => {
    const r = await run([join(dir, "nope.html")]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim(), "metacheck: File not found.");
  });

  test("usage errors exit 2 with usage", async () => {
    const file = join(dir, "good.html");
    const cases = [[], ["a", "b"], ["--nope"], [file, "--max-warnings", "-1"], [file, "--timeout", "0"], [file, "--url", "/relative"], [`${base}/shoes/`, "--url", "https://example.com/"]];
    for (const args of cases) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /Usage:/, args.join(" "));
    }
  });

  test("--version and --help", async () => {
    assert.match((await run(["--version"])).stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.match((await run(["-h"])).stdout, /--max-warnings/);
  });
});
