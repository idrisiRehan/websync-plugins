# websync-mcp

A local [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI
assistants (Claude Code, Claude Desktop, Cursor and any other MCP client) four offline checks
from WebSync:

| Tool | What it does |
|---|---|
| `validate_identifier` | Check digits and format for EU/UK VAT numbers, IBANs (89 countries), Australian ABN/ACN, US routing numbers, Indian GSTINs, GTIN/EAN/UPC barcodes and ISBNs. Reports each check that passed or failed. |
| `grade_security_headers` | Grades HTTP response headers (HSTS, CSP, clickjacking, nosniff, Referrer-Policy, Permissions-Policy), with a 0-100 score and a spec-based reason for each check. |
| `lint_sitemap` | Lints an XML sitemap or sitemap index against the sitemaps.org protocol, with line numbers. |
| `lint_product_csv` | Lints a Shopify or WooCommerce product CSV before import, with spreadsheet row numbers. |

**No network access.** Every tool works only on the text the assistant passes in. The server
never fetches URLs, reads or writes files, or opens sockets. To check a live site, the
assistant fetches the headers, sitemap or CSV with its own tools and passes the text. That
leaves no SSRF surface and no way to make the server reach your internal network.

Each tool is a thin adapter over a published package:
[`websync-validators`](../validators), [`security-header-audit`](../security-header-audit),
[`sitemap-lint`](../sitemap-lint) and [`product-csv-lint`](../product-csv-lint). The server
itself has no other dependencies.

## Set up

Requires Node 22 or later.

**Claude Code**

```sh
claude mcp add websync -- npx -y websync-mcp
```

**Claude Desktop, Cursor and other clients** that use an `mcpServers` config file:

```json
{
  "mcpServers": {
    "websync": {
      "command": "npx",
      "args": ["-y", "websync-mcp"]
    }
  }
}
```

Then ask in plain language, for example:

- "Is DE136695976 a valid VAT number?"
- "Fetch the headers for https://example.com and grade them."
- "Check public/sitemap.xml against the sitemap protocol."
- "Lint products_export.csv before I import it into Shopify."

## Tool reference

Every tool returns its result twice: as `structuredContent` (an object) and as the same JSON in
a text block, for clients that only read text. Bad arguments, such as an unknown identifier
type or a CSV whose platform can't be detected, come back as a tool result with `isError: true`
and a message the assistant can act on. All tools are marked read-only, idempotent and
closed-world.

| Tool | Arguments | Result |
|---|---|---|
| `validate_identifier` | `type`: one of `vat`, `iban`, `abn` (ABN or ACN), `routing`, `gstin`, `gtin`, `isbn`. `value`: up to 256 characters | The validator's result: `valid`, normalized value, and `checks` with `pass`/`fail`/`skipped` for each |
| `grade_security_headers` | `headers`: raw `Name: value` lines or `curl -sI` output, up to 64 KB | `score`, `rating`, `rules` |
| `lint_sitemap` | `xml`: up to 50 MB | `valid`, `kind`, `entryCount`, `locCount`, `findings` |
| `lint_product_csv` | `csv`: up to 50 MB. `platform` (optional): `shopify` or `woocommerce` | `valid`, `platform`, counts, `findings` |

Finding lists are capped at 200 entries, so a large file doesn't flood the assistant's context.
`findingsOmitted` says how many were left out, and the error and warning counts always cover
the whole file. `lint_sitemap` returns `locCount` instead of every URL.

## Protocol

- Transport: stdio (newline-delimited JSON-RPC 2.0). Protocol messages go to stdout only.
- Protocol versions: `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`. The server
  echoes a supported version the client asks for, and otherwise offers the newest.
- Capabilities: `tools` only (no resources, prompts or sampling).
- The test suite drives the server with the official MCP TypeScript SDK client.

## Limitations

- What a pass means is set by each underlying package. See their READMEs. A valid identifier is
  well formed, not necessarily issued. A good header score isn't a security certification.
- Messages larger than 128 MB are refused.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)
