// The comparison: for each feed item that has a page, find the product on the page that the item
// describes, then compare price, sale price, currency and availability. Feed reading is
// product-feed-lint's readFeedItems(); page reading is schemaview's readProducts(). Pure and
// offline: pages are given, never fetched. Each page is read once and indexed by identifier,
// so the work is linear in the size of the feed and the pages.

import { readFeedItems, type FeedFinding, type FeedFormat, type FeedItem, type TargetName } from "product-feed-lint";
import { readProducts, type OfferData, type PriceSpecificationData, type ProductData, type ProductsResult } from "schemaview";
import { availabilityOfFeed, availabilityOfSchema, compareDecimal, parseDate, parseDecimal, parseEndDate, parseMoney, type Money } from "./values.ts";

export type Severity = "error" | "warning";

export type RuleId =
  // the page says something else
  | "price-mismatch"
  | "sale-price-not-on-page"
  | "currency-mismatch"
  | "availability-mismatch"
  | "availability-relaxed"
  | "original-price-mismatch"
  // can't tell
  | "page-price-range"
  | "page-no-product"
  | "product-ambiguous"
  | "page-price-missing"
  | "page-currency-missing"
  | "page-availability-missing"
  | "feed-value-invalid"
  // the CLI: no page to compare with
  | "link-unusable"
  | "page-unavailable";

export interface Finding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** Line in the page's HTML that the finding is about, or null. */
  line: number | null;
}

/** How the item was matched to a product on the page. See the README for the order. */
export type MatchKind = "single" | "gtin" | "sku" | "mpn" | "url" | "id" | "currency" | "identical";

export interface FeedValues {
  /** As written in the feed, or null when absent. */
  price: string | null;
  salePrice: string | null;
  /** Whether the sale price is the current price now: valid, and inside its effective dates. */
  saleActive: boolean;
  availability: string | null;
}

export interface PageValues {
  /** The page the values were read from. */
  url: string;
  matchedBy: MatchKind;
  /** The current price as written (Offer.price, or a priceSpecification without priceType), or null. */
  price: string | null;
  /** An AggregateOffer's range, when there is no single price. */
  lowPrice: string | null;
  highPrice: string | null;
  /** The price marked StrikethroughPrice (or ListPrice), or null. */
  originalPrice: string | null;
  currency: string | null;
  /** Without the schema.org prefix, such as "InStock". */
  availability: string | null;
  /** Line of the offer the values come from (of the product when it has no offer). */
  line: number;
}

export interface ItemResult {
  id: string | null;
  /** Row (TSV, CSV) or line (XML, JSONL) of the item in the feed. */
  line: number;
  /** The item's link (google) or url (openai), or null. */
  link: string | null;
  feed: FeedValues;
  /** What the matched product on the page says, or null when no product could be matched. */
  page: PageValues | null;
  findings: Finding[];
}

export interface CheckOptions {
  /** Whose feed spec to read the feed by. Default "google". */
  target?: TargetName;
  /** Skip detection and read the feed as this format. */
  format?: FeedFormat;
  /** The time sale dates and price validity are evaluated at. Default: now. */
  now?: Date;
}

export interface Page {
  /** The URL the page was requested with: an item's link. */
  url: string;
  html: string;
}

export interface FeedPageResult {
  target: TargetName;
  format: FeedFormat | null;
  /** Items in the feed. */
  itemCount: number;
  /** Items that had a page, which are the ones in `items`. */
  checkedCount: number;
  errorCount: number;
  warningCount: number;
  items: ItemResult[];
  /** Problems product-feed-lint met while reading the feed (an unreadable feed, broken quoting). */
  feedFindings: FeedFinding[];
}

/** One product-and-offer pair on a page that a feed item could describe. */
interface Candidate {
  offer: OfferData | null;
  sku: string | null;
  gtins: string[];
  mpn: string | null;
  url: string | null;
  id: string | null;
  values: Omit<PageValues, "url" | "matchedBy">;
  /** Price, currency and availability as one string, to tell whether candidates differ. */
  key: string;
}

export interface ParsedPage {
  url: string;
  data: ProductsResult;
  candidates: Candidate[];
  index: Map<IdentifierKind, Map<string, Candidate[]>>;
  /** match() results by the identifier values and currency they were computed from. */
  matches: Map<string, Match>;
}

type Match = { candidate: Candidate; kind: MatchKind } | { candidates: Candidate[] };

type IdentifierKind = "gtin" | "sku" | "mpn" | "url" | "id";
const STRIKETHROUGH = new Set(["StrikethroughPrice", "ListPrice"]);

// Google: "Active prices have neither a priceType nor a validForMemberTier property"; the original
// price is the StrikethroughPrice (ListPrice "for a transition period"); "Price specifications
// containing both of these properties are ignored."
const isActive = (s: PriceSpecificationData) => s.price !== null && s.priceType === null && !s.memberPrice;
const isOriginal = (s: PriceSpecificationData) => s.price !== null && s.priceType !== null && STRIKETHROUGH.has(s.priceType) && !s.memberPrice;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** An absolute URL without its fragment, or null. Fragments never reach the server. */
function normalizeUrl(value: string | null, base?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim(), base);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** GTINs compare as 14 digits, so a UPC-A and its EAN-13 form (leading zero) are the same. */
function normalizeGtin(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{8,14}$/.test(digits) ? digits.padStart(14, "0") : null;
}

function within(now: number, from: string | null, through: string | null): boolean {
  const start = from ? parseDate(from) : null;
  const end = through ? parseEndDate(through) : null;
  return (start === null || start <= now) && (end === null || now < end);
}

function pageValues(product: ProductData, offer: OfferData | null, now: number): Candidate["values"] {
  if (!offer) return { price: null, lowPrice: null, highPrice: null, originalPrice: null, currency: null, availability: null, line: product.line };
  // Google: "The active price is required but may be nested inside a priceSpecification". One
  // outside its validFrom and validThrough dates is used only when no other is current.
  const pick = (kind: (s: PriceSpecificationData) => boolean) => {
    const list = offer.priceSpecifications.filter(kind);
    return list.find((s) => within(now, s.validFrom, s.validThrough)) ?? list[0];
  };
  const active = offer.price === null ? pick(isActive) : undefined;
  const original = pick(isOriginal);
  return {
    price: offer.price ?? active?.price ?? null,
    lowPrice: offer.lowPrice,
    highPrice: offer.highPrice,
    originalPrice: original?.price ?? null,
    currency: offer.priceCurrency ?? active?.priceCurrency ?? original?.priceCurrency ?? null,
    availability: offer.availability,
    line: offer.line,
  };
}

/** Reads a page once: its products, the candidates an item can match, and an index by identifier. */
export function parsePage(url: string, html: string, now: number): ParsedPage {
  const data = readProducts(html);
  const withOffers = data.products.filter((p) => p.offers.length);
  const candidates: Candidate[] = [];
  // Products without offers (a ProductGroup over its variants, links to other variant pages)
  // can't be compared, so they count only when no product on the page has an offer.
  for (const product of withOffers.length ? withOffers : data.products) {
    // An AggregateOffer's own offers say more than its range, so it is used only without them.
    const priced = product.offers.filter((o) => o.price !== null || o.priceSpecifications.some(isActive));
    const offers: (OfferData | null)[] = priced.length ? priced : product.offers.length ? product.offers : [null];
    for (const offer of offers) {
      const values = pageValues(product, offer, now);
      candidates.push({
        offer,
        sku: offer?.sku ?? product.sku,
        gtins: (offer?.gtins.length ? offer.gtins : product.gtins).map(normalizeGtin).filter((g): g is string => g !== null),
        mpn: offer?.mpn ?? product.mpn,
        url: normalizeUrl(offer?.url ?? product.url, url),
        id: product.id,
        values,
        key: JSON.stringify([values.price && parseDecimal(values.price), values.lowPrice, values.highPrice, values.currency, values.availability]),
      });
    }
  }
  const index = new Map<IdentifierKind, Map<string, Candidate[]>>();
  const add = (kind: IdentifierKind, value: string | null, candidate: Candidate) => {
    if (!value) return;
    let byValue = index.get(kind);
    if (!byValue) index.set(kind, (byValue = new Map()));
    const list = byValue.get(value);
    if (!list) byValue.set(value, [candidate]);
    else if (list.at(-1) !== candidate) list.push(candidate);
  };
  for (const c of candidates) {
    for (const gtin of c.gtins) add("gtin", gtin, c);
    add("sku", c.sku, c);
    add("mpn", c.mpn, c);
    add("url", c.url, c);
    add("id", c.id, c);
  }
  return { url, data, candidates, index, matches: new Map() };
}

interface ItemKeys {
  gtin: string[];
  sku: string[];
  mpn: string[];
  url: string[];
  id: string[];
}

const IDENTIFIER_KINDS = ["gtin", "sku", "mpn", "url", "id"] as const;

/**
 * Narrows the page's candidates to the one the item describes. Each identifier the item has
 * narrows the set when it matches at least one candidate, in this order: gtin, the item's id as
 * sku, mpn, link as url, id or link as @id, then the price's currency. The first step that
 * leaves one candidate names the match. Several left that all say the same count as a match.
 * The result depends only on the item's values that the page has and on the currency, so items
 * that share them share one result, and many items on one large page stay linear.
 */
function match(page: ParsedPage, keys: ItemKeys, currency: string | null): Match {
  if (page.candidates.length === 1) return { candidate: page.candidates[0], kind: "single" };
  const present = IDENTIFIER_KINDS.map((kind) => keys[kind].filter((value) => page.index.get(kind)?.has(value)));
  const key = JSON.stringify([present, currency]);
  let result = page.matches.get(key);
  if (!result) page.matches.set(key, (result = narrow(page, present, currency)));
  return result;
}

function narrow(page: ParsedPage, present: string[][], currency: string | null): Match {
  let current: Set<Candidate> | null = null; // null: all of them
  for (const [i, kind] of IDENTIFIER_KINDS.entries()) {
    const hits = new Set<Candidate>();
    for (const value of present[i]) {
      for (const c of page.index.get(kind)!.get(value)!) if (current === null || current.has(c)) hits.add(c);
    }
    if (hits.size === 0) continue;
    current = hits;
    if (hits.size === 1) return { candidate: [...hits][0], kind };
  }
  let left = current ? [...current] : page.candidates;
  if (currency) {
    const sameCurrency = left.filter((c) => c.values.currency?.toUpperCase() === currency);
    if (sameCurrency.length === 1) return { candidate: sameCurrency[0], kind: "currency" };
    if (sameCurrency.length > 1 && sameCurrency.length < left.length) left = sameCurrency;
  }
  return left.every((c) => c.key === left[0].key) ? { candidate: left[0], kind: "identical" } : { candidates: left };
}

const first = (item: FeedItem, name: string): string | null => item.attributes[name]?.[0] ?? null;

/** The item's values for the comparison, and the findings about the feed side. */
function feedSide(item: FeedItem, target: TargetName, now: number, report: (f: Finding) => void): { values: FeedValues; price: Money | null; current: Money | null; sale: Money | null; saleUsable: boolean } {
  const priceText = first(item, "price");
  const saleText = first(item, "sale_price");
  const price = priceText === null ? null : parseMoney(priceText);
  const sale = saleText === null ? null : parseMoney(saleText);
  if (!price) {
    report({ rule: "feed-value-invalid", severity: "warning", message: priceText === null ? "The item has no price, so the page's price wasn't compared." : `The feed price "${priceText}" can't be read, so the page's price wasn't compared. Run product-feed-lint on the feed.`, line: null });
  }
  // A sale counts only when it is a usable sale price (Google: "less than the price"; OpenAI: "greater
  // than zero, strictly less than price, and in the same currency"), and for Google, only inside
  // sale_price_effective_date, without which "the sale price will be used for your product
  // immediately" (https://support.google.com/merchants/answer/6324471). OpenAI's spec says sale dates
  // "do not schedule price or availability changes", so they aren't read for it.
  const saleUsable = !!price && !!sale && sale.currency === price.currency && compareDecimal(sale.amount, "0") > 0 && compareDecimal(sale.amount, price.amount) < 0;
  let saleActive = false;
  if (saleUsable) {
    saleActive = true;
    const range = target === "google" ? first(item, "sale_price_effective_date") : null;
    if (range !== null) {
      const ends = range.split("/");
      const start = parseDate(ends[0]);
      const end = ends.length === 2 ? parseEndDate(ends[1]) : null;
      if (start === null || end === null) {
        report({ rule: "feed-value-invalid", severity: "warning", message: `sale_price_effective_date "${range}" can't be read, so the sale price was taken as current.`, line: null });
      } else {
        saleActive = start <= now && now < end;
      }
    }
  } else if (saleText !== null && !sale) {
    report({ rule: "feed-value-invalid", severity: "warning", message: `The feed sale_price "${saleText}" can't be read, so it wasn't compared.`, line: null });
  }
  return {
    values: { price: priceText, salePrice: saleText, saleActive, availability: first(item, "availability") },
    price,
    current: saleActive ? sale : price,
    sale,
    saleUsable,
  };
}

/** The item's feed values alone, for an item whose page couldn't be compared. */
export function feedValues(item: FeedItem, target: TargetName, now: number): FeedValues {
  return feedSide(item, target, now, () => {}).values;
}

function show(amount: string, currency: string | null): string {
  return currency ? `${amount} ${currency}` : amount;
}

/** Compares one feed item with its page. */
export function checkItem(item: FeedItem, target: TargetName, page: ParsedPage, now: number): ItemResult {
  const findings: Finding[] = [];
  const report = (f: Finding) => findings.push(f);
  const link = first(item, target === "google" ? "link" : "url");
  const feed = feedSide(item, target, now, report);
  const result: ItemResult = { id: item.id, line: item.line, link, feed: feed.values, page: null, findings };

  if (page.candidates.length === 0) {
    const { blockCount, unreadableBlockCount, otherSyntax } = page.data;
    const unreadable = unreadableBlockCount ? ` (${unreadableBlockCount} of its ${plural(blockCount, "script")} can't be read as JSON)` : "";
    const why = blockCount === 0 ? "The page has no JSON-LD." : `The page's JSON-LD has no Product${unreadable}.`;
    const microdata = otherSyntax ? " It has Microdata or RDFa, which this tool doesn't read." : "";
    report({ rule: "page-no-product", severity: "warning", message: `${why}${microdata} Without Product structured data in the HTML the server sends, the price and availability couldn't be compared. Google: "Make sure the product structured data is included in the initial HTML" (https://support.google.com/merchants/answer/4752265).`, line: null });
    return result;
  }

  const idAsSku = item.id ? [item.id] : [];
  const keys: ItemKeys = {
    gtin: (item.attributes.gtin ?? []).flatMap((v) => v.split(",")).map(normalizeGtin).filter((g): g is string => g !== null),
    sku: idAsSku,
    mpn: item.attributes.mpn ?? [],
    url: [normalizeUrl(link), page.url].filter((u): u is string => u !== null),
    id: [...idAsSku, ...(link ? [link] : [])],
  };
  const matched = match(page, keys, feed.price?.currency ?? null);
  if (!("candidate" in matched)) {
    const tried = [keys.gtin.length ? "gtin" : "", item.id ? "id" : "", keys.mpn.length ? "mpn" : ""].filter(Boolean);
    report({
      rule: "product-ambiguous",
      severity: "warning",
      message: `The page has ${matched.candidates.length} products or offers that differ in price or availability (lines ${matched.candidates.slice(0, 5).map((c) => c.values.line).join(", ")}${matched.candidates.length > 5 ? ", ..." : ""}), and the item's ${tried.length ? tried.join(", ") : "identifiers"} and link don't pick out one. Give each variant its sku, gtin or url in the markup, or link the item to a URL that preselects its variant.`,
      line: null,
    });
    return result;
  }

  const { values } = matched.candidate;
  result.page = { url: page.url, matchedBy: matched.kind, ...values };
  if (matched.candidate.offer === null) {
    report({ rule: "page-price-missing", severity: "warning", message: "The page's Product data has no offers, so neither price nor availability could be compared. Google's merchant listing markup requires an Offer with a price.", line: values.line });
    return result;
  }
  comparePrice(feed, values, report);
  compareAvailability(feed.values.availability, values, report);
  return result;
}

function comparePrice(feed: ReturnType<typeof feedSide>, page: Candidate["values"], report: (f: Finding) => void): void {
  const { line } = page;
  const priceText = page.price;
  const ranged = priceText === null && (page.lowPrice !== null || page.highPrice !== null);
  if (priceText === null && !ranged) {
    report({ rule: "page-price-missing", severity: "warning", message: "The page's Product data has no price (Offer.price, or a priceSpecification price), so the price couldn't be compared. Google's merchant listing markup requires one.", line });
    return;
  }
  const amount = priceText === null ? null : parseDecimal(priceText);
  if (priceText !== null && amount === null) {
    report({ rule: "page-price-missing", severity: "warning", message: `The page's price "${priceText}" isn't a plain number (digits and a decimal point, with the currency in priceCurrency), so it couldn't be compared.`, line });
    return;
  }
  if (!feed.price || !feed.current) return;

  const currency = page.currency?.trim().toUpperCase() ?? null;
  if (currency === null) {
    report({ rule: "page-currency-missing", severity: "warning", message: "The page's price has no priceCurrency, so only the amount was compared. Google's merchant listing markup requires priceCurrency with a price.", line });
  } else if (feed.price.currency !== null && currency !== feed.price.currency) {
    // Landing page requirements: "Show the price in the currency of the product data" (answer 4752265).
    report({ rule: "currency-mismatch", severity: "error", message: `The page's price is in ${currency}, the feed's in ${feed.price.currency}. Google asks for the price "in the currency of the product data" on the landing page, and the amounts can't be compared across currencies.`, line });
    return;
  }

  const expected = feed.current;
  const shown = (value: string) => show(value, currency ?? feed.price!.currency);
  // Feed values as written ("19.00 USD"), so the message quotes the feed.
  const regular = feed.values.price!;
  const what = feed.values.saleActive ? `sale_price is ${feed.values.salePrice}` : `price is ${regular}`;

  if (amount === null) {
    const low = page.lowPrice === null ? null : parseDecimal(page.lowPrice);
    const high = page.highPrice === null ? null : parseDecimal(page.highPrice);
    const inside = (low === null || compareDecimal(low, expected.amount) <= 0) && (high === null || compareDecimal(expected.amount, high) <= 0);
    const range = `AggregateOffer from ${page.lowPrice ?? "?"} to ${page.highPrice ?? "?"}`;
    if (inside) {
      report({ rule: "page-price-range", severity: "warning", message: `The page gives a price range (${range}), not this item's price, so it couldn't be compared exactly; the feed's ${what}. Google's merchant listings "require an Offer".`, line });
    } else {
      report({ rule: "price-mismatch", severity: "error", message: `The page's price range (${range}) doesn't include the feed's price: the feed's ${what}.`, line });
    }
    return;
  }

  if (amount === expected.amount) {
    const original = page.originalPrice === null ? null : parseDecimal(page.originalPrice);
    if (feed.values.saleActive && original !== null && original !== feed.price.amount) {
      report({ rule: "original-price-mismatch", severity: "warning", message: `The page marks ${shown(page.originalPrice!)} as the original (strikethrough) price, but the feed's price is ${regular}. During a sale, price is the regular price shown next to the sale price.`, line });
    }
    return;
  }

  const sale = feed.sale;
  if (feed.values.saleActive && amount === feed.price.amount) {
    report({ rule: "sale-price-not-on-page", severity: "error", message: `The feed has a current sale_price of ${feed.values.salePrice}, but the page's price is the regular price, ${shown(priceText!)}. Google asks for a sale_price "that matches the sale price you display on your landing page" (https://support.google.com/merchants/answer/6324471).`, line });
    return;
  }
  let hint = "";
  if (!feed.values.saleActive && sale && amount === sale.amount) {
    hint = feed.saleUsable ? " That is the feed's sale_price, which isn't current: check sale_price_effective_date (dates and time zone)." : " That is the feed's sale_price, which isn't used because it isn't above zero, below price and in the same currency.";
  } else if (!sale && page.originalPrice !== null && parseDecimal(page.originalPrice) === feed.price.amount) {
    hint = ` The page shows a sale (${shown(page.originalPrice)} struck through): submit ${shown(priceText!)} as sale_price.`;
  }
  report({ rule: "price-mismatch", severity: "error", message: `The page's price is ${shown(priceText!)}; the feed's ${what}.${hint} Google: "Prices reflected in the HTML need to match exactly the prices uploaded in Merchant Center" (https://support.google.com/merchants/answer/12159029).`, line });
}

function compareAvailability(feedText: string | null, page: Candidate["values"], report: (f: Finding) => void): void {
  const feed = feedText === null ? null : availabilityOfFeed(feedText);
  if (feed === null) return;
  const { line } = page;
  if (page.availability === null) {
    report({ rule: "page-availability-missing", severity: "warning", message: `The page's offer has no availability, so the feed's ${feed} couldn't be compared. Google asks for schema.org structured data "to indicate price, availability" (https://support.google.com/merchants/answer/4752265).`, line });
    return;
  }
  const shown = availabilityOfSchema(page.availability);
  if (shown === null) {
    report({ rule: "page-availability-missing", severity: "warning", message: `The page's availability "${page.availability}" isn't one of the schema.org values Google maps to a feed value (InStock, OutOfStock, PreOrder, BackOrder and the others in https://support.google.com/merchants/answer/6324448), so it couldn't be compared.`, line });
    return;
  }
  if (shown === feed) return;
  const message = `The page says ${page.availability} (${shown}), the feed ${feedText}.`;
  // Automatic item updates: "in_stock, preorder, and backorder are all considered compatible with
  // in_stock" when the data source says in_stock (https://support.google.com/merchants/answer/12157888).
  if (feed === "in_stock" && (shown === "preorder" || shown === "backorder")) {
    report({ rule: "availability-relaxed", severity: "warning", message: `${message} Google's automatic item updates count ${shown} on the page as a match for in_stock, but the availability attribute asks for the same availability on the landing page and in the data source.`, line });
    return;
  }
  report({ rule: "availability-mismatch", severity: "error", message: `${message} Google: "Match the availability listed in your product data with the availability listed on your landing page" (https://support.google.com/merchants/answer/6324448).`, line });
}

export function countFindings(items: readonly { findings: readonly Finding[] }[]): { errorCount: number; warningCount: number } {
  let errorCount = 0;
  let warningCount = 0;
  for (const item of items) {
    for (const f of item.findings) {
      if (f.severity === "error") errorCount++;
      else warningCount++;
    }
  }
  return { errorCount, warningCount };
}

/** The item's page link as a lookup key, or null when it has none that a crawler could request. */
export function linkOf(item: FeedItem, target: TargetName): string | null {
  const url = normalizeUrl(first(item, target === "google" ? "link" : "url"));
  return url !== null && /^https?:/.test(url) ? url : null;
}

/**
 * Compares each feed item that has a page with the Product data on that page. Never throws on
 * bad feeds or pages; throws a TypeError for invalid arguments or options.
 */
export function checkFeedAgainstPages(feed: string, pages: readonly Page[], options: CheckOptions = {}): FeedPageResult {
  if (!Array.isArray(pages) || pages.some((p) => p === null || typeof p !== "object" || typeof p.url !== "string" || typeof p.html !== "string")) {
    throw new TypeError("pages must be an array of { url: string, html: string }.");
  }
  if (options === null || typeof options !== "object") throw new TypeError("options must be an object.");
  if (options.now !== undefined && !(options.now instanceof Date && !Number.isNaN(options.now.getTime()))) throw new TypeError("options.now must be a valid Date.");
  const now = (options.now ?? new Date()).getTime();
  const read = readFeedItems(feed, { target: options.target, format: options.format });

  const html = new Map<string, string>();
  for (const p of pages) {
    const url = normalizeUrl(p.url);
    if (url !== null && !html.has(url)) html.set(url, p.html);
  }
  const parsed = new Map<string, ParsedPage>();
  const items: ItemResult[] = [];
  for (const item of read.items) {
    const url = linkOf(item, read.target);
    const text = url === null ? undefined : html.get(url);
    if (url === null || text === undefined) continue;
    let page = parsed.get(url);
    if (!page) parsed.set(url, (page = parsePage(url, text, now)));
    items.push(checkItem(item, read.target, page, now));
  }
  return { target: read.target, format: read.format, itemCount: read.items.length, checkedCount: items.length, ...countFindings(items), items, feedFindings: read.findings };
}
