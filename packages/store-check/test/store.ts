// A fake store on a local HTTP server, so no test touches the external network. A store is a
// table of path -> response; healthyStore() builds a complete, valid one, and tests break it
// one route at a time.

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

export type Route = { status?: number; headers?: Record<string, string>; body?: string | Uint8Array } | ((req: IncomingMessage, res: ServerResponse) => void);
export type Routes = Record<string, Route>;

export interface Store {
  base: string;
  host: string;
  /** The live route table, so routes that name the store's own origin can be added after it starts. */
  routes: Routes;
  /** Every request received, in order. */
  requests: { url: string; headers: IncomingHttpHeaders }[];
  close: () => void;
}

const NOT_FOUND = `<!doctype html>
<html><head><title>Page not found</title></head>
<body><h1>404</h1><p>The page you were looking for does not exist.</p></body></html>`;

export async function startStore(routes: Routes): Promise<Store> {
  const requests: Store["requests"] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? "/", headers: req.headers });
    const route = routes[req.url ?? "/"];
    if (typeof route === "function") return route(req, res);
    const { status = 200, headers = {}, body = "" } = route ?? { status: 404, headers: { "content-type": "text/html; charset=utf-8" }, body: NOT_FOUND };
    res.writeHead(status, headers);
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    routes,
    requests,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/**
 * A fetch that serves https://shop.test (and any host in `hosts`) from the local store, so tests
 * can check an https store. `redirects` answers listed URLs with a 301; http://shop.test/
 * redirects to https unless `plainHttp` is set, in which case the store serves it too.
 */
export function storeFetch(store: Store, options: { redirects?: Record<string, string>; plainHttp?: boolean; hosts?: string[] } = {}): typeof fetch {
  const hosts = ["shop.test", ...(options.hosts ?? [])];
  return async (input, init) => {
    const url = new URL(String(input));
    const target = options.redirects?.[url.href];
    if (target) return new Response(null, { status: 301, headers: { location: target } });
    if (!hosts.includes(url.host)) throw new TypeError(`fetch failed: unexpected host ${url.host}`);
    if (url.protocol === "http:" && !options.plainHttp) {
      return new Response(null, { status: 301, headers: { location: url.href.replace("http:", "https:") } });
    }
    return fetch(`${store.base}${url.pathname}${url.search}`, init);
  };
}

export const SECURE_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; img-src 'self' https:; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

const html = (body: string) => ({ headers: { "content-type": "text/html; charset=utf-8", ...SECURE_HEADERS }, body });
const xml = (body: string) => ({ headers: { "content-type": "application/xml" }, body });
const text = (body: string) => ({ headers: { "content-type": "text/plain; charset=utf-8" }, body });

export function page(origin: string, path: string, title: string, description: string, jsonLd: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${origin}${path}">
<meta property="og:title" content="${title}">
<meta property="og:type" content="website">
<meta property="og:image" content="${origin}/images/share.jpg">
<meta property="og:url" content="${origin}${path}">
<meta name="twitter:card" content="summary_large_image">
${jsonLd}
</head>
<body>
<h1>${title}</h1>
<p>Comfortable shoes made from natural materials.</p>
</body>
</html>`;
}

export const ldScript = (json: string) => `<script type="application/ld+json">${json}</script>`;

export function organizationLd(origin: string): string {
  return ldScript(`{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Example Shoes",
  "url": "${origin}/",
  "logo": "${origin}/images/logo.png",
  "sameAs": ["https://www.instagram.com/exampleshoes"],
  "description": "Comfortable shoes made from natural materials."
}`);
}

export function productLd(origin: string): string {
  return ldScript(`{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Wool Runner",
  "image": ["${origin}/images/wool-runner.jpg"],
  "description": "Our everyday sneaker, made from merino wool.",
  "sku": "WR-001",
  "mpn": "WR-001",
  "gtin13": "4006381333931",
  "brand": { "@type": "Brand", "name": "Example Shoes" },
  "aggregateRating": { "@type": "AggregateRating", "ratingValue": 4.6, "reviewCount": 120 },
  "review": {
    "@type": "Review",
    "author": { "@type": "Person", "name": "Sam Lee" },
    "reviewRating": { "@type": "Rating", "ratingValue": 5 },
    "datePublished": "2026-10-01"
  },
  "offers": {
    "@type": "Offer",
    "url": "${origin}/products/wool-runner",
    "price": "98.00",
    "priceCurrency": "USD",
    "priceValidUntil": "2027-12-31",
    "availability": "https://schema.org/InStock",
    "itemCondition": "https://schema.org/NewCondition",
    "shippingDetails": { "@type": "OfferShippingDetails", "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "USD" } },
    "hasMerchantReturnPolicy": { "@type": "MerchantReturnPolicy", "applicableCountry": "US", "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow", "merchantReturnDays": 30 }
  }
}`);
}

const HOME_TITLE = "Example Shoes: Comfortable Wool Sneakers";
const HOME_DESCRIPTION = "Comfortable sneakers and flats made from merino wool and eucalyptus fibre. Free shipping and free returns on every order, every day.";
const PRODUCT_TITLE = "Wool Runner, Men's Everyday Sneaker | Example Shoes";
const PRODUCT_DESCRIPTION = "The Wool Runner is our everyday sneaker, made from soft merino wool that keeps feet cool in summer and warm in winter. Free returns.";

export function homePage(origin: string): string {
  return page(origin, "/", HOME_TITLE, HOME_DESCRIPTION, organizationLd(origin));
}

export function productPage(origin: string, jsonLd = productLd(origin)): string {
  return page(origin, "/products/wool-runner", PRODUCT_TITLE, PRODUCT_DESCRIPTION, jsonLd);
}

export function urlset(locs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `  <url><loc>${loc}</loc><lastmod>2026-11-01</lastmod></url>`).join("\n")}
</urlset>`;
}

export function sitemapIndex(locs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>`).join("\n")}
</sitemapindex>`;
}

export function robotsTxt(origin: string): string {
  return `User-agent: *
Disallow: /cart
Disallow: /checkout

User-agent: GPTBot
Disallow: /

Sitemap: ${origin}/sitemap.xml
`;
}

export function llmsTxt(origin: string): string {
  return `# Example Shoes

> Comfortable shoes made from natural materials, shipped worldwide.

## Products

- [Wool Runner](${origin}/products/wool-runner): Our everyday sneaker.

## Policies

- [Shipping](${origin}/policies/shipping-policy): Delivery times and costs.
`;
}

/** A complete store with no errors: a Shopify-style sitemap index, a valid Product page and every security header. */
export function healthyStore(origin: string): Routes {
  return {
    "/": html(homePage(origin)),
    "/robots.txt": text(robotsTxt(origin)),
    "/sitemap.xml": xml(sitemapIndex([`${origin}/sitemap_pages_1.xml`, `${origin}/sitemap_products_1.xml`, `${origin}/sitemap_collections_1.xml`])),
    "/sitemap_products_1.xml": xml(urlset([`${origin}/collections/all`, `${origin}/products/wool-runner`, `${origin}/products/tree-dasher`])),
    "/products/wool-runner": html(productPage(origin)),
    "/llms.txt": { headers: { "content-type": "text/markdown; charset=utf-8" }, body: llmsTxt(origin) },
  };
}

export { html, xml, text };

export function gzipped(body: string): Route {
  return { headers: { "content-type": "application/x-gzip" }, body: gzipSync(body) };
}

/** A body that never ends, to test the byte caps. */
export function endless(contentType: string): Route {
  return (_req, res) => {
    res.writeHead(200, { "content-type": contentType });
    const timer = setInterval(() => res.write("x".repeat(64 * 1024)), 1);
    res.on("close", () => clearInterval(timer));
  };
}

/** Never answers, to test timeouts. */
export const silent: Route = () => {};
