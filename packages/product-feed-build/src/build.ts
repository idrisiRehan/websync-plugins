// Turns product records (read by product-csv-lint) into feed items for Google Merchant Center or
// OpenAI's product feed, writes them, and lints the result with product-feed-lint. Pure and
// offline. Each mapping names the platform or feed documentation it follows; the README's
// mapping table lists them all.

import { detectPlatform, readProducts, type Platform, type Product, type ProductVariant } from "product-csv-lint";
import { GOOGLE_ATTRIBUTES, lintProductFeed, type ProductFeedResult } from "product-feed-lint";
import { charLength, fitId, htmlToText, oneLine, truncateWords } from "./text.ts";
import { writeFeed, type FeedItem, type Value } from "./write.ts";

export type Target = "google" | "openai";
export type FeedFormat = "tsv" | "xml" | "jsonl" | "csv";
export type Condition = "new" | "refurbished" | "used";

export interface BuildOptions {
  target: Target;
  /** google: "xml" (default) or "tsv". openai: "jsonl" (default), "csv" or "tsv". */
  format?: FeedFormat;
  /** The storefront, an absolute https URL. Product links are built on it. */
  storeUrl: string;
  /** ISO 4217 code of the export's prices, which carry no currency. */
  currency: string;
  /** Default: detected from the header row. */
  platform?: Platform;
  /** Brand for products whose Vendor (Shopify) or Brands (WooCommerce) cell is empty. */
  brand?: string;
  /** Default "new". A Shopify "Google Shopping / Condition" value wins. */
  condition?: Condition;
  /** openai: required (seller_name). google: titles the XML channel. */
  sellerName?: string;
  /** openai: required, ISO 3166-1 alpha-2 (store_country). */
  storeCountry?: string;
  /** openai: ISO 3166-1 alpha-2 codes (target_countries). Default: the store country. */
  targetCountries?: string[];
  /** google: availability_date for items on backorder, ISO 8601 (2026-12-15T09:00-0800). */
  availabilityDate?: string;
  /**
   * Product link with placeholders: {handle} (Shopify), {id} and {sku} (WooCommerce, the parent's
   * for a variation). An absolute https URL on the store's host. Default: /products/{handle} or
   * /?post_type=product&p={id} on storeUrl.
   */
  linkTemplate?: string;
}

export interface Skipped {
  /** Spreadsheet row in the export (the header is row 1). */
  row: number;
  reason: string;
}

export interface Note {
  row: number;
  /** The feed item the note is about, or null for a whole product. */
  itemId: string | null;
  message: string;
}

export interface BuildResult {
  feed: string;
  target: Target;
  format: FeedFormat;
  platform: Platform;
  itemCount: number;
  /** Rows not turned into items, and why. */
  skipped: Skipped[];
  /** Values left out or changed on the way (an invalid barcode, a shortened id ...). */
  notes: Note[];
  /** product-feed-lint's result for `feed`. */
  lint: ProductFeedResult;
}

/** The formats each target accepts, default first. */
export const FORMATS: Readonly<Record<Target, readonly FeedFormat[]>> = { google: ["xml", "tsv"], openai: ["jsonl", "csv", "tsv"] };
const CONDITIONS: readonly Condition[] = ["new", "refurbished", "used"];
const DECIMAL = /^\d+(\.\d+)?$/;
const COUNTRY = /^[A-Z]{2}$/;

// Google's limits, where Google says it truncates (title, description; answers 6324415 and
// 6324468) or the value must fit (id, item_group_id; answers 6324405 and 6324507).
const GOOGLE_TITLE = 150;
const GOOGLE_DESCRIPTION = 5000;
const GOOGLE_ID = 50;
const GOOGLE_IMAGES = 10;
const RESTRICTED_GTIN = GOOGLE_ATTRIBUTES.find((a) => a.name === "gtin")?.restrictedGtinPrefixes ?? [];

interface Settings {
  target: Target;
  format: FeedFormat;
  platform: Platform;
  store: string;
  currency: string;
  digits: number;
  brand: string;
  condition: Condition;
  sellerName: string;
  storeCountry: string;
  targetCountries: string[];
  availabilityDate: string;
  linkTemplate: string;
}

const optionalText = (value: unknown, name: string): string => {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`options.${name} must be a non-empty string.`);
  // A lone surrogate can't be written as UTF-8, so it would corrupt the feed.
  if (/\p{Surrogate}/u.test(value)) throw new TypeError(`options.${name} contains an unpaired surrogate character.`);
  return oneLine(value);
};

function settings(csv: string | Uint8Array, options: BuildOptions): Settings {
  if (options === null || typeof options !== "object") throw new TypeError("options must be an object.");
  if (typeof csv !== "string" && !(csv instanceof Uint8Array)) throw new TypeError("csv must be a string or a Uint8Array.");
  const { target } = options;
  if (target !== "google" && target !== "openai") throw new TypeError('options.target must be "google" or "openai".');
  const format = options.format ?? FORMATS[target][0];
  if (!FORMATS[target].includes(format)) throw new TypeError(`options.format for ${target} must be one of: ${FORMATS[target].join(", ")}.`);

  const url = typeof options.storeUrl === "string" && URL.canParse(options.storeUrl) ? new URL(options.storeUrl) : null;
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError("options.storeUrl must be an absolute https URL without a query or fragment, like https://shop.example.");
  }
  const store = url.origin + (url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`);

  const currency = typeof options.currency === "string" ? options.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency)) {
    throw new TypeError("options.currency must be an ISO 4217 currency code, like USD.");
  }

  if (options.platform !== undefined && options.platform !== "shopify" && options.platform !== "woocommerce") {
    throw new TypeError('options.platform must be "shopify" or "woocommerce".');
  }
  const platform = options.platform ?? detectPlatform(csv instanceof Uint8Array ? csv : csv.slice(0, 64 * 1024));
  if (!platform) throw new TypeError("The header row matches neither a Shopify nor a WooCommerce export. Set options.platform.");

  const condition = options.condition ?? "new";
  if (!CONDITIONS.includes(condition)) throw new TypeError(`options.condition must be one of: ${CONDITIONS.join(", ")}.`);

  const country = (value: unknown, name: string): string => {
    const code = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!COUNTRY.test(code)) throw new TypeError(`${name} must be an ISO 3166-1 alpha-2 country code, like US.`);
    return code;
  };
  const sellerName = optionalText(options.sellerName, "sellerName");
  let storeCountry = "";
  let targetCountries: string[] = [];
  if (target === "openai") {
    // OpenAI requires seller_name, store_country and target_countries on every row.
    if (!sellerName) throw new TypeError("options.sellerName is required for the openai target (seller_name).");
    storeCountry = country(options.storeCountry, "options.storeCountry");
    if (options.targetCountries !== undefined && (!Array.isArray(options.targetCountries) || options.targetCountries.length === 0)) {
      throw new TypeError("options.targetCountries must be a non-empty array of country codes.");
    }
    targetCountries = [...new Set((options.targetCountries ?? [storeCountry]).map((c) => country(c, "options.targetCountries entries")))];
  }

  const availabilityDate = optionalText(options.availabilityDate, "availabilityDate");
  if (availabilityDate && !isIsoDate(availabilityDate)) {
    throw new TypeError("options.availabilityDate must be an ISO 8601 date and time of at most 25 characters, like 2026-12-15T09:00-0800.");
  }

  const linkTemplate = options.linkTemplate === undefined ? store + DEFAULT_LINK[platform] : optionalText(options.linkTemplate, "linkTemplate");
  if (options.linkTemplate !== undefined) {
    const names = [...linkTemplate.matchAll(/\{(\w*)\}/g)].map((m) => m[1]);
    const allowed = Object.keys(PLACEHOLDERS[platform]).map((name) => `{${name}}`).join(" or ");
    if (names.length === 0 || names.some((name) => !Object.hasOwn(PLACEHOLDERS[platform], name))) {
      throw new TypeError(`options.linkTemplate must use ${allowed} for a ${platform} export, like ${store}${platform === "shopify" ? "shop/{handle}" : "product/{sku}/"}.`);
    }
    const probe = linkTemplate.replace(/\{\w*\}/g, "x");
    if (!URL.canParse(probe) || new URL(probe).protocol !== "https:" || new URL(probe).host !== url.host) {
      throw new TypeError(`options.linkTemplate must be an absolute https URL on ${url.host}, the store's host.`);
    }
  }

  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return { target, format, platform, store, currency, digits, brand: optionalText(options.brand, "brand"), condition, sellerName, storeCountry, targetCountries, availabilityDate, linkTemplate };
}

// Google's availability_date: ISO 8601, 1 to 25 characters (answer 6324470).
function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/.exec(value);
  if (!m || value.length > 25) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const validDay = month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  // UTC offsets run from -12:00 to +14:00.
  const validOffset = Number(m[7] ?? 0) <= 14 && Number(m[8] ?? 0) <= 59;
  return validDay && validOffset && Number(m[4] ?? 0) <= 23 && Number(m[5] ?? 0) <= 59 && Number(m[6] ?? 0) <= 59;
}

// Link placeholders and the value each takes from a product. The exports have no permalink or
// slug column, so these are what a link can be built from.
const PLACEHOLDERS: Record<Platform, Record<string, { label: string; value: (product: Product) => string }>> = {
  shopify: { handle: { label: "URL handle", value: (product) => product.handle } },
  woocommerce: { id: { label: "ID", value: (product) => product.id }, sku: { label: "SKU", value: (product) => product.sku } },
};
// Shopify: /products/{handle}; the export has no variant IDs for ?variant=. WooCommerce: the
// export has no permalink, and WordPress redirects ?post_type=product&p={ID} to it.
const DEFAULT_LINK: Record<Platform, string> = { shopify: "products/{handle}", woocommerce: "?post_type=product&p={id}" };

/** The product's link from the template, and the label of a value it lacks ("" when complete). */
function productLink(product: Product, template: string): { link: string; missing: string } {
  let missing = "";
  const link = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const placeholder = PLACEHOLDERS[product.platform][name];
    const value = placeholder.value(product);
    if (value === "") missing ||= placeholder.label;
    return encodeURIComponent(value);
  });
  return { link, missing };
}

/** "18" as "18.00 USD": the currency's decimals, or the amount as written when it has more (product-feed-lint then reports it). */
function money(amount: string, s: Settings): string {
  const [whole, fraction = ""] = amount.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const int = whole.replace(/^0+(?=\d)/, "");
  if (trimmed.length > s.digits) return `${amount} ${s.currency}`;
  return s.digits === 0 ? `${int} ${s.currency}` : `${int}.${trimmed.padEnd(s.digits, "0")} ${s.currency}`;
}

/** WooCommerce's "2026-12-01 0:00:00" as ISO 8601 "2026-12-01T00:00", or null. */
function isoDateTime(value: string, endOfDay: boolean): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(value);
  if (!m) return null;
  return `${m[1]}T${m[2] === undefined ? (endOfDay ? "23:59" : "00:00") : `${m[2].padStart(2, "0")}:${m[3]}`}`;
}

// Google: prefixes 2, 02 and 04 are restricted and 05, 98 and 99 are coupons; a GTIN-14 with
// indicator 9 is a variable-measure item (answers 6324461 and 160161). GTIN-8 is exempt.
function restrictedGtin(gtin: string): boolean {
  if (gtin.length === 8) return false;
  if (gtin.length === 14 && gtin.startsWith("9")) return true;
  const thirteen = gtin.padStart(14, "0").slice(1);
  return RESTRICTED_GTIN.some((prefix) => thirteen.startsWith(prefix));
}

function availability(variant: ProductVariant): "in_stock" | "out_of_stock" | "backorder" | "unknown" {
  const { status, tracked, quantity, continueSelling } = variant.inventory;
  if (status) return status;
  // Shopify sells untracked variants regardless of stock, and keeps selling tracked ones at
  // zero when the policy is "continue" (Shopify's CSV page). Google calls an existing product
  // that takes orders while out of stock a backorder (answer 6324448).
  if (tracked === false) return "in_stock";
  if (quantity === null) return "unknown";
  if (quantity > 0) return "in_stock";
  return continueSelling ? "backorder" : "out_of_stock";
}

const STATUS_REASON: Record<string, string> = {
  draft: "Draft: not ready to be sold.",
  archived: "Archived: no longer for sale.",
  private: "Private: only store managers can see it.",
  pending: "Pending review: not published yet.",
};

function skipReason(product: Product): string | null {
  if (product.giftCard) return "Gift card: store credit, not merchandise. Add it to the feed by hand if you want to advertise it.";
  if (product.status !== "active") return Object.hasOwn(STATUS_REASON, product.status) ? STATUS_REASON[product.status] : `Status is "${product.status}", not active.`;
  if (!product.visible) {
    return product.platform === "shopify" ? "Not published on the online store, so it has no public product page." : "Catalog visibility is hidden, so shoppers can't find it in the store.";
  }
  if (product.platform === "woocommerce") {
    if (product.type === "grouped") return "Grouped product: a set of other products with no price of its own. The products in it are listed on their own rows.";
    if (product.type === "external") return "External product: it is sold on another site, not by your store.";
    if (product.type !== "simple" && product.type !== "variable") return `"${product.type}" is a plugin's product type, so how it is sold isn't known. Add it by hand if it belongs in the feed.`;
    if (product.variants.length === 0) return "Variable product with no variations in this file. Its variations are what is sold; export them with it.";
  }
  return null;
}

// Shopify writes some Google Shopping values as its admin labels: "Adult (13+ years old)" for
// the age group adult (its sample product_template.csv). Lower-cased, without the note.
function googleValue(value: string | undefined): string {
  const text = oneLine(value ?? "").toLowerCase();
  const note = text.indexOf(" (");
  return note > 0 && text.endsWith(")") ? text.slice(0, note) : text;
}

// Option names that are a feed attribute of their own (Google answer 6324507 lists color, size,
// material and pattern as variant attributes; OpenAI has color, size and material).
const OPTION_ATTRIBUTES: [RegExp, string][] = [
  [/^colou?r$/i, "color"],
  [/^size$/i, "size"],
  [/^material$/i, "material"],
  [/^pattern$/i, "pattern"],
];

/**
 * Builds a product feed from a Shopify or WooCommerce product export and lints it. Never
 * throws on bad CSV: unusable rows are skipped with a reason, and missing required values are
 * left out for product-feed-lint to report. Throws a TypeError for invalid options, including
 * a header row that matches neither platform when `platform` isn't set.
 */
export function buildProductFeed(csv: string | Uint8Array, options: BuildOptions): BuildResult {
  const s = settings(csv, options);
  const google = s.target === "google";
  // Read as UTF-8 bytes: encoding replaces lone surrogates, which only a string argument can
  // hold and which would make encodeURIComponent throw.
  const { products, unread } = readProducts(typeof csv === "string" ? new TextEncoder().encode(csv) : csv, s.platform);
  const skipped: Skipped[] = [...unread];
  const notes: Note[] = [];
  const items: FeedItem[] = [];

  for (const product of products) {
    const { link, missing } = productLink(product, s.linkTemplate);
    const reason = skipReason(product) ?? (missing ? `No ${missing}, so the product page URL can't be built.` : null);
    if (reason) {
      skipped.push({ row: product.row, reason });
      continue;
    }
    const multi = product.platform === "shopify" ? product.variants.length > 1 : product.type === "variable";
    const title = oneLine(product.title);
    let groupId = "";
    if (multi) {
      // Shopify's handle names the product; WooCommerce's parent SKU (or ID) is the parent SKU
      // Google asks for (answer 6324507).
      const raw = oneLine(product.platform === "shopify" ? product.handle : product.sku || product.id);
      groupId = google ? fitId(raw, GOOGLE_ID) : raw;
      if (groupId !== raw) notes.push({ row: product.row, itemId: null, message: `Item group "${raw}" is longer than ${GOOGLE_ID} characters, so item_group_id is "${groupId}".` });
    }

    // The product's images that are no variant's own image (a grey shoe's item shouldn't show
    // the black one), found once per product so building stays linear. Commas inside a URL are
    // encoded, since commas separate the list in text feeds (Google answer 6324370, OpenAI's
    // additional_image_urls).
    const variantImages = new Set(product.variants.map((v) => v.image));
    const sharedImages = product.images.filter((url) => !variantImages.has(url));
    product.variants.forEach((variant, index) => {
      if (!variant.enabled) {
        skipped.push({ row: variant.row, reason: "Disabled variation: not published." });
        return;
      }
      // SKU first; otherwise Shopify's handle (plus the variant's position for a product with
      // variants), WooCommerce's ID. Both are stable as long as the store doesn't change them.
      // One line, so every format writes the same id.
      const rawId = oneLine(variant.sku || (product.platform === "shopify" ? (multi ? `${product.handle}-${index + 1}` : product.handle) : variant.id));
      if (rawId === "") {
        skipped.push({ row: variant.row, reason: "No SKU or ID, so the item has no stable id." });
        return;
      }
      const id = google ? fitId(rawId, GOOGLE_ID) : rawId;
      const note = (message: string) => notes.push({ row: variant.row, itemId: id, message });
      if (id !== rawId) note(`"${rawId}" is longer than ${GOOGLE_ID} characters, so the id is "${id}".`);
      items.push(item(product, variant, { id, groupId, title, multi, link, sharedImages, note }));
    });
  }

  function item(
    product: Product,
    variant: ProductVariant,
    ctx: { id: string; groupId: string; title: string; multi: boolean; link: string; sharedImages: readonly string[]; note: (message: string) => void },
  ): FeedItem {
    const { note } = ctx;
    const out: FeedItem = new Map();
    const set = (name: string, value: Value | null | undefined) => {
      if (value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) out.set(name, value);
    };

    // Single-value product options (a WooCommerce simple product's "Color: Blue") describe
    // every variant too.
    const options = [...variant.options];
    for (const option of product.options) {
      if (option.values.length === 1 && !options.some((o) => o.name.toLowerCase() === option.name.toLowerCase())) options.push({ name: option.name, value: option.values[0] });
    }
    const labels = ctx.multi ? variant.options.map((o) => oneLine(o.value)) : [];

    set(google ? "id" : "item_id", ctx.id);

    // Both specs ask for the variant's details in its title ("Google T-Shirt, Red", answer
    // 6324415; "including the selected variant", OpenAI).
    let title = [ctx.title, ...labels].filter(Boolean).join(", ");
    if (google && charLength(title) > GOOGLE_TITLE) {
      title = truncateWords(title, GOOGLE_TITLE);
      note(`The title is longer than ${GOOGLE_TITLE} characters, which Google truncates, so it was cut at a word boundary.`);
    }
    set("title", title);

    let description = htmlToText(variant.description) || htmlToText(product.description) || htmlToText(product.summary);
    if (google && charLength(description) > GOOGLE_DESCRIPTION) {
      description = truncateWords(description, GOOGLE_DESCRIPTION);
      note(`The description is longer than ${GOOGLE_DESCRIPTION} characters, which Google truncates, so it was cut at a word boundary.`);
    }
    set("description", description);

    set(google ? "link" : "url", ctx.link);

    const image = variant.image || product.images[0] || "";
    set(google ? "image_link" : "image_url", image);
    // The rest of the product's images, except variants' own images. Google takes 10, so it
    // needs at most one more than that (one may be the main image).
    const candidates = google ? ctx.sharedImages.slice(0, GOOGLE_IMAGES + 1) : ctx.sharedImages;
    const more = candidates.filter((url) => url !== image).map((url) => url.replaceAll(",", "%2C"));
    set(google ? "additional_image_link" : "additional_image_urls", google ? more.slice(0, GOOGLE_IMAGES) : more);

    const stock = availability(variant);
    if (stock === "unknown") {
      // Google has no "unknown"; OpenAI asks for it when the stock status isn't known.
      if (google) note("The export has no stock level for this variant, so availability is left out.");
      else set("availability", stock);
    } else set("availability", stock);
    // Google requires the date a backorder ships (answer 6324448); only the merchant knows it.
    // OpenAI's feed has no such field.
    if (google && stock === "backorder") set("availability_date", s.availabilityDate);

    if (variant.price !== "" && !DECIMAL.test(variant.price)) note(`Price "${variant.price}" isn't a plain number, so price is left out.`);
    else if (variant.price !== "") set("price", money(variant.price, s));
    sale(variant, set, note);

    set("condition", CONDITIONS.find((c) => c === googleValue(product.google.condition)) ?? s.condition);
    const brand = oneLine(product.brand) || s.brand;
    set("brand", brand);

    let gtin = variant.gtin;
    if (variant.barcode !== "" && gtin === null) note(`Barcode "${variant.barcode}" isn't a valid GTIN (length or check digit), so gtin is left out.`);
    if (gtin && google && restrictedGtin(gtin)) {
      note(`Barcode "${gtin}" is in a restricted or coupon GTIN range (an in-store code), which Google doesn't accept, so gtin is left out.`);
      gtin = null;
    }
    set("gtin", gtin);
    const mpn = oneLine(variant.mpn);
    set("mpn", mpn);
    // "no" only on the merchant's word (Shopify's Custom Product flag), and only without the
    // identifiers it would contradict (answer 6324478).
    if (google && /^(true|yes)$/i.test(product.google["custom product"] ?? "") && !gtin && !(mpn && brand)) set("identifier_exists", "no");

    if (ctx.groupId) {
      if (google) {
        set("item_group_id", ctx.groupId);
        set("item_group_title", truncateWords(ctx.title, GOOGLE_TITLE));
      } else {
        set("group_id", ctx.groupId);
        set("listing_has_variations", true);
        set("variant_dict", variant.options.length ? Object.fromEntries(variant.options.map((o) => [oneLine(o.name), oneLine(o.value)])) : null);
      }
    }

    if (google) {
      set("product_type", product.productType ? [oneLine(product.productType)] : product.categories.map(oneLine));
      set("google_product_category", oneLine(product.google["google product category"] ?? ""));
    } else {
      set("product_category", oneLine(product.categories[0] ?? product.productType));
    }
    for (const [pattern, name] of OPTION_ATTRIBUTES) {
      if (name === "pattern" && !google) continue;
      set(name, oneLine(options.find((o) => pattern.test(o.name.trim()))?.value ?? ""));
    }
    set("gender", googleValue(product.google.gender));
    set("age_group", googleValue(product.google["age group"]));
    if (google) for (let n = 0; n < 5; n++) set(`custom_label_${n}`, oneLine(product.google[`custom label ${n}`] ?? ""));

    if (!google) {
      set("seller_name", s.sellerName);
      set("seller_url", s.store);
      set("store_country", s.storeCountry);
      set("target_countries", s.targetCountries);
    }
    return out;
  }

  function sale(variant: ProductVariant, set: (name: string, value: Value) => void, note: (message: string) => void): void {
    const { price, salePrice, saleStarts, saleEnds } = variant;
    if (salePrice === "") return;
    if (!DECIMAL.test(salePrice) || !DECIMAL.test(price) || Number(salePrice) >= Number(price)) {
      note(`Sale price "${salePrice}" isn't a number below the regular price "${price}", so sale_price is left out.`);
      return;
    }
    if (saleStarts === "" && saleEnds === "") {
      set("sale_price", money(salePrice, s));
      return;
    }
    // A scheduled WooCommerce sale. Google takes the dates (answer 6324460); OpenAI's feed has
    // no sale dates, and this offline build can't tell whether the sale is on today.
    const start = isoDateTime(saleStarts, false);
    const end = isoDateTime(saleEnds, true);
    if (!google) note("The sale is scheduled, and OpenAI's feed has no sale dates, so sale_price is left out.");
    else if (!start || !end) note("The sale has no start or no end date, and Google needs both, so sale_price is left out.");
    else {
      set("sale_price", money(salePrice, s));
      set("sale_price_effective_date", `${start}/${end}`);
    }
  }

  skipped.sort((a, b) => a.row - b.row);
  const feed = writeFeed(items, s.target, s.format, { title: s.sellerName || new URL(s.store).host, link: s.store });
  return {
    feed,
    target: s.target,
    format: s.format,
    platform: s.platform,
    itemCount: items.length,
    skipped,
    notes,
    lint: lintProductFeed(feed, { target: s.target, format: s.format }),
  };
}
