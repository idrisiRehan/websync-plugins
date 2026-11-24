export { lintSitemap, SITEMAP_NAMESPACE, MAX_BYTES, MAX_ENTRIES, MAX_LOC_LENGTH } from "./lint.ts";
export type { RuleId, Severity, SitemapFinding, SitemapResult } from "./lint.ts";
// The XML reader, a documented building block reused by product-feed-lint (ADR 0006).
export { parseXml } from "./xml.ts";
export type { XmlElement, XmlParseResult } from "./xml.ts";
