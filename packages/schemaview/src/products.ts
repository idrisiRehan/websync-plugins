// Reads the Product and Offer data in a page's JSON-LD: identifiers, offers, prices,
// availability and variant groups, with lines and paths. It reads what is there and checks
// nothing; validateStructuredData() does the checking. Pure and offline.

import { extractJsonLd } from "./extract.ts";
import { idOf, index, isReference, typesOf, valuesOf, SCHEMA_ORG_PREFIX, type Graph } from "./graph.ts";
import { parseJson, type JsonNode, type JsonObject } from "./json.ts";

export interface PriceSpecificationData {
  types: string[];
  price: string | null;
  priceCurrency: string | null;
  /** priceType without a schema.org prefix ("StrikethroughPrice"), or null: Google marks only the original price with it. */
  priceType: string | null;
  /** Whether validForMemberTier is set: a loyalty program's member price, not the active price. */
  memberPrice: boolean;
  validFrom: string | null;
  validThrough: string | null;
  line: number;
  path: string;
}

export interface OfferData {
  /** @type values without a schema.org prefix, such as ["Offer"] or ["AggregateOffer"]. */
  types: string[];
  /** As written. A JSON number is given in its shortest decimal form (18.00 becomes "18"). */
  price: string | null;
  priceCurrency: string | null;
  lowPrice: string | null;
  highPrice: string | null;
  /** Without a schema.org prefix, such as "InStock". */
  availability: string | null;
  priceSpecifications: PriceSpecificationData[];
  url: string | null;
  sku: string | null;
  /** gtin, gtin8, gtin12, gtin13 and gtin14 values, as written. */
  gtins: string[];
  mpn: string | null;
  validFrom: string | null;
  validThrough: string | null;
  priceValidUntil: string | null;
  line: number;
  path: string;
}

export interface ProductData {
  /** @type values without a schema.org prefix, such as ["Product"] or ["ProductGroup"]. */
  types: string[];
  id: string | null;
  name: string | null;
  sku: string | null;
  gtins: string[];
  mpn: string | null;
  url: string | null;
  /** A ProductGroup's productGroupID, or a variant's inProductGroupWithID (else its group's productGroupID). */
  productGroupID: string | null;
  /** The ProductGroup this product is a variant of (through hasVariant or isVariantOf), or null. */
  group: { id: string | null; productGroupID: string | null; line: number; path: string } | null;
  /** The product's offers; an AggregateOffer's own offers follow it. */
  offers: OfferData[];
  line: number;
  path: string;
}

export interface ProductsResult {
  format: "html" | "json";
  /** JSON-LD blocks found (scripts in HTML, or 1 for raw JSON). */
  blockCount: number;
  /** Blocks that are empty or not valid JSON, which search engines ignore. validateStructuredData() says why. */
  unreadableBlockCount: number;
  /** The HTML carries Microdata or RDFa attributes, which are not read. */
  otherSyntax: boolean;
  /** Every Product node (Product, ProductGroup and Product subtypes), in document order. */
  products: ProductData[];
}

// Product and its schema.org subtypes.
const PRODUCT_TYPES = new Set(["Product", "ProductGroup", "ProductModel", "IndividualProduct", "SomeProducts", "ProductCollection", "Vehicle", "Car", "Motorcycle", "BusOrCoach", "MotorizedBicycle"]);
// Properties that point at other products (related items, accessories) or are read separately.
const NOT_THIS_PAGE = new Set(["@context", "offers", "isRelatedTo", "isSimilarTo", "isAccessoryOrSparePartFor", "isConsumableFor", "isVariantOf", "review"]);
const GTIN_KEYS = ["gtin", "gtin8", "gtin12", "gtin13", "gtin14"];

function text(node: JsonNode | undefined): string | null {
  if (!node) return null;
  if (node.kind === "string") return node.value.trim();
  if (node.kind === "number") return String(node.value);
  // An enumeration value may be written as a node reference: { "@id": "https://schema.org/InStock" }.
  if (node.kind === "object") return idOf(node)?.trim() ?? null;
  return null;
}

const isProduct = (node: JsonObject) => (typesOf(node) ?? []).some((t) => PRODUCT_TYPES.has(t));

/** Reads the Product data in an HTML page or a raw JSON-LD document. Never throws. */
export function readProducts(input: string): ProductsResult {
  const { format, blocks, otherSyntax } = extractJsonLd(input);
  const graph: Graph = { paths: new Map(), ids: new Map() };
  const roots: JsonNode[] = [];
  let unreadableBlockCount = 0;
  for (const block of blocks) {
    const parsed = block.text.trim() ? parseJson(block.text, block.line) : null;
    if (parsed?.ok) roots.push(parsed.value);
    else unreadableBlockCount++;
  }
  // All blocks are indexed first: an @id in one script can be referenced from another.
  for (const root of roots) index(graph, root, "$");

  const first = (node: JsonObject, key: string) => text(valuesOf(graph, node, key)[0]);
  const where = (node: JsonObject) => ({ line: node.line, path: graph.paths.get(node) ?? "$" });
  const objects = (node: JsonObject, key: string) => valuesOf(graph, node, key).filter((v): v is JsonObject => v.kind === "object");
  const enumValue = (node: JsonObject, key: string) => first(node, key)?.replace(SCHEMA_ORG_PREFIX, "") ?? null;
  const identifiers = (node: JsonObject) => ({
    url: first(node, "url"),
    sku: first(node, "sku"),
    gtins: GTIN_KEYS.flatMap((key) => valuesOf(graph, node, key).map(text).filter((v): v is string => !!v)),
    mpn: first(node, "mpn"),
  });

  const offer = (node: JsonObject): OfferData => ({
    types: typesOf(node) ?? [],
    price: first(node, "price"),
    priceCurrency: first(node, "priceCurrency"),
    lowPrice: first(node, "lowPrice"),
    highPrice: first(node, "highPrice"),
    availability: enumValue(node, "availability"),
    priceSpecifications: objects(node, "priceSpecification").map((spec) => ({
      types: typesOf(spec) ?? [],
      price: first(spec, "price"),
      priceCurrency: first(spec, "priceCurrency"),
      priceType: enumValue(spec, "priceType"),
      memberPrice: valuesOf(graph, spec, "validForMemberTier").length > 0,
      validFrom: first(spec, "validFrom"),
      validThrough: first(spec, "validThrough"),
      ...where(spec),
    })),
    ...identifiers(node),
    validFrom: first(node, "validFrom"),
    validThrough: first(node, "validThrough"),
    priceValidUntil: first(node, "priceValidUntil"),
    ...where(node),
  });

  // Which ProductGroup each variant belongs to, whichever side of the link is written.
  const groupOf = new Map<JsonObject, JsonObject>();
  for (const node of graph.paths.keys()) {
    if (node.kind !== "object" || isReference(node)) continue;
    const types = typesOf(node) ?? [];
    if (types.includes("ProductGroup")) for (const variant of objects(node, "hasVariant")) if (!groupOf.has(variant)) groupOf.set(variant, node);
    const parent = objects(node, "isVariantOf")[0];
    if (parent && isProduct(node) && !groupOf.has(node)) groupOf.set(node, parent);
  }

  const products: ProductData[] = [];
  const seenIds = new Set<string>();
  const visit = (node: JsonNode): void => {
    if (node.kind === "array") {
      for (const item of node.items) visit(item);
      return;
    }
    if (node.kind !== "object") return;
    const id = idOf(node);
    // JSON-LD merges nodes with the same @id, and valuesOf() reads them merged, so one is enough.
    if (isProduct(node) && !(id !== null && seenIds.has(id))) {
      if (id !== null) seenIds.add(id);
      const group = groupOf.get(node);
      const groupId = group ? first(group, "productGroupID") : null;
      products.push({
        types: typesOf(node) ?? [],
        id,
        name: first(node, "name"),
        ...identifiers(node),
        productGroupID: first(node, "productGroupID") ?? first(node, "inProductGroupWithID") ?? groupId,
        group: group ? { id: idOf(group), productGroupID: groupId, ...where(group) } : null,
        offers: objects(node, "offers").flatMap((o) => [offer(o), ...objects(o, "offers").map(offer)]),
        ...where(node),
      });
    }
    for (const [key, value] of node.props) if (!NOT_THIS_PAGE.has(key)) visit(value);
  };
  for (const root of roots) visit(root);

  return { format, blockCount: blocks.length, unreadableBlockCount, otherSyntax, products };
}
