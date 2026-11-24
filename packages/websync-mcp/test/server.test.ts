import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer, PROTOCOL_VERSIONS, type JsonRpcResponse } from "../src/server.ts";
import { TOOLS, type Tool } from "../src/tools.ts";

const INFO = { name: "websync-mcp", title: "WebSync tools", version: "1.0.0" };
const server = createServer(TOOLS, INFO);

function request(method: string, params?: unknown, id: number | string = 1): JsonRpcResponse {
  const response = server.handle({ jsonrpc: "2.0", id, method, params });
  assert.ok(response, "expected a response");
  return response;
}

function callTool(name: string, args: unknown) {
  const response = request("tools/call", { name, arguments: args });
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  return response.result as { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
}

describe("lifecycle", () => {
  test("initialize echoes a supported protocol version", () => {
    for (const version of PROTOCOL_VERSIONS) {
      const result = request("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } }).result as Record<string, unknown>;
      assert.equal(result.protocolVersion, version);
    }
  });

  test("initialize answers an unknown version with the newest one", () => {
    const result = request("initialize", { protocolVersion: "1999-01-01" }).result as Record<string, unknown>;
    assert.equal(result.protocolVersion, PROTOCOL_VERSIONS[0]);
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
    assert.deepEqual(result.serverInfo, INFO);
    assert.match(String(result.instructions), /never fetches URLs/);
  });

  test("ping returns an empty result and keeps the id", () => {
    assert.deepEqual(request("ping", undefined, "abc"), { jsonrpc: "2.0", id: "abc", result: {} });
  });

  test("notifications and responses get no reply", () => {
    assert.equal(server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.equal(server.handle({ jsonrpc: "2.0", id: 5, result: {} }), null);
  });
});

describe("JSON-RPC errors", () => {
  test("unparseable JSON", () => {
    assert.deepEqual(server.handleLine("{nope"), { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
  });

  test("blank lines are ignored", () => assert.equal(server.handleLine("  "), null));

  test("non-object messages and bad ids", () => {
    assert.equal(server.handle([1, 2])?.error?.code, -32600);
    assert.equal(server.handle({ jsonrpc: "2.0", id: { x: 1 }, method: "ping" })?.error?.code, -32600);
    assert.equal(server.handle({ jsonrpc: "1.0", id: 1, method: "ping" })?.error?.code, -32600);
  });

  test("unknown method", () => {
    assert.equal(request("resources/list").error?.code, -32601);
  });

  test("unknown tool", () => {
    const response = request("tools/call", { name: "fetch_url", arguments: {} });
    assert.equal(response.error?.code, -32602);
  });

  test("an unexpected exception is reported without internals", () => {
    const boom: Tool = { ...TOOLS[0], name: "boom", run: () => { throw new Error("secret path C:\\internal"); } };
    const response = createServer([boom], INFO).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boom", arguments: { type: "vat", value: "x" } } });
    assert.deepEqual(response?.error, { code: -32603, message: "Internal error." });
  });
});

describe("tools/list", () => {
  test("lists seven read-only tools with strict input schemas", () => {
    const { tools } = request("tools/list").result as { tools: Record<string, any>[] };
    assert.deepEqual(tools.map((t) => t.name), [
      "validate_identifier",
      "grade_security_headers",
      "lint_sitemap",
      "lint_product_csv",
      "lint_page_metadata",
      "validate_structured_data",
      "lint_llms_txt",
    ]);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      assert.ok(tool.description.length > 80);
      assert.equal(tool.run, undefined, "handlers must not leak into the listing");
    }
  });
});

describe("tools/call", () => {
  test("validate_identifier: each type", () => {
    const cases: [string, string, boolean][] = [
      ["vat", "DE 136 695 976", true],
      ["iban", "GB29 NWBK 6016 1331 9268 19", true],
      ["abn", "51 824 753 556", true],
      ["routing", "011000015", true],
      ["gstin", "27AAPFU0939F1ZV", true],
      ["gtin", "4006381333931", true],
      ["isbn", "0-306-40615-2", true],
      ["gtin", "4006381333930", false],
    ];
    for (const [type, value, valid] of cases) {
      const result = callTool("validate_identifier", { type, value });
      assert.equal(result.structuredContent?.valid, valid, `${type} ${value}`);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    }
  });

  test("grade_security_headers from curl output", () => {
    const result = callTool("grade_security_headers", { headers: "HTTP/2 200\r\nx-frame-options: DENY\r\nserver: nginx\r\n\r\n" });
    assert.equal(typeof result.structuredContent?.score, "number");
    assert.equal((result.structuredContent?.rules as unknown[]).length, 7);
  });

  test("lint_sitemap returns findings and a loc count, not the full loc list", () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://e.com/</loc></url><url><loc>/rel</loc></url></urlset>`;
    const data = callTool("lint_sitemap", { xml }).structuredContent!;
    assert.equal(data.valid, false);
    assert.equal(data.locCount, 1);
    assert.equal(data.locs, undefined);
    assert.equal(data.findingsOmitted, 0);
  });

  test("lint_product_csv detects the platform, or takes it", () => {
    const shopify = callTool("lint_product_csv", { csv: "Title,URL handle,Price\nTee,tee,$5" }).structuredContent!;
    assert.equal(shopify.platform, "shopify");
    assert.equal(shopify.errorCount, 1);
    const woo = callTool("lint_product_csv", { csv: "Title\nTee", platform: "woocommerce" }).structuredContent!;
    assert.equal(woo.platform, "woocommerce");
  });

  test("lint_page_metadata returns findings and the extracted metadata", () => {
    const html = '<!doctype html><html lang="en"><head><title>Hi</title><link rel="canonical" href="/a"></head><body><h1>A</h1></body></html>';
    const data = callTool("lint_page_metadata", { html, url: "https://e.com/a" }).structuredContent!;
    assert.equal((data.metadata as { title: string }).title, "Hi");
    assert.equal((data.metadata as { canonical: string }).canonical, "https://e.com/a");
    assert.ok((data.findings as { rule: string }[]).some((f) => f.rule === "title-too-short"));
    assert.equal(data.findingsOmitted, 0);
  });

  test("validate_structured_data reads JSON-LD from HTML and reports a missing required property", () => {
    const json = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", offers: { "@type": "Offer", price: "5", priceCurrency: "USD" } });
    const data = callTool("validate_structured_data", { input: `<script type="application/ld+json">${json}</script>` }).structuredContent!;
    assert.equal(data.valid, false);
    assert.equal(data.entityCount, (data.entities as unknown[]).length);
    assert.ok((data.findings as { rule: string; path: string }[]).some((f) => f.rule === "property-required"));
  });

  test("lint_llms_txt returns an outline instead of every link", () => {
    const text = `# Site

> Summary.

## Docs

- [Guide](https://e.com/guide.md): How to start
- [API](https://e.com/api.md)
`;
    const data = callTool("lint_llms_txt", { text }).structuredContent!;
    assert.equal(data.valid, true);
    assert.deepEqual(data.outline, { title: "Site", summary: "Summary.", sections: [{ title: "Docs", optional: false, linkCount: 2 }] });
    assert.equal(data.doc, undefined);
  });

  test("long finding lists are capped at 200", () => {
    const rows = Array.from({ length: 300 }, (_, i) => `Tee ${i},tee-${i},$${i}`).join("\n");
    const data = callTool("lint_product_csv", { csv: `Title,URL handle,Price\n${rows}` }).structuredContent!;
    assert.equal((data.findings as unknown[]).length, 200);
    assert.equal(data.findingsOmitted, 100);
    assert.equal(data.errorCount, 300);
  });
});

describe("tool input errors come back as tool results the model can act on", () => {
  const cases: [string, unknown, RegExp][] = [
    ["validate_identifier", { type: "ssn", value: "1" }, /must be one of/],
    ["validate_identifier", { type: "vat" }, /Missing required argument "value"/],
    ["validate_identifier", { type: "vat", value: 42 }, /must be a string/],
    ["validate_identifier", { type: "vat", value: "x".repeat(257) }, /longer than 256/],
    ["validate_identifier", { type: "vat", value: "x", url: "http://169.254.169.254/" }, /Unknown argument "url"/],
    ["validate_identifier", "vat", /must be an object/],
    ["grade_security_headers", { headers: "no headers here" }, /No 'Name: value' header lines/],
    ["lint_product_csv", { csv: "name,email\na,b" }, /Pass platform/],
    ["lint_page_metadata", { html: "<title>x</title>", url: "/relative" }, /must be an absolute http/],
    ["lint_llms_txt", { text: "# x", url: "ftp://e.com/" }, /must be an absolute http/],
  ];
  for (const [name, args, pattern] of cases) {
    test(`${name} ${JSON.stringify(args).slice(0, 50)}`, () => {
      const result = callTool(name, args);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
      assert.match(result.content[0].text, pattern);
    });
  }
});
