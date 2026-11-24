// How store-check picks the one child sitemap and the one product page it checks. Deliberately
// conservative: a wrong guess would lint a page that isn't a product, so when nothing matches,
// the product page is skipped instead.

// A product URL is a slug right after a "products" or "product" path segment:
// Shopify:     /products/<handle>, /collections/<c>/products/<handle>, /en-ca/products/<handle>
// WooCommerce: /product/<slug>/ (the default product permalink base)
const PRODUCT_PATH = /\/products?\/[^/]+\/?$/i;

// Gift cards are products to Shopify and WooCommerce, but themes rarely give them Product
// markup, and they are often the first product a store created, so they are passed over.
const GIFT_CARD = /gift-?card/i;

// Shopify names its product sitemaps sitemap_products_1.xml, Yoast SEO product-sitemap.xml and
// WordPress core wp-sitemap-posts-product-1.xml.
const PRODUCT_SITEMAP = /product/i;

/** The child of a sitemap index to read: the first that looks like a product sitemap, else the first. */
export function pickChildSitemap(locs: readonly string[]): string | null {
  return locs.find((loc) => PRODUCT_SITEMAP.test(new URL(loc).pathname)) ?? locs[0] ?? null;
}

/** The first URL on one of the hosts whose path looks like a product page (not a gift card), or null. */
export function pickProductUrl(locs: readonly string[], hosts: readonly string[]): string | null {
  return (
    locs.find((loc) => {
      const url = new URL(loc);
      return hosts.includes(url.host) && PRODUCT_PATH.test(url.pathname) && !GIFT_CARD.test(url.pathname);
    }) ?? null
  );
}
