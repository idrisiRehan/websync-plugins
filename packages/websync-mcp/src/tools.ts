// The tools this server exposes. Every tool works only on text the client sends: nothing is
// fetched, read from disk or written, so there is no SSRF, path or network surface. Each
// handler is a thin adapter over a published WebSync package.

import { lintLlmsTxt } from "llms-txt-kit";
import { lintMetadata } from "metacheck";
import { analyzeHeaders, parseRawHeaders } from "security-header-audit";
import { lintProductCsv, detectPlatform, type Platform } from "product-csv-lint";
import { validateStructuredData } from "schemaview";
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
const MAX_PAGE = 10 * 1024 * 1024;
const MAX_URL = 2048;

const PAGE_URL = {
  type: "string",
  maxLength: MAX_URL,
  description: "The absolute http(s) URL the content is served from. Used only to resolve relative URLs and compare them; it is not fetched.",
} as const;

/** Validates an optional page URL argument, so a bad one comes back as a fixable tool error. */
function pageUrl(url: string | undefined): { url?: string } {
  if (url === undefined) return {};
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) throw new ToolInputError(`"url" must be an absolute http(s) URL, got "${url}".`);
  return { url };
}

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
  {
    name: "lint_page_metadata",
    title: "Lint a web page's SEO and sharing metadata",
    description:
      "Checks a page's HTML for search and social metadata: title and meta description (presence, duplicates, length guidance), canonical, robots directives, html lang, charset, viewport, Open Graph and X (Twitter) card tags, h1 and heading order, hreflang alternates, and metadata placed in body instead of head. Returns findings with rule ids and line numbers plus the extracted metadata. Pass the raw HTML as served; JavaScript is not run. " +
      READ_ONLY_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        html: { type: "string", maxLength: MAX_PAGE, description: "The page's HTML source." },
        url: PAGE_URL,
      },
      required: ["html"],
      additionalProperties: false,
    },
    run: ({ html, url }) => capFindings(lintMetadata(html, pageUrl(url))),
  },
  {
    name: "validate_structured_data",
    title: "Validate JSON-LD structured data",
    description:
      "Validates schema.org JSON-LD, either in a page's HTML (every application/ld+json script) or as raw JSON-LD, against the required and recommended properties Google documents for rich results: Article, Product and merchant listings, Review, Breadcrumb, Organization, LocalBusiness, Event, Recipe, Video, JobPosting, SoftwareApplication and more. Reports invalid JSON with line numbers, deprecated types, and bad dates, URLs, prices and enum values. Not Google's validator; Microdata and RDFa are not read. " +
      READ_ONLY_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", maxLength: MAX_PAGE, description: "A page's HTML, or JSON-LD text." },
        url: PAGE_URL,
      },
      required: ["input"],
      additionalProperties: false,
    },
    run: ({ input, url }) => {
      const result = validateStructuredData(input, pageUrl(url));
      return { ...capFindings(result), entities: result.entities.slice(0, MAX_FINDINGS), entityCount: result.entities.length };
    },
  },
  {
    name: "lint_llms_txt",
    title: "Lint an llms.txt file",
    description:
      "Checks an llms.txt file against the llmstxt.org proposal: a single H1 first, the blockquote summary, H2 sections of '- [name](url): notes' links, the Optional section, malformed items, invalid and duplicate URLs, and HTML served in place of the file. Returns findings with rule ids and line numbers plus an outline of the file. " +
      READ_ONLY_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", maxLength: MAX_PAGE, description: "The llms.txt content." },
        url: PAGE_URL,
      },
      required: ["text"],
      additionalProperties: false,
    },
    run: ({ text, url }) => {
      const { doc, ...result } = lintLlmsTxt(text, pageUrl(url));
      // The caller already has the text; an outline is enough to talk about its structure.
      const sections = doc.sections.map(({ title, optional, links }) => ({ title, optional, linkCount: links.length }));
      return { ...capFindings(result), outline: { title: doc.title, summary: doc.summary ?? null, sections } };
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
