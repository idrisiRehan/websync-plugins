// The rule engine. It reads the feed into items (read.ts), then applies one target's
// requirement table (google.ts or openai.ts) with the shared value checks (values.ts). One pass
// over the items, with maps for duplicates, so large feeds lint in linear time. Pure and
// offline: nothing is fetched, and no URL in the feed is visited.

import { GOOGLE } from "./google.ts";
import { OPENAI } from "./openai.ts";
import { detectFormat, read, type ReadResult } from "./read.ts";
import type { AttributeSpec, FeedFormat, Field, Item, Report, RuleId, Severity, Target, TargetName } from "./spec.ts";
import { charLength, checkField, enumMatches, listEntries } from "./values.ts";

export interface LintOptions {
  /** Whose requirements to check. Default "google". */
  target?: TargetName;
  /** Skip detection and read the feed as this format. It must be one the target accepts. */
  format?: FeedFormat;
}

export interface FeedFinding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** Spreadsheet row for TSV and CSV (the header is row 1), source line for XML and JSONL. */
  line: number | null;
  itemId: string | null;
  attribute: string | null;
}

export interface ProductFeedResult {
  /** True when there are no errors. */
  valid: boolean;
  target: TargetName;
  /** The format read, or null when the feed is empty. */
  format: FeedFormat | null;
  itemCount: number;
  errorCount: number;
  warningCount: number;
  /** Sorted by line. */
  findings: FeedFinding[];
}

export const TARGETS: Readonly<Record<TargetName, Target>> = { google: GOOGLE, openai: OPENAI };
const FORMAT_NAMES: Record<FeedFormat, string> = { tsv: "tab-separated text", csv: "comma-separated text", xml: "XML", jsonl: "JSONL" };

interface Compiled {
  target: Target;
  specs: Map<string, AttributeSpec>;
  /** Alias name to the name it stands for. */
  aliases: Map<string, string>;
  required: AttributeSpec[];
  /** Maps an attribute name as written to the name the target uses. */
  normalize(name: string): string;
  /** True when a normalized name is an attribute of the target or an alias of one. */
  isKnown(name: string): boolean;
  conditional: AttributeSpec[];
  unique: AttributeSpec[];
}

const compiled = new Map<TargetName, Compiled>();

function compile(target: Target): Compiled {
  let c = compiled.get(target.name);
  if (!c) {
    const specs = new Map(target.attributes.map((a) => [a.name, a]));
    const aliases = new Map(target.attributes.flatMap((a) => (a.aliases ?? []).map((alias) => [alias, a.name] as const)));
    const list = target.attributes;
    const normalize = target.strict ? (name: string) => name.trim() : (name: string) => name.trim().toLowerCase().replace(/ +/g, "_");
    const isKnown = (name: string) => specs.has(name) || aliases.has(name);
    c = { target, specs, aliases, normalize, isKnown, required: list.filter((a) => a.required), conditional: list.filter((a) => a.requiredWhen), unique: list.filter((a) => a.unique) };
    compiled.set(target.name, c);
  }
  return c;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** The attribute a misspelt name most likely meant, if one is close. */
function suggest(name: string, known: Iterable<string>): string | null {
  const key = name.toLowerCase().replace(/[\s-]+/g, "_");
  if (key.length > 40) return null;
  let best: string | null = null;
  let bestDistance = key.length <= 5 ? 1 : 2;
  for (const candidate of known) {
    const distance = candidate.toLowerCase() === key ? 0 : levenshtein(key, candidate.toLowerCase());
    if (distance <= bestDistance && (best === null || distance < bestDistance)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function checkOptions(options: LintOptions): { target: Target; format: FeedFormat | undefined } {
  if (options === null || typeof options !== "object") throw new TypeError("options must be an object.");
  const { target = "google", format } = options;
  if (typeof target !== "string" || !Object.hasOwn(TARGETS, target)) throw new TypeError(`options.target must be one of: ${Object.keys(TARGETS).join(", ")}.`);
  const spec = TARGETS[target];
  if (format !== undefined && !spec.formats.includes(format)) {
    throw new TypeError(`options.format must be one of: ${spec.formats.join(", ")} (the formats ${spec.label} accepts).`);
  }
  return { target: spec, format };
}

/** One product as read from the feed, before any value is checked. */
export interface FeedItem {
  /** The item's id (google) or item_id (openai), or null. */
  id: string | null;
  /** Spreadsheet row for TSV and CSV (the header is row 1), source line for XML and JSONL. */
  line: number;
  /**
   * Trimmed values by attribute name, with aliases resolved to the name the target documents
   * (item_group_id is group_id for openai). Repeated elements or columns add values; empty
   * values are left out. A null-prototype object, so any attribute name is safe to look up.
   */
  attributes: Record<string, string[]>;
}

export interface FeedItemsResult {
  target: TargetName;
  /** The format read, or null when the feed is empty. */
  format: FeedFormat | null;
  items: FeedItem[];
  /**
   * What reading reported: an empty or unreadable feed, a format or delimiter the target doesn't
   * take, broken quoting, row widths, aliases. Value checks are lintProductFeed()'s job.
   */
  findings: FeedFinding[];
}

interface FeedRead {
  format: FeedFormat | null;
  header: ReadResult["header"];
  atom: boolean;
  items: Item[];
}

/** Detects or checks the format, reads the items and resolves aliases. Shared by lintProductFeed() and readFeedItems(). */
function readFeed(text: string, target: Target, forced: FeedFormat | undefined, report: Report): FeedRead {
  const c = compile(target);
  const none = (format: FeedFormat | null): FeedRead => ({ format, header: null, atom: false, items: [] });
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const detected = detectFormat(body);
  if (detected === null) {
    report("feed-empty", "error", "The feed is empty.", { line: null });
    return none(forced ?? null);
  }
  const format = forced ?? detected;
  const delimited = (f: FeedFormat) => f === "tsv" || f === "csv";
  if (delimited(format) && delimited(detected) && format !== detected) {
    report("delimiter-wrong", "error", `The header row is separated by ${detected === "csv" ? "commas" : "tabs"}, not ${format === "tsv" ? "tabs" : "commas"}. Export it as ${FORMAT_NAMES[format]}.`, { line: 1 });
    return none(format);
  }
  if (!target.formats.includes(format)) {
    if (format === "csv" && target.formats.includes("tsv")) {
      report("delimiter-wrong", "error", `The header row is separated by commas. ${target.label} reads tab-separated text: in a spreadsheet, save as "Text (tab delimited)" or download as TSV.`, { line: 1 });
    } else {
      report("format-unsupported", "error", `This looks like ${FORMAT_NAMES[format]}, which ${target.label} doesn't accept. Use ${target.formats.map((f) => FORMAT_NAMES[f]).join(", ")}.`, { line: 1 });
    }
    return none(format);
  }

  const { items: rawItems, header, atom } = read(body, format, { report, normalize: c.normalize, isKnown: c.isKnown, repeatedColumns: target.repeatedColumns });
  const reported = new Set<string>();
  const items = rawItems.map((raw): Item => {
    const fields = new Map<string, Field[]>();
    const add = (name: string, field: Field) => {
      const list = fields.get(name);
      if (list) list.push(field);
      else fields.set(name, [field]);
    };
    // Canonical names first, so an alias is used only when its canonical name is absent.
    for (const f of raw.fields) {
      if (!c.aliases.has(f.name)) add(f.name, f);
    }
    const viaAlias = new Map<string, string>();
    for (const f of raw.fields) {
      const canonical = c.aliases.get(f.name);
      if (canonical === undefined) continue;
      const existing = fields.has(canonical) ? (viaAlias.get(canonical) ?? canonical) : f.name;
      if (existing !== f.name) {
        const wins = existing === canonical && c.specs.get(canonical)?.aliasWins === true;
        const key = `${existing} ${f.name}`;
        if (!reported.has(key)) {
          reported.add(key);
          report("attribute-alias", "warning", `${f.name} and ${existing} both set ${canonical}. Send only one name per value; ${wins ? f.name : existing} is the one used and checked. Reported once.`, { line: f.line, attribute: f.name });
        }
        if (!wins) continue;
        fields.delete(canonical);
      }
      viaAlias.set(canonical, f.name);
      add(canonical, f);
    }
    return { line: raw.line, fields, id: fields.get(target.idAttribute)?.[0]?.value || null };
  });
  return { format, header, atom, items };
}

function finding(rule: RuleId, severity: Severity, message: string, at: { line: number | null; itemId?: string | null; attribute?: string | null }): FeedFinding {
  return { rule, severity, message, line: at.line, itemId: at.itemId ?? null, attribute: at.attribute ?? null };
}

/**
 * Reads a feed into items with their attributes, the way lintProductFeed() reads it (same
 * readers, format rules and aliases), for tools that need the values rather than the checks.
 * Never throws on bad feed text. Throws a TypeError for invalid options, like lintProductFeed().
 */
export function readFeedItems(text: string, options: LintOptions = {}): FeedItemsResult {
  const { target, format: forced } = checkOptions(options);
  if (typeof text !== "string") throw new TypeError("text must be a string.");
  const findings: FeedFinding[] = [];
  const { format, items } = readFeed(text, target, forced, (...args) => findings.push(finding(...args)));
  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return {
    target: target.name,
    format,
    items: items.map((item) => {
      const attributes: Record<string, string[]> = Object.create(null);
      for (const [name, fields] of item.fields) attributes[name] = fields.map((f) => f.value);
      return { id: item.id, line: item.line, attributes };
    }),
    findings,
  };
}

/**
 * Lints a product feed against Google Merchant Center's or OpenAI's product feed spec. Never
 * throws on bad feed text: problems become findings. Throws a TypeError for invalid options.
 */
export function lintProductFeed(text: string, options: LintOptions = {}): ProductFeedResult {
  const { target, format: forced } = checkOptions(options);
  if (typeof text !== "string") throw new TypeError("text must be a string.");
  const c = compile(target);
  const findings: FeedFinding[] = [];
  const report: Report = (...args) => findings.push(finding(...args));
  const { format, header, atom, items } = readFeed(text, target, forced, report);
  const where = format === "tsv" || format === "csv" ? "row" : "line";

  const missingColumns = new Set<string>();
  const unknown = new Map<string, { line: number; count: number }>();
  // Collects names that aren't current attributes (unknown or retired), reported once each.
  const noteName = (name: string, line: number) => {
    if ((c.isKnown(name) && !c.specs.get(name)?.retired) || (atom && name === "updated")) return;
    const seen = unknown.get(name);
    if (seen) seen.count++;
    else unknown.set(name, { line, count: 1 });
  };

  if (header) {
    for (const name of header.names) noteName(name, header.line);
    const columns = new Set(header.names.map((n) => c.aliases.get(n) ?? n));
    for (const spec of c.required) {
      if (columns.has(spec.name) || spec.satisfiedBy?.some((name) => columns.has(name))) continue;
      missingColumns.add(spec.name);
      report("attribute-missing", spec.missingSeverity ?? "error", `The header has no ${spec.name} column. ${spec.requiredNote ?? `${spec.name} is required for every product.`}`, { line: header.line, attribute: spec.name });
    }
  } else {
    // Aliases are known names, so the resolved fields hold every name worth noting.
    for (const item of items) for (const [name, fields] of item.fields) for (const f of fields) noteName(name, f.line);
  }

  if (items.length === 0 && !findings.some((f) => f.severity === "error")) {
    report("feed-empty", "error", header ? "The feed has a header row but no products." : "The feed has no products.", { line: header?.line ?? null });
  }

  const firstSeen = new Map<string, Map<string, Item>>(c.unique.map((s) => [s.name, new Map()]));
  const firstSeenLower = new Map<string, Item>();
  for (const item of items) {
    checkPresence(item);
    for (const [name, fields] of item.fields) {
      const spec = c.specs.get(name);
      if (spec && !spec.retired) for (const field of fields) checkValue(item, spec, field);
      if (spec?.maxValues !== undefined) {
        const count = fields.reduce((n, f) => n + listEntries(f).length, 0);
        if (count > spec.maxValues) report("values-too-many", "warning", `${name} has ${count} values; the limit is ${spec.maxValues}.`, { line: fields[0].line, itemId: item.id, attribute: name });
      }
    }
    for (const spec of c.unique) checkUnique(item, spec);
    target.checkItem(item, report);
  }

  for (const [name, { line, count }] of unknown) {
    const spec = c.specs.get(name);
    if (spec?.retired) {
      report("attribute-retired", "warning", `${name}: ${spec.retired}`, { line, attribute: name });
      continue;
    }
    const guess = suggest(name, c.specs.keys());
    const times = header ? "" : ` Found in ${count} item${count === 1 ? "" : "s"}.`;
    report("attribute-unknown", "warning", `"${name}" isn't an attribute in the ${target.label} spec, so it is probably ignored.${guess ? ` Did you mean ${guess}?` : ""}${times}`, { line, attribute: name });
  }
  target.checkFeed(items, report);

  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  let errorCount = 0;
  for (const f of findings) if (f.severity === "error") errorCount++;
  return { valid: errorCount === 0, target: target.name, format, itemCount: items.length, errorCount, warningCount: findings.length - errorCount, findings };

  function checkPresence(item: Item): void {
    if (atom && !item.fields.has("updated")) {
      report("attribute-missing", "error", "The entry has no <updated> element. Google's Atom 1.0 format requires title, id, link, summary and updated in every entry.", { line: item.line, itemId: item.id, attribute: "updated" });
    }
    for (const spec of c.required) {
      if (missingColumns.has(spec.name) || item.fields.has(spec.name) || spec.satisfiedBy?.some((name) => item.fields.has(name))) continue;
      report("attribute-missing", spec.missingSeverity ?? "error", `${spec.name} is missing or empty. ${spec.requiredNote ?? "It is required for every product."}`, { line: item.line, itemId: item.id, attribute: spec.name });
    }
    for (const spec of c.conditional) {
      if (item.fields.has(spec.name)) continue;
      const applies = spec.requiredWhen!.some((cond) => {
        const value = item.fields.get(cond.attribute)?.[0]?.value;
        return value !== undefined && (cond.values === undefined || enumMatches(value, cond.values, target.strict));
      });
      if (applies) report("attribute-missing", "error", `${spec.name} is missing. ${spec.requiredNote ?? ""}`.trim(), { line: item.line, itemId: item.id, attribute: spec.name });
    }
  }

  function checkValue(item: Item, spec: AttributeSpec, field: Field): void {
    const at = { line: field.line, itemId: item.id, attribute: spec.name };
    const severity = spec.severity ?? "error";
    const { placeholders } = target;
    const lower = field.value.toLowerCase();
    if ((!placeholders.attributes || placeholders.attributes.includes(spec.name)) && placeholders.values.includes(lower) && !(spec.values && enumMatches(field.value, spec.values, target.strict))) {
      report("value-placeholder", "warning", `"${field.value}" is a placeholder, not a value. Submit the real ${spec.name}${spec.required ? "" : ", or leave it out if there is none"}.`, at);
      return;
    }
    if (spec.maxLength !== undefined) {
      const values = spec.type === "url-list" || spec.type === "gtin" ? listEntries(field) : [field.value];
      for (const value of values) {
        const length = value.length > spec.maxLength ? charLength(value) : 0;
        if (length > spec.maxLength) report("value-too-long", severity, `${spec.name} is ${length} characters; the limit is ${spec.maxLength}.`, at);
      }
    }
    for (const problem of checkField(field, spec, target.strict)) report(problem.rule, problem.severity ?? severity, `${spec.name}: ${problem.message}`, at);
  }

  function checkUnique(item: Item, spec: AttributeSpec): void {
    const value = item.fields.get(spec.name)?.[0]?.value;
    if (!value) return;
    const seen = firstSeen.get(spec.name)!;
    const first = seen.get(value);
    const at = { line: item.line, itemId: item.id, attribute: spec.name };
    if (first) {
      report("id-duplicate", "error", `Duplicate ${spec.name} "${value}", first used on ${where} ${first.line}. Each product needs its own ${spec.name}.`, at);
      return;
    }
    seen.set(value, item);
    if (!spec.uniqueIgnoringCase) return;
    const key = `${spec.name} ${value.toLowerCase()}`;
    const twin = firstSeenLower.get(key);
    if (twin) {
      report("id-duplicate-case", "warning", `${spec.name} "${value}" differs only in letter case from "${twin.fields.get(spec.name)![0].value}" on ${where} ${twin.line}, so the two may be treated as the same product.`, at);
    } else firstSeenLower.set(key, item);
  }
}
