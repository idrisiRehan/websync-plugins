// The tools this server exposes. Every tool works only on text the client sends: nothing is
// fetched, read from disk or written, so there is no SSRF, path or network surface. Each
// handler is a thin adapter over a published WebSync package.

import { analyzeHeaders, parseRawHeaders } from "security-header-audit";
import { lintProductCsv, detectPlatform, type Platform } from "product-csv-lint";
import { lintSitemap } from "sitemap-lint";
import { validateAbnOrAcn, validateGstin, validateGtin, validateIsbn, validateRoutingNumber, validateVatNumber, analyzeIban } from "websync-validators";

/** JSON Schema for a tool's arguments: an object of string properties. */
interface InputSchema {
  type: "object";
  properties: Record<string, { type: "string"; description: string; enum?: string[]; maxLength?: number }>;
  required: string[];
  additionalProperties: false;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  run(args: Record<string, string>): unknown;
}

/** A tool input the client got wrong. Reported back as a tool error so the model can fix it. */
export class ToolInputError extends Error {}

const MAX_FINDINGS = 200;
const MAX_DOCUMENT = 50 * 1024 * 1024;

// Long finding lists would flood the model's context; keep the first ones and say how many
// were left out.
function capFindings<T extends { findings: unknown[] }>(result: T): T & { findingsOmitted: number } {
  const omitted = Math.max(0, result.findings.length - MAX_FINDINGS);
  return { ...result, findings: result.findings.slice(0, MAX_FINDINGS), findingsOmitted: omitted };
}

const VALIDATORS = {
  vat: validateVatNumber,
  iban: analyzeIban,
  abn: validateAbnOrAcn,
  routing: validateRoutingNumber,
  gstin: validateGstin,
  gtin: validateGtin,
  isbn: validateIsbn,
} as const;

type IdentifierType = keyof typeof VALIDATORS;

const READ_ONLY_NOTE = "Runs offline on the text you pass; nothing is fetched.";

export const TOOLS: Tool[] = [
  {
    name: "validate_identifier",
    title: "Validate a business or product identifier",
    description:
      "Checks the format and check digits of an identifier and reports each check that passed or failed: EU/UK VAT numbers, IBANs (89 countries), Australian ABN or ACN, US ABA routing numbers, Indian GSTINs, GTIN/EAN/UPC barcodes, and ISBN-10/13. A pass means the identifier is well formed, not that it was issued or is active. " +
      READ_ONLY_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: Object.keys(VALIDATORS), description: "Kind of identifier. abn accepts both ABNs (11 digits) and ACNs (9 digits)." },
        value: { type: "string", maxLength: 256, description: "The identifier as written. Spaces and hyphens are ignored." },
      },
      required: ["type", "value"],
      additionalProperties: false,
    },
    run: ({ type, value }) => VALIDATORS[type as IdentifierType](value),
  },
  {
    name: "grade_security_headers",
    title: "Grade HTTP security headers",
    description:
      "Grades HTTP response headers against security best practice (HSTS, Content-Security-Policy, X-Content-Type-Options, clickjacking protection, Referrer-Policy, Permissions-Policy, server disclosure) and returns a 0-100 score with a spec-based reason for each check. Pass the headers as text: 'Name: value' lines or the output of curl -sI (only the last response is graded). " +
      READ_ONLY_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        headers: { type: "string", maxLength: 65_536, description: "Raw response headers, one 'Name: value' per line." },
      },
      required: ["headers"],
      additionalProperties: false,
    },
    run: ({ headers }) => {
      const parsed = parseRawHeaders(headers);
      if (Object.keys(parsed).length === 0) throw new ToolInputError("No 'Name: value' header lines found in headers.");
      return analyzeHeaders(parsed);
    },
  },
  {
    name: "lint_sitemap",
    title: "Lint an XML sitemap",
    description:
      "Checks an XML sitemap or sitemap index against the sitemaps.org protocol: well-formed XML (including unescaped & in URLs), namespace, entry limits, <loc> URLs, <lastmod> dates, <changefreq> and <priority>. Each finding has a rule id and line number. Pass the XML text, not a URL. " +
      READ_ONLY_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        xml: { type: "string", maxLength: MAX_DOCUMENT, description: "The sitemap XML." },
      },
      required: ["xml"],
      additionalProperties: false,
    },
    run: ({ xml }) => {
      const { locs, ...result } = lintSitemap(xml);
      return { ...capFindings(result), locCount: locs.length };
    },
  },
  {
    name: "lint_product_csv",
    title: "Lint a Shopify or WooCommerce product CSV",
    description:
      "Checks a product CSV before import into Shopify (current and legacy column names) or WooCommerce: quoting, delimiter, headers, prices, barcodes, duplicate SKUs, variants and parent links. Each finding has a rule id, spreadsheet row and column. The platform is detected from the header row when not given. " +
      READ_ONLY_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        csv: { type: "string", maxLength: MAX_DOCUMENT, description: "The CSV text, header row first." },
        platform: { type: "string", enum: ["shopify", "woocommerce"], description: "Target platform. Omit to detect it from the header row." },
      },
      required: ["csv"],
      additionalProperties: false,
    },
    run: ({ csv, platform }) => {
      const target = (platform as Platform | undefined) ?? detectPlatform(csv);
      if (!target) throw new ToolInputError("Couldn't tell from the header row whether this is a Shopify or WooCommerce file. Pass platform.");
      return capFindings(lintProductCsv(csv, target));
    },
  },
];

/** Checks arguments against a tool's schema. Throws ToolInputError with a fixable message. */
export function checkArguments(tool: Tool, args: unknown): Record<string, string> {
  if (args === undefined) args = {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new ToolInputError("Arguments must be an object.");
  const { properties, required } = tool.inputSchema;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key];
    if (!schema) throw new ToolInputError(`Unknown argument "${key}". Allowed: ${Object.keys(properties).join(", ")}.`);
    if (typeof value !== "string") throw new ToolInputError(`"${key}" must be a string.`);
    if (schema.enum && !schema.enum.includes(value)) throw new ToolInputError(`"${key}" must be one of: ${schema.enum.join(", ")}.`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new ToolInputError(`"${key}" is longer than ${schema.maxLength} characters.`);
    out[key] = value;
  }
  for (const key of required) {
    if (!(key in out)) throw new ToolInputError(`Missing required argument "${key}".`);
  }
  return out;
}
