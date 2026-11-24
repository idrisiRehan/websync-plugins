import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickChildSitemap, pickProductUrl } from "../src/product.ts";

const HOSTS = ["shop.test", "www.shop.test"];

describe("pickProductUrl", () => {
  test("finds Shopify product URLs, with or without a collection or locale prefix", () => {
    assert.equal(pickProductUrl(["https://shop.test/", "https://shop.test/products/wool-runner"], HOSTS), "https://shop.test/products/wool-runner");
    assert.equal(pickProductUrl(["https://shop.test/collections/men/products/wool-runner"], HOSTS), "https://shop.test/collections/men/products/wool-runner");
    assert.equal(pickProductUrl(["https://shop.test/en-ca/products/wool-runner"], HOSTS), "https://shop.test/en-ca/products/wool-runner");
  });

  test("finds WooCommerce product URLs", () => {
    assert.equal(pickProductUrl(["https://www.shop.test/shop/", "https://www.shop.test/product/blue-mug/"], HOSTS), "https://www.shop.test/product/blue-mug/");
  });

  test("skips listings, categories and other hosts", () => {
    const locs = ["https://shop.test/products/", "https://shop.test/product-category/mugs/", "https://shop.test/product/mugs/blue-mug/", "https://cdn.test/products/wool-runner"];
    assert.equal(pickProductUrl(locs, HOSTS), null);
    assert.equal(pickProductUrl([], HOSTS), null);
  });

  test("passes over gift cards", () => {
    const locs = ["https://shop.test/products/gift-card", "https://shop.test/products/egiftcard", "https://shop.test/products/wool-runner"];
    assert.equal(pickProductUrl(locs, HOSTS), "https://shop.test/products/wool-runner");
  });
});

describe("pickChildSitemap", () => {
  test("prefers the product sitemap of Shopify, Yoast SEO and WordPress core", () => {
    assert.equal(pickChildSitemap(["https://shop.test/sitemap_pages_1.xml", "https://shop.test/sitemap_products_1.xml?from=1&to=9"]), "https://shop.test/sitemap_products_1.xml?from=1&to=9");
    assert.equal(pickChildSitemap(["https://shop.test/post-sitemap.xml", "https://shop.test/product-sitemap.xml"]), "https://shop.test/product-sitemap.xml");
    assert.equal(pickChildSitemap(["https://shop.test/wp-sitemap-posts-page-1.xml", "https://shop.test/wp-sitemap-posts-product-1.xml"]), "https://shop.test/wp-sitemap-posts-product-1.xml");
  });

  test("falls back to the first child, or null for an empty index", () => {
    assert.equal(pickChildSitemap(["https://shop.test/a.xml", "https://shop.test/b.xml"]), "https://shop.test/a.xml");
    assert.equal(pickChildSitemap([]), null);
  });
});
