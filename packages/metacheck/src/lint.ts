// SEO and sharing metadata rules for one HTML page. Pure and offline: it reads the HTML it is
// given and never fetches anything, including the URLs the page points to.

import { tokenizeHtml } from "./html.ts";
import { collapseWhitespace, scanPage, type Heading, type ScannedElement, type ScannedPage } from "./scan.ts";

/**
 * Length guidance in characters, matching the WebSync SEO Analyzer. Search engines truncate
 * by pixel width, not characters, so these are approximations.
 */
export const TITLE_MIN_LENGTH = 30;
export const TITLE_MAX_LENGTH = 60;
export const DESCRIPTION_MIN_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 160;
/** The charset declaration must be serialized completely within this many bytes. */
export const CHARSET_SCAN_BYTES = 1024;
/** Required Open Graph properties (https://ogp.me/#metadata). */
export const OG_REQUIRED = ["og:title", "og:type", "og:image", "og:url"] as const;
/** Allowed twitter:card values. */
export const TWITTER_CARD_TYPES = ["summary", "summary_large_image", "app", "player"] as const;

export type Severity = "error" | "warning";

export type RuleId =
  | "doctype-missing" // https://html.spec.whatwg.org/multipage/syntax.html#the-doctype
  | "doctype-legacy" // https://html.spec.whatwg.org/multipage/syntax.html#the-doctype
  | "lang-missing" // https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes
  | "lang-invalid" // https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes (BCP 47)
  | "charset-missing" // https://html.spec.whatwg.org/multipage/semantics.html#character-encoding-declaration
  | "charset-not-utf8" // https://html.spec.whatwg.org/multipage/semantics.html#character-encoding-declaration
  | "charset-late" // https://html.spec.whatwg.org/multipage/semantics.html#character-encoding-declaration
  | "viewport-missing" // https://drafts.csswg.org/css-viewport/#viewport-meta
  | "title-missing" // https://html.spec.whatwg.org/multipage/semantics.html#the-title-element
  | "title-empty" // https://developers.google.com/search/docs/appearance/title-link
  | "title-multiple" // https://html.spec.whatwg.org/multipage/semantics.html#the-head-element
  | "title-too-short" // https://developers.google.com/search/docs/appearance/title-link
  | "title-too-long" // https://developers.google.com/search/docs/appearance/title-link
  | "description-missing" // https://developers.google.com/search/docs/appearance/snippet#meta-descriptions
  | "description-empty" // https://developers.google.com/search/docs/appearance/snippet#meta-descriptions
  | "description-multiple" // https://html.spec.whatwg.org/multipage/semantics.html#meta-description
  | "description-too-short" // https://developers.google.com/search/docs/appearance/snippet#meta-descriptions
  | "description-too-long" // https://developers.google.com/search/docs/appearance/snippet#meta-descriptions
  | "canonical-missing" // https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
  | "canonical-multiple" // https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
  | "canonical-invalid" // https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
  | "canonical-relative" // https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
  | "canonical-outside-head" // https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
  | "og-url-mismatch" // https://ogp.me/#metadata (og:url is the canonical URL)
  | "robots-noindex" // https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
  | "robots-directive-unknown" // https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
  | "robots-googlebot" // https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
  | "og-missing" // https://ogp.me/#metadata
  | "og-image-invalid" // https://ogp.me/#metadata
  | "og-url-invalid" // https://ogp.me/#metadata
  | "twitter-card-invalid" // https://developer.x.com/en/docs/x-for-websites/cards/overview/markup
  | "h1-missing" // https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines
  | "h1-multiple" // https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines
  | "heading-skipped" // https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines
  | "hreflang-invalid" // https://developers.google.com/search/docs/specialty/international/localized-versions
  | "hreflang-href-invalid" // https://developers.google.com/search/docs/specialty/international/localized-versions
  | "hreflang-duplicate" // https://developers.google.com/search/docs/specialty/international/localized-versions
  | "hreflang-x-default-missing" // https://developers.google.com/search/docs/specialty/international/localized-versions
  | "hreflang-self-missing" // https://developers.google.com/search/docs/specialty/international/localized-versions
  | "metadata-in-body" // https://developers.google.com/search/docs/crawling-indexing/valid-page-metadata
  | "meta-duplicate"; // https://html.spec.whatwg.org/multipage/semantics.html#standard-metadata-names

export interface MetadataFinding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** 1-based line in the HTML, when the finding belongs to one place. */
  line: number | null;
}

export type { Heading };

export interface HreflangAlternate {
  hreflang: string;
  /** Resolved against the page URL when it was relative and one is known. */
  href: string;
  line: number;
}

export interface PageMetadata {
  /** The first <title>, whitespace collapsed. */
  title: string | null;
  /** The first meta description, whitespace collapsed. */
  description: string | null;
  /** The first canonical URL, resolved when possible. */
  canonical: string | null;
  /** Directives per robots meta name ("robots", "googlebot", ...), lowercase. */
  robots: Record<string, string[]>;
  lang: string | null;
  charset: string | null;
  viewport: string | null;
  /** First value of each Open Graph property (og:*, article:*, ...). */
  openGraph: Record<string, string>;
  /** First value of each twitter:* property. */
  twitter: Record<string, string>;
  hreflang: HreflangAlternate[];
  headings: Heading[];
}

export interface MetadataResult {
  /** True when there are no errors. Warnings don't make a page invalid. */
  valid: boolean;
  errorCount: number;
  warningCount: number;
  findings: MetadataFinding[];
  metadata: PageMetadata;
}

export interface LintOptions {
  /** The page's own absolute http(s) URL, used to resolve relative URLs. */
  url?: string;
}

type Report = (rule: RuleId, severity: Severity, message: string, line?: number | null) => void;

const SPACES = /[\t\n\f\r ]+/;
const OG_KEY = /^(?:og|article|book|profile|music|video|fb):/;
const TWITTER_KEY = /^twitter:/;
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;
// BCP 47-like: a 2-3 letter primary language, then subtags; or private use (x-...).
const LANG_TAG = /^(?:[a-z]{2,3}(?:-[a-z\d]{1,8})*|x(?:-[a-z\d]{1,8})+)$/i;
// Google's hreflang format: ISO 639-1 language, optional ISO 15924 script, optional ISO 3166-1
// alpha-2 region. Google says other codes, such as es-419 or three-letter languages, aren't supported.
const HREFLANG_CODE = /^[a-z]{2}(?:-[a-z]{4})?(?:-[a-z]{2})?$/i;
// ISO 3166-1 codes reserved for something other than a region, which Google ignores.
const RESERVED_REGION = /-(uk|eu|un)$/i;
const LEGACY_COMPAT_DOCTYPE = /^html(?:\s+system\s+(["'])about:legacy-compat\1)?$/i;
const CHARSET_IN_CONTENT_TYPE = /charset\s*=\s*["']?([^\s;"']+)/i;
const UTF8_LABELS = new Set(["utf-8", "utf8"]);
// Link types allowed in <body> (https://html.spec.whatwg.org/multipage/links.html#body-ok).
const BODY_OK_LINK_TYPES = new Set(["dns-prefetch", "modulepreload", "pingback", "preconnect", "prefetch", "preload", "stylesheet"]);
// Meta names that legitimately repeat: theme-color per media query, one verification token per owner.
const REPEATABLE_META = new Set(["theme-color", "google-site-verification"]);
const ROBOTS_NAMES = new Set(["robots", "googlebot", "googlebot-news", "bingbot"]);
const GOOGLE_ROBOTS_NAMES = new Set(["googlebot", "googlebot-news"]);
const ROBOTS_FLAGS = new Set(["all", "index", "follow", "noindex", "nofollow", "none", "noarchive", "nocache", "nosnippet", "indexifembedded", "notranslate", "noimageindex"]);
const isPreviewLimit = (value: string): boolean => /^(?:-1|\d+)$/.test(value);
const ROBOTS_VALUES: Record<string, (value: string) => boolean> = {
  "max-snippet": isPreviewLimit,
  "max-video-preview": isPreviewLimit,
  "max-image-preview": (value) => ["none", "standard", "large"].includes(value),
  "unavailable_after": (value) => value !== "",
};

const characters = (text: string): number => [...text].length;
const attr = (el: ScannedElement, name: string): string => el.attrs[name]?.trim() ?? "";
const metaName = (el: ScannedElement): string => attr(el, "name").toLowerCase();
const relTypes = (el: ScannedElement): string[] => attr(el, "rel").toLowerCase().split(SPACES).filter(Boolean);

type Href = { kind: "absolute" | "relative"; url: URL | null } | { kind: "invalid"; url: null };

/** Classifies a URL attribute value. Relative URLs are resolved against base when there is one. */
function classifyUrl(value: string, base: URL | null): Href {
  if (!value) return { kind: "invalid", url: null };
  if (URL.canParse(value)) {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? { kind: "absolute", url } : { kind: "invalid", url: null };
  }
  if (HAS_SCHEME.test(value)) return { kind: "invalid", url: null };
  return { kind: "relative", url: base && URL.canParse(value, base.href) ? new URL(value, base) : null };
}

function utf8Prefix(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes > maxBytes) break;
    end += ch.length;
  }
  return text.slice(0, end);
}

function charsetOf(attrs: Record<string, string>): string | null {
  if (attrs.charset !== undefined) return attrs.charset.trim();
  if (attrs["http-equiv"]?.trim().toLowerCase() !== "content-type") return null;
  return CHARSET_IN_CONTENT_TYPE.exec(attrs.content ?? "")?.[1] ?? null;
}

function describe(el: ScannedElement): string {
  if (el.tag === "meta") {
    const key = ["name", "property", "http-equiv", "charset"].find((name) => el.attrs[name] !== undefined);
    return key ? `<meta ${key}="${el.attrs[key]}">` : "<meta>";
  }
  if (el.tag === "link") return `<link rel="${attr(el, "rel")}">`;
  return `<${el.tag}>`;
}

/** First value and line of each meta whose property or name matches the pattern. */
function propertyMap(metas: ScannedElement[], pattern: RegExp): Map<string, { value: string; line: number }> {
  const map = new Map<string, { value: string; line: number }>();
  for (const meta of metas) {
    // Some pages put name and property on one tag, so both count.
    for (const key of [attr(meta, "property").toLowerCase(), metaName(meta)]) {
      if (pattern.test(key) && !map.has(key)) map.set(key, { value: attr(meta, "content"), line: meta.line });
    }
  }
  return map;
}

function checkDocument(page: ScannedPage, html: string, report: Report): Pick<PageMetadata, "lang" | "charset" | "viewport"> {
  if (!page.doctype) {
    report("doctype-missing", "warning", "No <!DOCTYPE html> before the first element. Without it, browsers render the page in quirks mode.");
  } else if (!LEGACY_COMPAT_DOCTYPE.test(page.doctype.value.trim())) {
    report("doctype-legacy", "warning", `<!DOCTYPE ${page.doctype.value}> is a legacy doctype that can trigger quirks or limited-quirks mode. Use <!DOCTYPE html>.`, page.doctype.line);
  }

  const lang = page.html ? attr(page.html, "lang") : "";
  if (!lang) {
    report("lang-missing", "warning", '<html> has no lang attribute. Declare the page language, for example <html lang="en">.', page.html?.line ?? null);
  } else if (!LANG_TAG.test(lang)) {
    report("lang-invalid", "warning", `lang="${lang}" is not a BCP 47 language tag (for example en, en-US or pt-BR).`, page.html!.line);
  }

  const declaration = page.metas.find((meta) => charsetOf(meta.attrs) !== null);
  const charset = declaration ? charsetOf(declaration.attrs) : null;
  if (!declaration) {
    // A byte order mark determines the encoding on its own.
    if (!html.startsWith("\uFEFF")) {
      report("charset-missing", "warning", 'No character encoding declaration. Add <meta charset="utf-8"> at the top of <head>, unless the server sends it in Content-Type.');
    }
  } else {
    if (!UTF8_LABELS.has(charset!.toLowerCase())) {
      report("charset-not-utf8", "warning", `The page declares charset "${charset}". HTML requires UTF-8.`, declaration.line);
    }
    const early = tokenizeHtml(utf8Prefix(html, CHARSET_SCAN_BYTES)).some((t) => t.type === "start" && t.tag === "meta" && charsetOf(t.attrs) !== null);
    if (!early) {
      report("charset-late", "warning", `The charset declaration is not within the first ${CHARSET_SCAN_BYTES} bytes, so browsers may not see it before they start decoding. Move it to the top of <head>.`, declaration.line);
    }
  }

  const viewport = page.metas.find((meta) => metaName(meta) === "viewport");
  if (!viewport) {
    report("viewport-missing", "warning", 'No viewport meta tag, so mobile browsers render a zoomed-out desktop layout. Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  }

  return { lang: lang || null, charset, viewport: viewport ? attr(viewport, "content") : null };
}

/** Shared checks for the title and the meta description, which differ only in their wording. */
function checkText(
  kind: "title" | "description",
  items: { text: string; line: number }[],
  min: number,
  max: number,
  severity: Severity,
  report: Report,
): string | null {
  const label = kind === "title" ? "<title>" : '<meta name="description">';
  const noun = kind === "title" ? "title" : "description";
  if (items.length === 0) {
    report(`${kind}-missing`, severity, kind === "title" ? "The page has no <title>. Search engines and browser tabs need one." : "The page has no meta description. Search engines will build the snippet from page text instead.");
    return null;
  }
  const [first, second] = items;
  const text = collapseWhitespace(first.text);
  if (!text) {
    report(`${kind}-empty`, severity, `${label} is empty.`, first.line);
  } else {
    const length = characters(text);
    const approx = `search engines truncate by pixel width, so the character count is approximate`;
    if (length < min) report(`${kind}-too-short`, "warning", `The ${noun} is ${length} characters. Aim for ${min}-${max}; ${approx}.`, first.line);
    else if (length > max) report(`${kind}-too-long`, "warning", `The ${noun} is ${length} characters and may be cut off. Aim for ${min}-${max}; ${approx}.`, first.line);
  }
  if (second) {
    report(`${kind}-multiple`, "warning", `There are ${items.length} ${label} elements. Only one is allowed, and the first (line ${first.line}) is the one used.`, second.line);
  }
  return text || null;
}

function checkCanonical(page: ScannedPage, base: URL | null, report: Report): URL | string | null {
  const canonicals = page.links.filter((link) => relTypes(link).includes("canonical"));
  if (canonicals.length === 0) {
    report("canonical-missing", "warning", 'No <link rel="canonical">. Search engines pick a canonical URL themselves when duplicate URLs serve this page.');
    return null;
  }
  const targets = new Map<string, number>();
  let first: URL | string | null | undefined;
  for (const link of canonicals) {
    const href = attr(link, "href");
    if (!link.inHead) {
      report("canonical-outside-head", "error", `<link rel="canonical"> is outside <head>${headEnd(page)}. Google ignores a canonical that isn't in the head.`, link.line);
    }
    const target = classifyUrl(href, base);
    if (target.kind === "invalid") {
      report("canonical-invalid", "error", href ? `The canonical "${href}" is not a valid http(s) URL.` : "The canonical link has no href.", link.line);
    } else if (target.kind === "relative") {
      report("canonical-relative", "warning", `The canonical "${href}" is relative. Google recommends an absolute URL, which can't be misread on another host or protocol.`, link.line);
    }
    first ??= target.url ?? (href || null);
    const key = target.url?.href ?? href;
    if (targets.size > 0 && !targets.has(key)) {
      const [firstKey, firstLine] = [...targets][0];
      report("canonical-multiple", "error", `Conflicting canonicals: "${href}" here and "${firstKey}" on line ${firstLine}. Google ignores all of them when they disagree.`, link.line);
    }
    if (!targets.has(key)) targets.set(key, link.line);
  }
  return first ?? null;
}

function headEnd(page: ScannedPage): string {
  return page.headClosedBy ? ` (the head ended at ${page.headClosedBy.what} on line ${page.headClosedBy.line})` : "";
}

function parseRobots(content: string): string[] {
  const directives: string[] = [];
  for (const raw of content.toLowerCase().split(",")) {
    const part = raw.trim();
    if (!part) continue;
    // RFC 850 dates in unavailable_after contain a comma: rejoin what follows it.
    const previous = directives.at(-1);
    const name = part.split(":")[0].trim();
    if (previous?.startsWith("unavailable_after") && !ROBOTS_FLAGS.has(name) && !(name in ROBOTS_VALUES)) {
      directives[directives.length - 1] = `${previous}, ${part}`;
    } else {
      directives.push(part);
    }
  }
  return directives;
}

/** Why a robots directive is not understood, or null when it is. */
function robotsDirectiveProblem(directive: string): string | null {
  const colon = directive.indexOf(":");
  if (colon === -1) return ROBOTS_FLAGS.has(directive) ? null : "is not a known directive";
  const name = directive.slice(0, colon).trim();
  const validate = Object.hasOwn(ROBOTS_VALUES, name) ? ROBOTS_VALUES[name] : undefined;
  if (!validate) return "is not a known directive";
  return validate(directive.slice(colon + 1).trim()) ? null : "has an invalid value";
}

function checkRobots(page: ScannedPage, report: Report): Record<string, string[]> {
  // Keys come from ROBOTS_NAMES only, so a plain object is safe.
  const robots: Record<string, string[]> = {};
  const metas = page.metas.filter((meta) => ROBOTS_NAMES.has(metaName(meta)));
  for (const meta of metas) {
    const name = metaName(meta);
    const directives = parseRobots(attr(meta, "content"));
    (robots[name] ??= []).push(...directives);
    for (const directive of directives) {
      const problem = robotsDirectiveProblem(directive);
      if (problem) report("robots-directive-unknown", "warning", `Robots directive "${directive}" ${problem}, so crawlers ignore it.`, meta.line);
    }
    const blocking = directives.find((d) => d === "noindex" || d === "none");
    if (blocking) {
      const who = name === "robots" ? "all search engines" : name;
      report("robots-noindex", "warning", `<meta name="${name}"> says "${blocking}": ${who} will drop this page from search results. Remove it if the page should be found.`, meta.line);
    }
  }

  // Google applies the most restrictive combination of robots and googlebot, so a googlebot
  // tag can add restrictions but never lift them.
  const restrictive = (robots.robots ?? []).filter((d) => d === "noindex" || d === "nofollow" || d === "none");
  if (restrictive.length) {
    for (const meta of metas) {
      if (!GOOGLE_ROBOTS_NAMES.has(metaName(meta))) continue;
      const permissive = parseRobots(attr(meta, "content")).filter((d) => d === "index" || d === "follow" || d === "all");
      if (permissive.length) {
        report("robots-googlebot", "warning", `<meta name="${metaName(meta)}"> says "${permissive.join(", ")}", but it can't override robots "${restrictive.join(", ")}": Google applies the most restrictive combination.`, meta.line);
      }
    }
  }
  return robots;
}

function checkSocial(page: ScannedPage, canonical: URL | string | null, report: Report): Pick<PageMetadata, "openGraph" | "twitter"> {
  const og = propertyMap(page.metas, OG_KEY);
  const missing = OG_REQUIRED.filter((key) => !og.get(key)?.value);
  if (missing.length === OG_REQUIRED.length) {
    report("og-missing", "warning", `No Open Graph tags (${OG_REQUIRED.join(", ")}), so each platform guesses the link preview.`);
  } else if (missing.length) {
    report("og-missing", "warning", `Missing required Open Graph ${missing.length === 1 ? "property" : "properties"}: ${missing.join(", ")}.`);
  }
  for (const [key, rule] of [["og:image", "og-image-invalid"], ["og:url", "og-url-invalid"]] as const) {
    const entry = og.get(key);
    if (entry?.value && classifyUrl(entry.value, null).kind !== "absolute") {
      report(rule, "error", `${key} "${entry.value}" must be an absolute http(s) URL. Platforms fetch it as is and won't resolve a relative path.`, entry.line);
    }
  }
  const ogUrl = og.get("og:url");
  if (ogUrl?.value && canonical instanceof URL) {
    const target = classifyUrl(ogUrl.value, null);
    if (target.url && target.url.href !== canonical.href) {
      report("og-url-mismatch", "warning", `og:url "${ogUrl.value}" differs from the canonical "${canonical.href}". Open Graph expects og:url to be the canonical URL.`, ogUrl.line);
    }
  }

  const twitter = propertyMap(page.metas, TWITTER_KEY);
  const card = twitter.get("twitter:card");
  if (card && !(TWITTER_CARD_TYPES as readonly string[]).includes(card.value.toLowerCase())) {
    report("twitter-card-invalid", "error", `twitter:card "${card.value}" is not one of: ${TWITTER_CARD_TYPES.join(", ")}. X won't render a card for it.`, card.line);
  }

  const toRecord = (map: Map<string, { value: string }>) => Object.fromEntries([...map].map(([key, { value }]) => [key, value]));
  return { openGraph: toRecord(og), twitter: toRecord(twitter) };
}

function checkHeadings(headings: Heading[], report: Report): void {
  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    report("h1-missing", "warning", "The page has no <h1>. A top-level heading tells readers and search engines what the page is about.");
  } else if (h1s.length > 1) {
    report("h1-multiple", "warning", `The page has ${h1s.length} <h1> elements (first on line ${h1s[0].line}). One h1 naming the page is the usual convention.`, h1s[1].line);
  }
  let previous: Heading | null = null;
  for (const heading of headings) {
    if (previous && heading.level > previous.level + 1) {
      report("heading-skipped", "warning", `<h${heading.level}> follows <h${previous.level}> (line ${previous.line}), skipping a level. Use <h${previous.level + 1}> or restructure.`, heading.line);
    }
    previous = heading;
  }
}

function checkHreflang(page: ScannedPage, base: URL | null, self: string[], report: Report): HreflangAlternate[] {
  const alternates: HreflangAlternate[] = [];
  const byCode = new Map<string, HreflangAlternate>();
  for (const link of page.links) {
    if (link.attrs.hreflang === undefined || !relTypes(link).includes("alternate")) continue;
    const code = attr(link, "hreflang");
    const href = attr(link, "href");
    const target = classifyUrl(href, base);
    const alternate = { hreflang: code, href: target.url?.href ?? href, line: link.line };
    alternates.push(alternate);

    const lower = code.toLowerCase();
    const reserved = RESERVED_REGION.exec(code)?.[1].toUpperCase();
    if (lower !== "x-default" && !HREFLANG_CODE.test(code)) {
      const hint = code.includes("_") ? " Use a hyphen, not an underscore." : "";
      report("hreflang-invalid", "error", `hreflang="${code}" is not a language code like en, en-GB or zh-Hant, or x-default.${hint}`, link.line);
    } else if (reserved) {
      report("hreflang-invalid", "error", `hreflang="${code}": ${reserved} is a reserved code, not an ISO 3166-1 region, so Google ignores it.${reserved === "UK" ? " Use GB." : ""}`, link.line);
    }
    if (target.kind !== "absolute") {
      const why = target.kind === "relative" ? "is relative. Google requires fully qualified URLs" : "is not a valid http(s) URL";
      report("hreflang-href-invalid", "error", `The hreflang="${code}" href "${href}" ${why}.`, link.line);
    }
    const first = byCode.get(lower);
    if (!first) byCode.set(lower, alternate);
    else if (first.href !== alternate.href) {
      report("hreflang-duplicate", "error", `hreflang="${code}" points to "${alternate.href}" here and "${first.href}" on line ${first.line}. Each language code needs exactly one URL.`, link.line);
    }
  }
  if (alternates.length) {
    if (!byCode.has("x-default")) {
      report("hreflang-x-default-missing", "warning", 'The hreflang alternates have no x-default, the fallback for languages you don\'t list. Add <link rel="alternate" hreflang="x-default" href="...">.', alternates[0].line);
    }
    if (self.length && !alternates.some((a) => self.includes(a.href))) {
      report("hreflang-self-missing", "warning", `The hreflang alternates don't include this page (${self[0]}). Each version must list itself as well as the others.`, alternates[0].line);
    }
  }
  return alternates;
}

// Microdata (itemprop) and RDFa (property) meta and link elements are allowed in body
// (https://html.spec.whatwg.org/multipage/microdata.html, https://www.w3.org/TR/html-rdfa/).
// Open Graph and X properties use RDFa syntax but describe the page, so they stay in head.
function isItemMarkup(el: ScannedElement): boolean {
  if (el.attrs.itemprop !== undefined) return true;
  const property = attr(el, "property").toLowerCase();
  return property !== "" && el.attrs.name === undefined && !OG_KEY.test(property) && !TWITTER_KEY.test(property);
}

function checkPlacement(page: ScannedPage, report: Report): void {
  const misplaced = [
    ...page.titles,
    ...page.bases,
    ...page.metas.filter((meta) => !isItemMarkup(meta)),
    ...page.links.filter((link) => {
      const types = relTypes(link);
      // A canonical outside head has its own rule.
      return !isItemMarkup(link) && !types.includes("canonical") && !types.every((t) => BODY_OK_LINK_TYPES.has(t));
    }),
  ].filter((el) => !el.inHead);
  for (const el of misplaced) {
    report("metadata-in-body", "error", `${describe(el)} is in <body>${headEnd(page)}. Google stops reading head metadata at the first element that doesn't belong in the head, so it is ignored.`, el.line);
  }
}

function checkDuplicateMeta(page: ScannedPage, report: Report): void {
  const seen = new Map<string, { line: number; count: number }>();
  for (const meta of page.metas) {
    const name = metaName(meta);
    // Robots tags combine (https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).
    if (!name || name === "description" || REPEATABLE_META.has(name) || ROBOTS_NAMES.has(name) || OG_KEY.test(name)) continue;
    const first = seen.get(name);
    if (!first) {
      seen.set(name, { line: meta.line, count: 1 });
    } else if (++first.count === 2) {
      report("meta-duplicate", "warning", `<meta name="${name}"> appears more than once (first on line ${first.line}). Keep one, so it's clear which value applies.`, meta.line);
    }
  }
}

/** Lints a page's SEO and sharing metadata. Throws a TypeError when options.url is not an absolute http(s) URL. */
export function lintMetadata(html: string, options: LintOptions = {}): MetadataResult {
  let pageUrl: URL | null = null;
  if (options.url !== undefined) {
    const parsed = classifyUrl(options.url.trim(), null);
    if (parsed.kind !== "absolute") throw new TypeError(`options.url must be an absolute http(s) URL, got "${options.url}".`);
    // A fragment names a place in the page, not another page, so it never counts in URL comparisons.
    pageUrl = parsed.url!;
    pageUrl.hash = "";
  }

  const page = scanPage(html);
  const findings: MetadataFinding[] = [];
  const report: Report = (rule, severity, message, line = null) => findings.push({ rule, severity, message, line });

  // Relative URLs resolve against the first <base href>, itself resolved against the page URL.
  const baseElement = page.bases.find((el) => el.attrs.href !== undefined);
  const base = (baseElement && classifyUrl(attr(baseElement, "href"), pageUrl).url) || pageUrl;

  const document = checkDocument(page, html, report);
  const title = checkText("title", page.titles, TITLE_MIN_LENGTH, TITLE_MAX_LENGTH, "error", report);
  const descriptions = page.metas.filter((meta) => metaName(meta) === "description").map((meta) => ({ text: meta.attrs.content ?? "", line: meta.line }));
  const description = checkText("description", descriptions, DESCRIPTION_MIN_LENGTH, DESCRIPTION_MAX_LENGTH, "warning", report);
  const canonical = checkCanonical(page, base, report);
  const robots = checkRobots(page, report);
  const social = checkSocial(page, canonical, report);
  checkHeadings(page.headings, report);
  const self = [pageUrl?.href, canonical instanceof URL ? canonical.href : undefined].filter((href) => href !== undefined);
  const hreflang = checkHreflang(page, base, self, report);
  checkPlacement(page, report);
  checkDuplicateMeta(page, report);

  // Document-level findings first, then in line order (the sort is stable).
  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const errorCount = findings.filter((f) => f.severity === "error").length;
  return {
    valid: errorCount === 0,
    errorCount,
    warningCount: findings.length - errorCount,
    findings,
    metadata: {
      title,
      description,
      canonical: canonical instanceof URL ? canonical.href : canonical,
      robots,
      ...document,
      ...social,
      hreflang,
      headings: page.headings,
    },
  };
}
