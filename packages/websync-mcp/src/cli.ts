#!/usr/bin/env node
// stdio transport: newline-delimited JSON-RPC on stdin and stdout. stdout carries protocol
// messages only; anything for humans goes to stderr.

import { readFileSync } from "node:fs";
import { createServer } from "./server.ts";
import { TOOLS } from "./tools.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

// One message may carry a whole sitemap or CSV (up to 50 MB of text, more once escaped as
// JSON). Anything beyond this cap is dropped rather than buffered without limit.
const MAX_LINE = 128 * 1024 * 1024;

const server = createServer(TOOLS, { name: "websync-mcp", title: "WebSync tools", version });

function send(response: unknown): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

// Only each new chunk is searched for a newline, so a large message costs linear time.
let pending: string[] = [];
let pendingLength = 0;
let discarding = false;

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  let start = 0;
  for (let nl = chunk.indexOf("\n"); nl !== -1; nl = chunk.indexOf("\n", start)) {
    pending.push(chunk.slice(start, nl));
    const line = pending.join("");
    pending = [];
    pendingLength = 0;
    start = nl + 1;
    if (discarding) {
      discarding = false;
      continue;
    }
    const response = server.handleLine(line);
    if (response) send(response);
  }
  if (discarding) return;
  const rest = chunk.slice(start);
  pending.push(rest);
  pendingLength += rest.length;
  if (pendingLength > MAX_LINE) {
    pending = [];
    pendingLength = 0;
    discarding = true;
    send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Message too large." } });
  }
});
