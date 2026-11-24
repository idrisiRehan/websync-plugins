// Serves the example product pages at http://127.0.0.1:8080/products/<name>, the links in
// google-feed.tsv, so the CLI can be tried without a store:
//
//   node examples/serve.mjs
//   npx feed-page-check examples/google-feed.tsv
//
// The query string is ignored, as a store ignores ?size=s when it renders one page for all sizes.
// Any other path answers 404.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.argv[2] ?? 8080);
const pages = new URL("./pages/", import.meta.url);

createServer(async (req, res) => {
  const name = /^\/products\/([a-z-]+)(?:\?|$)/.exec(req.url ?? "")?.[1];
  try {
    if (!name) throw new Error("not a product");
    const html = await readFile(new URL(`${name}.html`, pages));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  } catch {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end("<h1>Not found</h1>");
  }
}).listen(port, "127.0.0.1", () => console.log(`Serving the example pages at http://127.0.0.1:${port}/products/`));
