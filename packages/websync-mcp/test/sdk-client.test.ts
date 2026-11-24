// Compliance test: the official MCP TypeScript SDK client starts the real server over stdio,
// negotiates, lists tools and calls each one. If this passes, MCP clients built on the SDK
// can use the server.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
let client: Client;

before(async () => {
  client = new Client({ name: "websync-mcp-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--conditions=websync-source", CLI], stderr: "pipe" }));
});

after(async () => {
  await client.close();
});

describe("official SDK client over stdio", () => {
  test("initializes and reads server info and instructions", () => {
    assert.equal(client.getServerVersion()?.name, "websync-mcp");
    assert.deepEqual(client.getServerCapabilities()?.tools, { listChanged: false });
    assert.match(client.getInstructions() ?? "", /never fetches URLs/);
  });

  test("lists the four tools", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["grade_security_headers", "lint_product_csv", "lint_sitemap", "validate_identifier"]);
  });

  test("calls validate_identifier", async () => {
    const result = await client.callTool({ name: "validate_identifier", arguments: { type: "iban", value: "DE89 3704 0044 0532 0130 00" } });
    assert.equal((result.structuredContent as { valid: boolean }).valid, true);
  });

  test("calls grade_security_headers", async () => {
    const result = await client.callTool({ name: "grade_security_headers", arguments: { headers: "Strict-Transport-Security: max-age=31536000" } });
    assert.equal(typeof (result.structuredContent as { score: number }).score, "number");
  });

  test("calls lint_sitemap with a 50,000-entry sitemap", async () => {
    const body = Array.from({ length: 50_000 }, (_, i) => `<url><loc>https://e.com/p/${i}</loc></url>`).join("\n");
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
    const result = await client.callTool({ name: "lint_sitemap", arguments: { xml } }, undefined, { timeout: 30_000 });
    const data = result.structuredContent as { valid: boolean; entryCount: number; locCount: number };
    assert.deepEqual([data.valid, data.entryCount, data.locCount], [true, 50_000, 50_000]);
  });

  test("calls lint_product_csv", async () => {
    const result = await client.callTool({ name: "lint_product_csv", arguments: { csv: "Type,SKU,Name,Regular price\nsimple,A,Mug,5" } });
    assert.equal((result.structuredContent as { platform: string }).platform, "woocommerce");
  });

  test("bad arguments come back as a tool error, not a protocol error", async () => {
    const result = await client.callTool({ name: "validate_identifier", arguments: { type: "passport", value: "X" } });
    assert.equal(result.isError, true);
  });

  test("an unknown tool is a protocol error", async () => {
    await assert.rejects(client.callTool({ name: "fetch", arguments: {} }), /Unknown tool/);
  });

  test("ping", async () => {
    assert.deepEqual(await client.ping(), {});
  });
});
