import { runRules, type ProductCsvResult } from "./core.ts";
import { detectDelimiter, parseCsv } from "./csv.ts";
import { shopify, SHOPIFY_MARKERS } from "./shopify.ts";
import { woocommerce, WOOCOMMERCE_MARKERS } from "./woocommerce.ts";

export type Platform = "shopify" | "woocommerce";

const RULES = { shopify, woocommerce };

/** Lints a product CSV for one platform. Pass bytes to have UTF-8 validity checked too. */
export function lintProductCsv(input: string | Uint8Array, platform: Platform): ProductCsvResult {
  return runRules(input, RULES[platform]);
}

/**
 * Guesses the platform from the header row: "shopify", "woocommerce", or null when the
 * headers don't clearly belong to either.
 */
export function detectPlatform(input: string | Uint8Array): Platform | null {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input.subarray(0, 64 * 1024));
  const firstRecord = parseCsv(text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "", detectDelimiter(text)).records[0];
  const headers = new Set((firstRecord?.cells ?? []).map((h) => h.trim().toLowerCase()));
  const score = (markers: string[]) => markers.filter((m) => headers.has(m.toLowerCase())).length;
  const s = score(SHOPIFY_MARKERS);
  const w = score(WOOCOMMERCE_MARKERS);
  return s > w ? "shopify" : w > s ? "woocommerce" : null;
}
