// End-to-end tests: run the real CLI as a child process against temp files and a local HTTP
// server, so no external network is involved.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../examples/", import.meta.url));
const GOOD = "# Site\n\n> Summary.\n\n## Docs\n\n- [A](https://example.com/a.md): notes\n";
const WARNING = "# Site\n\n## Docs\n\n- [A](https://example.com/a.md) - no colon\n";
const ERROR = "## Docs\n\n- [A](https://example.com/a.md)\n";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], stdin?: string | Buffer): Promise<RunResult> {
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
  dir = mkdtempSync(join(tmpdir(), "llms-txt-kit-"));
  writeFileSync(join(dir, "good.txt"), GOOD);
  writeFileSync(join(dir, "warning.txt"), WARNING);
  writeFileSync(join(dir, "error.txt"), ERROR);
  writeFileSync(join(dir, "latin1.txt"), Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a]));
  writeFileSync(join(dir, "huge.txt"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
  writeFileSync(join(dir, "bad.json"), "{ title: ");
  writeFileSync(join(dir, "shape.json"), JSON.stringify({ title: "S", sections: [{ title: "D", links: [{ title: "A" }] }] }));
  writeFileSync(join(dir, "dupes.json"), JSON.stringify({ title: "S", sections: [{ title: "D", links: [{ title: "A", url: "https://e.com/" }, { title: "B", url: "https://e.com/" }] }] }));

  server = createServer((req, res) => {
    if (req.url === "/llms.txt") {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end(GOOD);
    } else if (req.url === "/docs/llms.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      // Three spellings of one URL, which only match once resolved against /docs/llms.txt.
      res.end(`# Site

## Docs

- [A](http://${req.headers.host}/docs/a.md)
- [B](/docs/a.md)
- [C](a.md)
`);
    } else if (req.url === "/moved") {
      res.writeHead(301, { location: "/docs/llms.txt" });
      res.end();
    } else if (req.url === "/spa/llms.txt") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html>\n<html><body><div id=root></div></body></html>");
    } else if (req.url === "/huge.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      for (let i = 0; i < 6; i++) res.write(chunk);
      res.end();
    } else if (req.url === "/slow.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("# Slow\n"); // never ends
    } else {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<h1>Not found</h1>");
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

describe("lint", () => {
  test("a clean file exits 0 with a summary line", async () => {
    const r = await run(["lint", join(dir, "good.txt")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /: "Site", 1 section, 1 link\n/);
    assert.match(r.stdout, /No problems found\./);
  });

  test("errors exit 1 and show rule and line", async () => {
    const r = await run(["lint", join(dir, "error.txt")]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /no H1, 1 section, 1 link/);
    assert.match(r.stdout, /ERROR {2}h1-missing\n/);
    assert.match(r.stdout, /1 error, 0 warnings/);
  });

  test("warnings alone exit 0", async () => {
    const r = await run(["lint", join(dir, "warning.txt")]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /WARN {3}link-notes \(line 5\)/);
  });

  test("--max-warnings turns too many warnings into exit 1", async () => {
    assert.equal((await run(["lint", join(dir, "warning.txt"), "--max-warnings", "0"])).code, 1);
    assert.equal((await run(["lint", join(dir, "warning.txt"), "--max-warnings", "1"])).code, 0);
  });

  test("--json prints the full result", async () => {
    const r = await run(["lint", join(dir, "warning.txt"), "--json"]);
    const json = JSON.parse(r.stdout);
    assert.equal(json.valid, true);
    assert.equal(json.warningCount, 1);
    assert.deepEqual(json.findings[0], { rule: "link-notes", severity: "warning", message: json.findings[0].message, line: 5 });
    assert.equal(json.doc.title, "Site");
  });

  test("reads stdin with -", async () => {
    const r = await run(["lint", "-", "--json"], GOOD);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, "stdin");
  });

  test("the bundled examples", async () => {
    assert.equal((await run(["lint", join(EXAMPLES, "llms.txt"), "--max-warnings", "0"])).code, 0);
    const r = await run(["lint", join(EXAMPLES, "llms-with-problems.txt")]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /0 errors, 8 warnings/);
  });

  test("a bare origin fetches /llms.txt", async () => {
    for (const target of [base, `${base}/`]) {
      const r = await run(["lint", target, "--json"]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).source, `${base}/llms.txt (HTTP 200)`);
    }
  });

  test("follows redirects and resolves relative links against the final URL", async () => {
    const r = await run(["lint", `${base}/moved`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.source, `${base}/docs/llms.txt (HTTP 200)`);
    assert.deepEqual(json.findings.map((f: { rule: string; line: number }) => [f.rule, f.line]), [["url-duplicate", 6], ["url-duplicate", 7]]);
  });

  test("an HTML page served as llms.txt is a lint error, not a crash", async () => {
    const r = await run(["lint", `${base}/spa/llms.txt`]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}file-html \(line 1\)/);
  });

  test("an HTTP error status exits 2", async () => {
    const r = await run(["lint", `${base}/missing/llms.txt`]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, `llms-txt-kit: ${base}/missing/llms.txt answered HTTP 404.\n`);
  });

  test("stops reading a response past the size cap", async () => {
    const r = await run(["lint", `${base}/huge.txt`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 5 MB/);
  });

  test("refuses a local file past the size cap", async () => {
    const r = await run(["lint", join(dir, "huge.txt")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 5 MB/);
  });

  test("stops reading an endless stdin at the size cap", { timeout: 20_000 }, async () => {
    const child = spawn(process.execPath, [CLI, "lint", "-"]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {}); // EPIPE once the CLI gives up
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const feed = () => {
      while (!child.stdin.destroyed && child.stdin.write(chunk));
    };
    child.stdin.on("drain", feed);
    feed();
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 2);
    assert.match(stderr, /larger than 5 MB/);
  });

  test("--timeout aborts a slow response", async () => {
    const r = await run(["lint", `${base}/slow.txt`, "--timeout", "300"]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "llms-txt-kit: The request timed out.\n");
  });

  test("an unreachable host exits 2", async () => {
    const r = await run(["lint", "http://127.0.0.1:1/llms.txt"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^llms-txt-kit: fetch failed/);
  });

  test("invalid UTF-8 exits 2", async () => {
    const r = await run(["lint", join(dir, "latin1.txt")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not valid UTF-8/);
  });

  test("a missing file exits 2", async () => {
    const r = await run(["lint", join(dir, "nope.txt")]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "llms-txt-kit: File not found.\n");
  });
});

describe("build", () => {
  test("writes the example spec as the example llms.txt", async () => {
    const r = await run(["build", join(EXAMPLES, "llms-spec.json")]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, readFileSync(join(EXAMPLES, "llms.txt"), "utf8"));
    assert.equal(r.stderr, "");
  });

  test("reads the spec from stdin", async () => {
    const r = await run(["build", "-"], JSON.stringify({ title: "S" }));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "# S\n");
  });

  test("reports lint findings in the output on stderr, one line each", async () => {
    const r = await run(["build", join(dir, "dupes.json")]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^# S\n/);
    assert.equal(r.stderr, 'llms-txt-kit: warning url-duplicate (line 6): "https://e.com/" is already listed on line 5.\n');
  });

  test("invalid JSON exits 2", async () => {
    const r = await run(["build", join(dir, "bad.json")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^llms-txt-kit: .*bad\.json is not valid JSON: .*\n$/);
  });

  test("a wrong shape exits 2 and names the field", async () => {
    const r = await run(["build", join(dir, "shape.json")]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "llms-txt-kit: sections[0].links[0].url is required.\n");
    assert.equal(r.stdout, "");
  });
});

describe("usage", () => {
  test("usage errors exit 2 with a one-line message", async () => {
    const cases = [[], ["check", "x"], ["lint"], ["lint", "a", "b"], ["lint", "x", "--nope"], ["lint", "x", "--max-warnings", "-1"], ["lint", "x", "--timeout", "0"], ["build", "x", "--json"], ["lint", "http://exa mple.com"]];
    for (const args of cases) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /^llms-txt-kit: [^\n]+ Run "llms-txt-kit --help" for usage\.\n$/, args.join(" "));
    }
  });

  test("--version and --help", async () => {
    assert.match((await run(["--version"])).stdout.trim(), /^\d+\.\d+\.\d+$/);
    const help = await run(["-h"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /llms-txt-kit lint <file \| url \| ->/);
    assert.match(help.stdout, /llms-txt-kit build <spec\.json \| ->/);
  });
});
