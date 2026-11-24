// OpenAI product feed requirements (ChatGPT shopping, Agentic Commerce) as data, plus the rules
// that span attributes. Every entry names the section of OpenAI's product feed schema it was
// taken from and the date it was last compared with it. The schema separates discovery fields
// (required in every row) from Ads and checkout fields, which are required only when those
// integrations are used.

import { objectOf, parseMoney } from "./values.ts";
import { valueOf, type AttributeSpec, type Item, type Report, type Target } from "./spec.ts";

const CHECKED = "2026-11-24";
const SCHEMA = "https://developers.openai.com/commerce/specs/file-upload/products";
const section = (anchor: string) => `${SCHEMA}#${anchor}`;

const attr = (name: string, anchor: string, rest: Partial<AttributeSpec> = {}): AttributeSpec => ({ name, source: section(anchor), checked: CHECKED, ...rest });

const BOOLEAN = { type: "enum", values: ["true", "false"] } as const;
const POSITIVE = { type: "number", number: { min: 0, minExclusive: true } } as const;
const COUNT = { type: "number", number: { integer: true, min: 0 } } as const;
const RATING = { type: "number", number: { min: 0, max: 5 } } as const;
const UNITS = ["in", "cm", "ft", "m", "mm"];
const CHECKOUT = [{ attribute: "is_eligible_checkout", values: ["true"] }];

// Legacy variant columns, still accepted: Custom_variant1_category / Custom_variant1_option ...
const LEGACY_VARIANTS = [1, 2, 3].flatMap((n) => ["category", "option"].flatMap((part) => [`Custom_variant${n}_${part}`, `custom_variant${n}_${part}`]));

export const OPENAI_ATTRIBUTES: readonly AttributeSpec[] = [
  // Basic product data: required for discovery.
  attr("item_id", "basic-product-data", { required: true, unique: true, aliases: ["id", "sku"] }),
  // "Aim for at most 150 and 5,000 characters": guidance, so length is a warning.
  attr("title", "basic-product-data", { required: true, maxLength: 150, severity: "warning" }),
  attr("description", "basic-product-data", { required: true, maxLength: 5000, severity: "warning" }),
  attr("url", "basic-product-data", { required: true, type: "url" }),
  attr("brand", "basic-product-data", { required: true }),
  attr("seller_name", "basic-product-data", { required: true }),
  attr("image_url", "basic-product-data", { required: true, type: "url" }),
  // "Omitted, empty, or unrecognized values reject the row."
  attr("availability", "basic-product-data", { required: true, type: "enum", values: ["in_stock", "out_of_stock", "pre_order", "backorder", "unknown"] }),
  attr("price", "basic-product-data", { required: true, type: "money" }),
  attr("target_countries", "geo-tagging", { required: true, type: "country-list" }),
  attr("store_country", "geo-tagging", { required: true, type: "country" }),
  // "the enable_ flags win over their is_eligible_ names" and "return_window wins over
  // return_deadline_in_days" (compatibility notes), hence aliasWins.
  attr("is_eligible_search", "openai-flags", { ...BOOLEAN, aliases: ["enable_search"], aliasWins: true }),

  // Variants and identity.
  attr("group_id", "variants", { aliases: ["item_group_id"] }),
  attr("listing_has_variations", "variants", BOOLEAN),
  attr("variant_dict", "variants", { type: "string-map" }),
  attr("offer_id", "variants", { unique: true }),
  attr("gtin", "variants", { type: "gtin" }),
  attr("mpn", "variants"),
  ...LEGACY_VARIANTS.map((name) => attr(name, "compatibility-notes")),

  // Item information. Unrecognized gender and age_group values are dropped, not rejected.
  attr("condition", "item-information", { type: "enum", values: ["new", "refurbished", "used"] }),
  attr("product_category", "item-information"),
  attr("material", "item-information"),
  attr("color", "item-information"),
  attr("size", "item-information"),
  attr("gender", "item-information", { type: "enum", values: ["male", "female", "unisex"], severity: "warning" }),
  attr("age_group", "item-information", { type: "enum", values: ["newborn", "infant", "toddler", "kids", "adult"], severity: "warning" }),
  attr("dimensions", "item-information", { type: "dimensions", values: UNITS }),
  ...["length", "width", "height"].map((name) => attr(name, "item-information", POSITIVE)),
  attr("dimensions_unit", "item-information", {
    type: "enum",
    values: UNITS,
    requiredWhen: [{ attribute: "length" }, { attribute: "width" }, { attribute: "height" }],
    requiredNote: "It is required with length, width or height.",
  }),
  attr("weight", "item-information", POSITIVE),
  attr("item_weight_unit", "item-information", { type: "enum", values: ["g", "kg", "oz", "lb"], requiredWhen: [{ attribute: "weight" }], requiredNote: "It is required with weight." }),

  // Media, price, merchant. Invalid optional URLs are dropped, so they are warnings.
  attr("additional_image_urls", "media", { type: "url-list", severity: "warning" }),
  attr("sale_price", "price--promotions", { type: "money", severity: "warning" }),
  attr("seller_url", "merchant-info", { type: "url", severity: "warning" }),

  // Fulfillment and returns.
  attr("shipping_price", "fulfillment", { type: "money" }),
  attr("shipping", "fulfillment"),
  attr("accepts_returns", "returns", BOOLEAN),
  attr("return_deadline_in_days", "returns", { type: "number", number: { integer: true, min: 0, minExclusive: true }, aliases: ["return_window"], aliasWins: true }),
  attr("return_policy", "returns", { type: "url", severity: "warning" }),
  attr("review_count", "reviews-and-qa", COUNT),
  attr("star_rating", "reviews-and-qa", RATING),

  // Additional supported data: needs an integration configured to carry it.
  attr("marketplace_seller", "additional-supported-data"),
  attr("size_system", "additional-supported-data", { type: "enum", values: ["US", "UK", "EU", "DE", "FR", "JP", "CN", "IT", "BR", "MEX", "AU"] }),
  attr("store_review_count", "additional-supported-data", COUNT),
  attr("store_star_rating", "additional-supported-data", RATING),
  attr("accepts_exchanges", "additional-supported-data", BOOLEAN),
  attr("is_digital", "additional-supported-data", BOOLEAN),

  // Ads and checkout: required only for those integrations.
  attr("is_ads_eligible", "ads", { ...BOOLEAN, aliases: ["is_eligible_ads"] }),
  attr("ads_metadata", "ads", { type: "string-map" }),
  attr("is_eligible_checkout", "checkout", { ...BOOLEAN, aliases: ["enable_checkout"], aliasWins: true }),
  attr("seller_privacy_policy", "checkout", { type: "url", requiredWhen: CHECKOUT, requiredNote: "It is required for checkout (is_eligible_checkout is true)." }),
  attr("seller_tos", "checkout", { type: "url", requiredWhen: CHECKOUT, requiredNote: "It is required for checkout (is_eligible_checkout is true)." }),
];

function checkItem(item: Item, report: Report): void {
  const at = (attribute: string) => ({ line: item.fields.get(attribute)?.[0]?.line ?? item.line, itemId: item.id, attribute });

  const priceText = valueOf(item, "price");
  const price = parseMoney(priceText, true);
  if (price && price.amount <= 0) report("price-invalid", "error", `price is ${priceText}. Use a positive regular price.`, at("price"));

  const saleText = valueOf(item, "sale_price");
  const sale = parseMoney(saleText, true);
  if (price && sale) {
    const problem =
      sale.currency !== price.currency ? `is in ${sale.currency} and price in ${price.currency}`
      : sale.amount <= 0 ? "isn't greater than zero"
      : sale.amount >= price.amount ? `isn't lower than price ${priceText}`
      : null;
    if (problem) report("sale-price-invalid", "warning", `sale_price ${saleText} ${problem}, so the sale isn't used. A sale price must be above zero, below price and in the same currency.`, at("sale_price"));
  }

  const shipping = parseMoney(valueOf(item, "shipping_price"), true);
  if (price && shipping && shipping.currency !== price.currency) {
    report("value-invalid", "error", `shipping_price is in ${shipping.currency} and price in ${price.currency}. Use the same currency as price.`, at("shipping_price"));
  }

  if (valueOf(item, "return_deadline_in_days") && valueOf(item, "accepts_returns") !== "true") {
    report("value-invalid", "warning", "return_deadline_in_days is set but accepts_returns isn't true. Supply a return window only with accepts_returns=true; it doesn't enable returns by itself.", at("return_deadline_in_days"));
  }
  const reviews = Number(valueOf(item, "review_count"));
  if (valueOf(item, "star_rating") && !(reviews > 0)) {
    report("value-invalid", "warning", "star_rating is set without a positive review_count. Pair the rating with the review count it averages, or omit it when there are no reviews.", at("star_rating"));
  }
  if (valueOf(item, "is_eligible_checkout") === "true" && valueOf(item, "is_eligible_search") === "false") {
    report("value-invalid", "warning", "is_eligible_checkout is true but is_eligible_search is false, which disables checkout too.", at("is_eligible_checkout"));
  }
}

function checkFeed(items: readonly Item[], report: Report): void {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const group = valueOf(item, "group_id");
    if (!group) continue;
    if (group === item.id) {
      if (valueOf(item, "listing_has_variations") === "true") {
        report("variant-inconsistent", "warning", `group_id is the same as item_id ("${group}"), so no variant group is formed and variant_dict is ignored. The group ID must differ from each item ID.`, { line: item.line, itemId: item.id, attribute: "group_id" });
      }
      continue;
    }
    const members = groups.get(group);
    if (members) members.push(item);
    else groups.set(group, [item]);
  }

  // "Set listing_has_variations=true on every variant row ... Use the same option names across
  // a group, and unique option combinations."
  for (const [group, members] of groups) {
    if (members.length < 2) continue;
    for (const item of members) {
      if (valueOf(item, "listing_has_variations") !== "true") {
        report("variant-inconsistent", "warning", `Item "${item.id}" is in group "${group}" but listing_has_variations isn't true. Set it to true on every variant row.`, { line: item.line, itemId: item.id, attribute: "listing_has_variations" });
      }
    }
    const options = new Map<string, Item>();
    let names: string | null = null;
    for (const item of members) {
      const field = item.fields.get("variant_dict")?.[0];
      const dict = field && objectOf(field);
      if (!dict) continue;
      const keys = Object.keys(dict).sort().join(", ");
      if (names === null) names = keys;
      else if (keys !== names) {
        report("variant-inconsistent", "warning", `Variants in group "${group}" use different option names (${names} and ${keys}). Use the same option names across a group.`, { line: item.line, itemId: item.id, attribute: "variant_dict" });
      }
      const combination = JSON.stringify(Object.entries(dict).sort());
      const twin = options.get(combination);
      if (twin) {
        report("variant-inconsistent", "warning", `Item "${item.id}" has the same variant options as "${twin.id}" in group "${group}". Each variant needs a unique option combination.`, { line: item.line, itemId: item.id, attribute: "variant_dict" });
      } else options.set(combination, item);
    }
  }
}

export const OPENAI: Target = {
  name: "openai",
  label: "OpenAI product feed",
  formats: ["jsonl", "csv", "tsv"],
  idAttribute: "item_id",
  repeatedColumns: false,
  strict: true,
  attributes: OPENAI_ATTRIBUTES,
  // "Do not use placeholder strings such as null, unknown, or n/a; unknown is valid only where
  // explicitly listed." Matched case-insensitively, and skipped where an enum lists the value.
  placeholders: { values: ["null", "unknown", "n/a"], source: section("feed-reference") },
  checkItem,
  checkFeed,
};
