// Structured data checks: JSON syntax, JSON-LD structure, Google rich-result requirements
// (from the table in rich-results.ts) and value formats. Pure and offline.

import { extractJsonLd } from "./extract.ts";
import { childPath, idOf, index, propertyOf, SCHEMA_ORG_PREFIX, typesOf, valuesOf, variantGroups, type Graph } from "./graph.ts";
import { parseJson, type JsonNode, type JsonObject } from "./json.ts";
import { RICH_RESULT_TYPES, VALUE_FORMATS, type Shape, type ValueFormat } from "./rich-results.ts";

export type Severity = "error" | "warning";

export type RuleId =
  | "jsonld-missing"
  | "script-empty"
  | "json-invalid"
  | "json-duplicate-key"
  | "root-invalid"
  | "context-missing"
  | "context-invalid"
  | "type-missing"
  | "type-invalid"
  | "id-conflict"
  | "type-deprecated"
  | "type-ineligible"
  | "property-required"
  | "property-recommended"
  | "list-too-short"
  | "date-invalid"
  | "duration-invalid"
  | "url-invalid"
  | "url-relative"
  | "price-invalid"
  | "currency-invalid"
  | "integer-invalid"
  | "rating-invalid"
  | "enum-invalid";

export interface StructuredDataFinding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** 1-based line in the input, when the finding belongs to one place. */
  line: number | null;
  /** JSONPath of the value inside its JSON-LD block, for example $.offers.price. */
  path: string | null;
}

export interface StructuredDataEntity {
  /** @type values, with any schema.org prefix removed. */
  types: string[];
  id: string | null;
  line: number;
  path: string;
  /** Google rich-result features whose requirements were checked against this node. */
  richResults: string[];
}

export interface StructuredDataResult {
  /** True when there are no errors. Warnings don't make the markup invalid. */
  valid: boolean;
  format: "html" | "json";
  /** Number of JSON-LD blocks found (scripts in HTML, or 1 for raw JSON). */
  blockCount: number;
  entities: StructuredDataEntity[];
  findings: StructuredDataFinding[];
  errorCount: number;
  warningCount: number;
}

export interface ValidateOptions {
  /** The page's URL. Relative URLs in the markup are resolved against it in messages. */
  url?: string;
}

type Report = (rule: RuleId, severity: Severity, message: string, line?: number | null, path?: string | null) => void;
type Level = "required" | "recommended";
// root: top level or @graph. standalone: also eligible for rich results (mainEntity, list items).
type NodeKind = "root" | "standalone" | "listItem" | "nested";

interface Missing {
  level: Level;
  features: string[];
  line: number;
  path: string;
  requirement: string;
}

interface Context extends Graph {
  report: Report;
  base: URL | undefined;
  /** Values that satisfy a required property, so a bad format there is an error. */
  requiredValues: Set<JsonNode>;
  /** Missing properties per node, keyed by requirement, so two features share one finding. */
  missing: Map<JsonNode, Map<string, Missing>>;
  /** A variant's group, and the properties the variant may take from it (sharedWithVariants). */
  inherited: Map<JsonNode, { group: JsonObject; shared: readonly string[] }>;
  /** Groups checked against an entry with sharedWithVariants. */
  checkedGroups: Set<JsonNode>;
  entities: StructuredDataEntity[];
}

interface Problem {
  rule: RuleId;
  message: string;
  /** A warning even on a required property. */
  warningOnly?: boolean;
}

const SCHEMA_ORG = /^https?:\/\/schema\.org\/?$/;
const WWW_SCHEMA_ORG = /^https?:\/\/www\.schema\.org\/?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(?:Z|[+-](\d{2})(?::?(\d{2}))?)?)?$/;
const ISO_DURATION = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:[.,]\d+)?S)?)?$/;
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;

function joinList(items: string[], word: "and" | "or"): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${word} ${items.at(-1)}`;
}

function show(node: JsonNode): string {
  if (node.kind === "string") return JSON.stringify(node.value.length > 80 ? `${node.value.slice(0, 77)}...` : node.value);
  if (node.kind === "number" || node.kind === "boolean") return String(node.value);
  return node.kind;
}

function sameValue(a: JsonNode, b: JsonNode): boolean {
  if (a.kind === "object") {
    return b.kind === "object" && a.props.size === b.props.size && [...a.props].every(([key, value]) => {
      const other = b.props.get(key);
      return other !== undefined && sameValue(value, other);
    });
  }
  if (a.kind === "array") return b.kind === "array" && a.items.length === b.items.length && a.items.every((item, i) => sameValue(item, b.items[i]));
  if (a.kind === "null") return b.kind === "null";
  return b.kind === a.kind && "value" in b && b.value === a.value;
}

function isSchemaOrgContext(node: JsonNode, pattern = SCHEMA_ORG): boolean {
  if (node.kind === "string") return pattern.test(node.value.trim());
  if (node.kind === "array") return node.items.some((item) => isSchemaOrgContext(item, pattern));
  if (node.kind === "object") {
    const vocab = node.props.get("@vocab");
    return vocab?.kind === "string" && pattern.test(vocab.value.trim());
  }
  return false;
}

function resolvePath(ctx: Context, node: JsonObject, segments: string[]): JsonNode[] {
  let current: JsonNode[] = [node];
  for (const segment of segments) current = current.flatMap((n) => (n.kind === "object" ? valuesOf(ctx, n, segment) : []));
  return current;
}

function checkRequirement(ctx: Context, owner: JsonNode, node: JsonObject, path: string, requirement: string, level: Level, feature: string, listed: Set<string>): void {
  let allGated = true;
  const from = ctx.inherited.get(node);
  for (const alternative of requirement.split("|")) {
    const segments = alternative.split(".");
    let found = resolvePath(ctx, node, segments);
    if (!found.length && from?.shared.includes(segments[0])) found = resolvePath(ctx, from.group, segments);
    if (found.length) {
      if (level === "required") for (const value of found) ctx.requiredValues.add(value);
      return;
    }
    // A nested property under an absent parent that is listed itself is reported via the parent.
    const gated = segments.length > 1 && listed.has(segments[0]) && valuesOf(ctx, node, segments[0]).length === 0;
    if (!gated) allGated = false;
  }
  if (allGated) return;

  let missing = ctx.missing.get(owner);
  if (!missing) ctx.missing.set(owner, (missing = new Map()));
  const existing = missing.get(requirement);
  if (!existing || (existing.level === "recommended" && level === "required")) {
    missing.set(requirement, { level, features: [feature], line: node.line, path, requirement });
  } else if (existing.level === level && !existing.features.includes(feature)) {
    existing.features.push(feature);
  }
}

/** Path of a missing property, or of the deepest parent all alternatives share ("author" for "author.url|author.sameAs"). */
function missingPath(base: string, alternatives: string[]): string {
  const parts = alternatives.map((a) => a.split("."));
  if (parts.length === 1) return parts[0].reduce(childPath, base);
  const shared: string[] = [];
  for (let i = 0; parts.every((p) => i < p.length - 1 && p[i] === parts[0][i]); i++) shared.push(parts[0][i]);
  return shared.reduce(childPath, base);
}

function checkShape(ctx: Context, node: JsonNode, shape: Shape, feature: string, last: boolean): void {
  // A string where an object is expected (an address as text) lacks every nested property.
  const object: JsonObject = node.kind === "object" ? node : { kind: "object", line: node.line, props: new Map() };
  const path = ctx.paths.get(node) ?? "$";
  const required = [...(shape.required ?? []), ...(last ? [] : (shape.requiredExceptLast ?? []))];
  const recommended = shape.recommended ?? [];
  const listed = new Set([...required, ...recommended].flatMap((r) => r.split("|")).filter((r) => !r.includes(".")));
  for (const r of required) checkRequirement(ctx, node, object, path, r, "required", feature, listed);
  for (const r of recommended) checkRequirement(ctx, node, object, path, r, "recommended", feature, listed);

  for (const [key, sub] of Object.entries(shape.properties ?? {})) {
    const shapes = (Array.isArray(sub) ? sub : [sub]) as readonly Shape[];
    const values = valuesOf(ctx, object, key);
    const minItems = shapes.find((s) => s.minItems)?.minItems;
    if (minItems && values.length > 0 && values.length < minItems) {
      ctx.report("list-too-short", "error", `${key} has ${values.length} item${values.length === 1 ? "" : "s"}. ${feature} needs at least ${minItems} per Google's documentation.`, object.line, childPath(path, key));
    }
    values.forEach((value, i) => {
      const types = value.kind === "object" ? (typesOf(value) ?? []) : [];
      const chosen = shapes.find((s) => s.types?.some((t) => types.includes(t))) ?? shapes.find((s) => !s.types);
      if (chosen?.ineligible) {
        ctx.report("type-ineligible", "warning", `${key} has @type ${types.join(", ")}. ${chosen.ineligible}`, value.line, ctx.paths.get(value));
      } else if (chosen) {
        checkShape(ctx, value, chosen, feature, i === values.length - 1);
      }
    });
  }
}

function checkRichResults(ctx: Context, node: JsonObject, types: string[], kind: NodeKind): string[] {
  const matched: string[] = [];
  for (const entry of RICH_RESULT_TYPES) {
    const type = entry.types.find((t) => types.includes(t));
    if (!type || ((kind === "nested" || kind === "listItem") && !entry.matchNested)) continue;
    if (entry.deprecated) {
      ctx.report("type-deprecated", "warning", `${type} no longer produces a rich result. ${entry.deprecated}`, node.line, ctx.paths.get(node));
      continue;
    }
    if (entry.appliesWhen && !valuesOf(ctx, node, entry.appliesWhen).length) continue;
    checkShape(ctx, node, entry, entry.feature, true);
    if (entry.sharedWithVariants) ctx.checkedGroups.add(node);
    if (!matched.includes(entry.feature)) matched.push(entry.feature);
  }
  return matched;
}

function childKind(kind: NodeKind, key: string): NodeKind {
  if (key === "@graph") return "root";
  // A ProductGroup's variants are products in their own right (Google's product variants docs).
  if ((kind === "root" || kind === "standalone") && (key === "mainEntity" || key === "hasVariant")) return "standalone";
  if ((kind === "root" || kind === "standalone") && key === "itemListElement") return "listItem";
  if (kind === "listItem" && key === "item") return "standalone";
  return "nested";
}

function walk(ctx: Context, node: JsonNode, kind: NodeKind): void {
  if (node.kind === "array") {
    for (const item of node.items) walk(ctx, item, kind);
    return;
  }
  if (node.kind !== "object") return;
  const path = ctx.paths.get(node) ?? "$";
  const types = typesOf(node);
  if (types === null) {
    ctx.report("type-invalid", "error", "@type must be a type name or an array of type names.", node.props.get("@type")!.line, childPath(path, "@type"));
  } else if (types.length) {
    const richResults = checkRichResults(ctx, node, types, kind);
    ctx.entities.push({ types, id: idOf(node), line: node.line, path, richResults });
  } else if (kind === "root" && !propertyOf(ctx, node, "@type") && [...node.props.keys()].some((k) => k !== "@context" && k !== "@id" && k !== "@graph")) {
    ctx.report("type-missing", "error", "This node has no @type, so search engines can't tell what it describes.", node.line, path);
  }
  for (const [key, value] of node.props) {
    if (key !== "@context") walk(ctx, value, childKind(kind, key));
  }
}

function checkRoot(ctx: Context, root: JsonNode): void {
  const nodes = root.kind === "array" ? root.items : [root];
  for (const node of nodes) {
    const path = ctx.paths.get(node) ?? "$";
    if (node.kind !== "object") {
      ctx.report("root-invalid", "error", `JSON-LD must be an object or an array of objects, not ${node.kind === "array" ? "a nested array" : `a ${node.kind}`}.`, node.line, path);
      continue;
    }
    const context = node.props.get("@context");
    if (!context) {
      ctx.report("context-missing", "error", 'No @context. Add "@context": "https://schema.org" so the types are read as schema.org.', node.line, path);
    } else if (isSchemaOrgContext(context)) {
      // The documented forms.
    } else if (isSchemaOrgContext(context, WWW_SCHEMA_ORG)) {
      // www.schema.org serves the same JSON-LD context document as schema.org (@vocab
      // http://schema.org/), so a JSON-LD processor reads the same types: a warning, not an
      // error. But schema.org's FAQ names only "https://schema.org" and "http://schema.org", and
      // Google's structured data documentation writes schema.org without www.
      ctx.report("context-invalid", "warning", `@context ${show(context)} uses www.schema.org. That host serves the same JSON-LD context, but Google's documentation and schema.org only use schema.org without www ("https://schema.org" or "http://schema.org"), so Google and other tools may not read it as schema.org. Use "https://schema.org".`, context.line, childPath(path, "@context"));
    } else {
      ctx.report("context-invalid", "error", `@context ${show(context)} isn't schema.org. Use "https://schema.org".`, context.line, childPath(path, "@context"));
    }
  }
  walk(ctx, root, "root");
}

function checkIdConflicts(ctx: Context): void {
  for (const [id, nodes] of ctx.ids) {
    const [first, ...rest] = nodes;
    for (const node of rest) {
      const keys = [...node.props].filter(([key, value]) => {
        const original = first.props.get(key);
        return key !== "@context" && original !== undefined && !sameValue(original, value);
      });
      if (!keys.length) continue;
      const names = joinList(keys.map(([key]) => `"${key}"`), "and");
      ctx.report("id-conflict", "warning", `@id "${id}" is also defined at line ${first.line} with a different ${names}. JSON-LD merges nodes that share an @id, so the merged node gets both values.`, node.line, ctx.paths.get(node));
    }
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateProblem(value: string): string | null {
  const m = ISO_DATE.exec(value);
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2} \d/.test(value)) return "separates the date and time with a space. ISO 8601 uses T, for example 2026-11-24T09:30:00+05:30";
    return "isn't an ISO 8601 date (for example 2026-11-24 or 2026-11-24T09:30:00+05:30)";
  }
  const [year, month, day, hour, minute, second, tzh, tzm] = m.slice(1).map((part) => (part === undefined ? undefined : Number(part)));
  if (month! < 1 || month! > 12 || day! < 1 || day! > daysInMonth(year!, month!)) return "is not a real calendar date";
  if (hour !== undefined && (hour > 23 || minute! > 59 || (second ?? 0) > 59)) return "has a time outside 00:00:00-23:59:59";
  if (tzh !== undefined && (tzh > 14 || (tzm ?? 0) > 59)) return "has an impossible time zone offset";
  return null;
}

function ratingProblem(key: string, node: JsonNode, owner: JsonObject): string | null {
  const bound = (name: string): number | undefined => {
    const value = owner.props.get(name);
    const n = value?.kind === "number" ? value.value : value?.kind === "string" && PLAIN_NUMBER.test(value.value.trim()) ? Number(value.value) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const text = node.kind === "string" ? node.value.trim() : node.kind === "number" ? String(node.value) : "";
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(text);
  if (percent) return Number(percent[1]) > 100 ? `${key} ${show(node)} is above 100%.` : null;
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (fraction) return Number(fraction[1]) > Number(fraction[2]) ? `${key} ${show(node)} is more than its maximum.` : null;
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    return `${key} ${show(node)} isn't a number${/^\d+,\d+$/.test(text) ? " (use a period for decimals)" : ""}.`;
  }
  const best = bound("bestRating");
  const worst = bound("worstRating");
  const n = Number(text);
  if (n <= (best ?? 5) && n >= (worst ?? 1)) return null;
  const defaults = [best === undefined ? "bestRating is 5" : "", worst === undefined ? "worstRating is 1" : ""].filter(Boolean);
  return `${key} ${n} is outside ${worst ?? 1}-${best ?? 5}${defaults.length ? ` (when omitted, ${joinList(defaults, "and")})` : ""}.`;
}

function urlProblem(key: string, value: string, base: URL | undefined): Problem | null {
  const url = value.trim();
  if (URL.canParse(url)) {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? null : { rule: "url-invalid", message: `${key} "${url}" uses ${protocol.slice(0, -1)}, but Google needs an http or https URL.` };
  }
  if (!URL.canParse(url, "https://example.invalid/")) return { rule: "url-invalid", message: `${key} "${url}" isn't a valid URL.` };
  const resolved = base ? ` It resolves to ${new URL(url, base).href}, but` : "";
  return { rule: "url-relative", warningOnly: true, message: `${key} "${url}" is relative.${resolved} Google's documentation asks for absolute URLs.` };
}

function valueProblem(format: ValueFormat, key: string, node: JsonNode, owner: JsonObject, base: URL | undefined): Problem | null {
  const text = node.kind === "string" ? node.value.trim() : null;
  switch (format) {
    case "date": {
      const problem = text === null ? "should be a date string" : dateProblem(text);
      return problem ? { rule: "date-invalid", message: `${key} ${show(node)} ${problem}.` } : null;
    }
    case "duration":
      if (text !== null && /^P\d+M$/.test(text)) {
        return { rule: "duration-invalid", warningOnly: true, message: `${key} "${text}" means ${text.slice(1, -1)} months in ISO 8601. For minutes write PT${text.slice(1)}.` };
      }
      return text !== null && ISO_DURATION.test(text) ? null : { rule: "duration-invalid", message: `${key} ${show(node)} isn't an ISO 8601 duration (for example PT1H30M).` };
    case "url":
      return text === null ? { rule: "url-invalid", message: `${key} ${show(node)} should be a URL string.` } : urlProblem(key, text, base);
    case "price":
      if (node.kind === "number" ? node.value >= 0 : text !== null && PLAIN_NUMBER.test(text)) return null;
      return {
        rule: "price-invalid",
        message: text !== null && /\p{Sc}|\b[A-Z]{3}\b/u.test(text)
          ? `${key} ${show(node)} includes a currency. Put only the number in ${key} (for example 19.99) and the currency in priceCurrency.`
          : `${key} ${show(node)} isn't a plain number. Use digits with an optional decimal point and no thousands separators, for example 1299.50.`,
      };
    case "currency":
      return text !== null && /^[A-Z]{3}$/.test(text) ? null : { rule: "currency-invalid", message: `${key} ${show(node)} isn't an ISO 4217 currency code (three capital letters, for example USD or EUR).` };
    case "integer":
      if (node.kind === "number" ? Number.isInteger(node.value) && node.value >= 0 : text !== null && /^\d+$/.test(text)) return null;
      return { rule: "integer-invalid", message: `${key} ${show(node)} should be a whole number.` };
    case "rating": {
      const message = ratingProblem(key, node, owner);
      return message ? { rule: "rating-invalid", message } : null;
    }
    default: {
      const value = text !== null && format.schemaOrg ? text.replace(SCHEMA_ORG_PREFIX, "") : text;
      if (value !== null && format.values.includes(value)) return null;
      const caseOnly = format.values.find((v) => v.toLowerCase() === value?.toLowerCase());
      if (caseOnly) return { rule: "enum-invalid", message: `${key} ${show(node)} should be written ${caseOnly}. The values are case-sensitive.` };
      return { rule: "enum-invalid", message: `${key} ${show(node)} isn't a ${format.name}. Use one of: ${format.values.join(", ")}.` };
    }
  }
}

function checkValues(ctx: Context): void {
  for (const owner of ctx.paths.keys()) {
    if (owner.kind !== "object") continue;
    for (const [key, value] of owner.props) {
      if (!Object.hasOwn(VALUE_FORMATS, key)) continue;
      for (const node of value.kind === "array" ? value.items : [value]) {
        if (node.kind === "object" || node.kind === "null") continue;
        const problem = valueProblem(VALUE_FORMATS[key], key, node, owner, ctx.base);
        if (!problem) continue;
        const severity = !problem.warningOnly && ctx.requiredValues.has(node) ? "error" : "warning";
        ctx.report(problem.rule, severity, problem.message, node.line, ctx.paths.get(node));
      }
    }
  }
}

/** Validates the JSON-LD in an HTML page, or a raw JSON-LD document. */
export function validateStructuredData(input: string, options: ValidateOptions = {}): StructuredDataResult {
  const findings: StructuredDataFinding[] = [];
  const report: Report = (rule, severity, message, line = null, path = null) => findings.push({ rule, severity, message, line, path });
  const ctx: Context = {
    report,
    base: options.url === undefined ? undefined : new URL(options.url),
    paths: new Map(),
    ids: new Map(),
    requiredValues: new Set(),
    missing: new Map(),
    inherited: new Map(),
    checkedGroups: new Set(),
    entities: [],
  };

  const { format, blocks, otherSyntax } = extractJsonLd(input);
  if (format === "html" && blocks.length === 0) {
    const note = otherSyntax ? " The page has Microdata or RDFa attributes, which schemaview doesn't check." : "";
    report("jsonld-missing", "warning", `No <script type="application/ld+json"> found.${note}`);
  }

  const roots: JsonNode[] = [];
  for (const block of blocks) {
    if (!block.text.trim()) {
      report("script-empty", "warning", "This JSON-LD script is empty.", block.scriptLine);
      continue;
    }
    const parsed = parseJson(block.text, block.line);
    if (!parsed.ok) {
      report("json-invalid", "error", `Invalid JSON: ${parsed.error} Search engines ignore the whole script.`, parsed.line);
      continue;
    }
    for (const { key, line } of parsed.duplicateKeys) {
      report("json-duplicate-key", "warning", `"${key}" appears more than once in the same object. Only the last value is used.`, line);
    }
    roots.push(parsed.value);
  }

  // All blocks are indexed first: an @id in one script can be referenced from another.
  for (const root of roots) index(ctx, root, "$");
  for (const [variant, group] of variantGroups(ctx)) {
    const types = typesOf(group) ?? [];
    const shared = RICH_RESULT_TYPES.find((e) => e.sharedWithVariants && e.types.some((t) => types.includes(t)))?.sharedWithVariants;
    if (shared) ctx.inherited.set(variant, { group, shared });
  }
  for (const root of roots) checkRoot(ctx, root);
  for (const [owner, byRequirement] of ctx.missing) for (const m of byRequirement.values()) {
    const alternatives = m.requirement.split("|");
    // A recommended property that variants may take from their group is recommended on the
    // checked group as well, so it is reported there once instead of on every variant too.
    const from = ctx.inherited.get(owner);
    if (m.level === "recommended" && from && ctx.checkedGroups.has(from.group) && alternatives.every((a) => from.shared.includes(a.split(".")[0]))) continue;
    const what = alternatives.length === 1 ? `"${m.requirement}"` : `one of ${joinList(alternatives.map((a) => `"${a}"`), "or")}`;
    const path = missingPath(m.path, alternatives);
    const required = m.level === "required";
    report(required ? "property-required" : "property-recommended", required ? "error" : "warning", `Missing ${what}, ${m.level} for ${joinList(m.features, "and")} per Google's documentation.`, m.line, path);
  }
  checkIdConflicts(ctx);
  checkValues(ctx);

  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const errorCount = findings.filter((f) => f.severity === "error").length;
  return { valid: errorCount === 0, format, blockCount: blocks.length, entities: ctx.entities, findings, errorCount, warningCount: findings.length - errorCount };
}
