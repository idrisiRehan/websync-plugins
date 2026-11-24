// Google Merchant Center product data requirements as data, plus the few rules that span
// attributes. Every entry names the Merchant Center Help page it was taken from and the date it
// was last compared with it. Only what the feed itself can show is checked: requirements that
// depend on the target country or product category are left to Limitations in the README.

import { enumMatches, parseMoney } from "./values.ts";
import { valueOf, type AttributeSpec, type Item, type Report, type Target } from "./spec.ts";

const CHECKED = "2026-11-24";
const page = (id: string) => `https://support.google.com/merchants/answer/${id}`;
const SPEC = page("7052112");
const UCP = "https://developers.google.com/merchant/ucp/guides/overview/merchant-center";

const attr = (name: string, rest: Partial<AttributeSpec> = {}): AttributeSpec => ({ name, source: SPEC, checked: CHECKED, ...rest });

// Attributes in the product data specification that are accepted but not checked further.
const KNOWN = [
  "structured_title", "structured_description", "warranty", "unit_pricing_measure", "unit_pricing_base_measure",
  "installment", "subscription_cost", "loyalty_program", "auto_pricing_min_price", "maximum_retail_price",
  "google_product_category", "adult", "is_bundle", "certification", "energy_efficiency_class",
  "min_energy_efficiency_class", "max_energy_efficiency_class", "multipack", "popularity_rank", "product_detail",
  "product_length", "product_width", "product_height", "product_highlight", "product_weight", "question_and_answer",
  "related_product", "size_type", "size_system", "variant_option", "excluded_destination", "included_destination",
  "shopping_ads_excluded_country", "pause", "shipping", "carrier_shipping", "handling_cutoff_time",
  "minimum_order_value", "shipping_weight", "shipping_length", "shipping_width", "shipping_height",
  "ships_from_country", "max_handling_time", "min_handling_time", "shipping_transit_business_days",
  "shipping_handling_business_days", "free_shipping_threshold", "return",
];

const MAX_URL = 2000;

export const GOOGLE_ATTRIBUTES: readonly AttributeSpec[] = [
  attr("id", { required: true, maxLength: 50, unique: true, uniqueIgnoringCase: true, source: page("6324405") }),
  // Google truncates a long title or description and warns, so length is a warning. Either may
  // come as its structured_ version instead (for generative AI text). A product without a
  // description "will receive a warning and may experience limited performance" (answer 6324468).
  attr("title", { required: true, satisfiedBy: ["structured_title"], requiredNote: "Every product needs a title or structured_title.", maxLength: 150, severity: "warning", source: page("6324415") }),
  attr("description", {
    required: true,
    satisfiedBy: ["structured_description"],
    missingSeverity: "warning",
    requiredNote: "Google warns and may limit the product's performance. Submit a description or structured_description.",
    maxLength: 5000,
    severity: "warning",
    source: page("6324468"),
  }),
  attr("link", { required: true, type: "url", maxLength: MAX_URL, source: page("6324416") }),
  attr("image_link", { required: true, type: "url", maxLength: MAX_URL, source: page("6324350") }),
  attr("additional_image_link", { type: "url-list", maxLength: MAX_URL, maxValues: 10, source: page("6324370") }),
  attr("mobile_link", { type: "url", maxLength: MAX_URL }),
  attr("ads_redirect", { type: "url", maxLength: MAX_URL }),
  attr("lifestyle_image_link", { type: "url", maxLength: MAX_URL }),
  attr("video_link", { type: "url", maxLength: MAX_URL }),
  attr("virtual_model_link", { type: "url", maxLength: MAX_URL }),
  attr("document_link", { type: "url-list", maxLength: MAX_URL, maxValues: 5 }),
  // build_to_order is for vehicle ads only, but it is a documented value.
  attr("availability", { required: true, type: "enum", values: ["in_stock", "out_of_stock", "preorder", "backorder", "build_to_order"], source: page("6324448") }),
  attr("availability_date", {
    type: "date",
    maxLength: 25,
    requiredWhen: [{ attribute: "availability", values: ["preorder", "backorder"] }],
    requiredNote: "It is required when availability is preorder or backorder.",
    source: page("6324470"),
  }),
  attr("expiration_date", { type: "date", maxLength: 25 }),
  attr("price", { required: true, type: "money", source: page("6324371") }),
  attr("sale_price", { type: "money", source: page("6324471") }),
  attr("sale_price_effective_date", { type: "date-range", maxLength: 51, source: page("6324460") }),
  attr("cost_of_goods_sold", { type: "money" }),
  attr("condition", { type: "enum", values: ["new", "refurbished", "used"], source: page("6324469") }),
  attr("brand", { maxLength: 70, source: page("6324351") }),
  // Restricted ranges 2, 02, 04 and coupon ranges 05, 98 (981-984), 99, from this page and
  // https://support.google.com/merchants/answer/160161 (unique product identifiers).
  attr("gtin", { type: "gtin", maxValues: 10, restrictedGtinPrefixes: ["02", "04", "05", "2", "98", "99"], source: page("6324461") }),
  attr("mpn", { maxLength: 70, source: page("6324482") }),
  attr("identifier_exists", { type: "enum", values: ["yes", "true", "no", "false"], source: page("6324478") }),
  attr("item_group_id", { maxLength: 50, source: page("6324507") }),
  attr("item_group_title", { maxLength: 150 }),
  attr("product_type", { maxLength: 750 }),
  attr("color", { maxLength: 100 }),
  attr("size", { maxLength: 100 }),
  attr("gender", { type: "enum", values: ["male", "female", "unisex"] }),
  attr("age_group", { type: "enum", values: ["newborn", "infant", "toddler", "kids", "adult"] }),
  attr("material", { maxLength: 200 }),
  attr("pattern", { maxLength: 100 }),
  attr("short_title", { maxLength: 150, severity: "warning" }),
  ...[0, 1, 2, 3, 4].map((n) => attr(`custom_label_${n}`, { maxLength: 100 })),
  attr("promotion_id", { maxLength: 50 }),
  attr("shipping_label", { maxLength: 100 }),
  attr("return_policy_label", { maxLength: 100 }),
  attr("external_seller_id", { maxLength: 50 }),
  // Opts a product into checkout on Google (UCP). A text header may name the sub-attributes,
  // native_commerce(checkout_eligibility:cart_eligibility), with cells like TRUE:FALSE.
  attr("native_commerce", { type: "enum", values: ["true", "false"], source: UCP }),
  attr("merchant_item_id", { source: UCP }),
  attr("consumer_notice", { source: UCP }),
  ...["tax", "tax_category"].map((name) =>
    attr(name, {
      source: page("16098264"),
      retired: "Since July 2025 Google no longer requires US sales tax through tax and tax_category (product data specification update 2025), and the current specification no longer lists them. You can remove them.",
    }),
  ),
  ...KNOWN.map((name) => attr(name)),
];

const isNo = (value: string) => enumMatches(value, ["no", "false"], false);

function checkItem(item: Item, report: Report): void {
  const at = (attribute: string) => ({ line: item.fields.get(attribute)?.[0]?.line ?? item.line, itemId: item.id, attribute });

  // Google: "Don't submit a price of 0" except for contract phones and physical goods subscriptions.
  const price = parseMoney(valueOf(item, "price"), false);
  if (price?.amount === 0) {
    report("price-zero", "warning", "The price is 0. Google allows that only for mobile devices sold with a contract and physical goods sold by subscription.", at("price"));
  }
  const sale = parseMoney(valueOf(item, "sale_price"), false);
  if (price && sale && price.currency === sale.currency && sale.amount >= price.amount) {
    report("sale-price-invalid", "warning", `sale_price ${valueOf(item, "sale_price")} isn't lower than price ${valueOf(item, "price")}. Keep the regular price in price and the lower price in sale_price.`, at("sale_price"));
  }

  // Unique product identifiers (https://support.google.com/merchants/answer/160161).
  const gtin = valueOf(item, "gtin");
  const mpn = valueOf(item, "mpn");
  const brand = valueOf(item, "brand");
  const noIdentifiers = isNo(valueOf(item, "identifier_exists"));
  // "no" fits a product without a GTIN or an MPN and brand pair, and "If set to no, still provide
  // the UPIs you have" (answer 7052112), so an mpn alone isn't a conflict.
  if (noIdentifiers && (gtin || (mpn && brand))) {
    report("identifier-exists-conflict", "warning", `identifier_exists is "${valueOf(item, "identifier_exists")}", but the item has ${gtin ? "a gtin" : "an mpn and a brand"}. Google warns when identifier_exists is set to no for a product with identifiers. Remove identifier_exists, or the identifier if it isn't the manufacturer's.`, at("identifier_exists"));
  } else if (!noIdentifiers && !gtin && !mpn) {
    report("identifier-missing", "warning", "No gtin or mpn. Submit the manufacturer's GTIN if the product has one, otherwise brand and mpn. For custom or one-of-a-kind products with neither, set identifier_exists to no.", at("gtin"));
  } else if (!gtin && mpn && !brand && !noIdentifiers) {
    report("identifier-missing", "warning", "The item has an mpn but no gtin or brand. For a product without a GTIN, submit brand together with mpn.", at("brand"));
  }
}

function checkFeed(items: readonly Item[], report: Report): void {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const group = valueOf(item, "item_group_id");
    if (!group) continue;
    const members = groups.get(group);
    if (members) members.push(item);
    else groups.set(group, [item]);
  }

  // item_group_title must be the same for every variant in a group (answer 6324507).
  for (const [group, members] of groups) {
    const title = valueOf(members[0], "item_group_title");
    const odd = members.find((m) => valueOf(m, "item_group_title") !== title);
    if (odd) {
      report("variant-inconsistent", "warning", `Variants in item group "${group}" have different item_group_title values ("${title}" on item ${members[0].id}). It must be the same for all variants in a group.`, { line: odd.line, itemId: odd.id, attribute: "item_group_title" });
    }
  }

  // Casing doesn't make item group IDs unique, so these groups merge (answer 6324507).
  const byLowerCase = new Map<string, string>();
  for (const group of groups.keys()) {
    const other = byLowerCase.get(group.toLowerCase());
    if (other === undefined) {
      byLowerCase.set(group.toLowerCase(), group);
      continue;
    }
    const first = groups.get(group)![0];
    report("variant-inconsistent", "warning", `Item groups "${other}" and "${group}" differ only in letter case, so Google treats them as one group. Give each group a distinct item_group_id.`, { line: first.line, itemId: first.id, attribute: "item_group_id" });
  }

  // "Don't submit the parent SKU as a separate product" (answer 6324507).
  for (const item of items) {
    if (item.id && !valueOf(item, "item_group_id") && groups.has(item.id)) {
      report("variant-parent-listed", "warning", `Item "${item.id}" has the same id as the item_group_id of ${groups.get(item.id)!.length} variants but isn't in a group itself. If it is the parent product, remove it: submit only the variants.`, { line: item.line, itemId: item.id, attribute: "id" });
    }
  }
}

export const GOOGLE: Target = {
  name: "google",
  label: "Google Merchant Center",
  formats: ["tsv", "xml"],
  idAttribute: "id",
  strict: false,
  // "Alternatively, you can also create multiple separate columns" (answer 14998273).
  repeatedColumns: true,
  attributes: GOOGLE_ATTRIBUTES,
  // The brand entry of the product data specification.
  placeholders: { values: ["n/a", "generic", "no brand", "does not exist"], attributes: ["brand"], source: SPEC },
  checkItem,
  checkFeed,
};
