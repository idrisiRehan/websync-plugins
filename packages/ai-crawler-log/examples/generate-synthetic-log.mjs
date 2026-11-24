// Writes examples/synthetic-access.log: one invented week of an online store's nginx access log
// in the combined format. Every request is made up. Crawler requests use the crawlers' published
// user agents and addresses inside the IP lists their operators published on 2026-11-24; the
// fakes and the visitors use the documentation ranges (RFC 5737 and RFC 3849), which belong to
// nobody. Seeded, so the output is the same on every run.
// Run with: node examples/generate-synthetic-log.mjs > examples/synthetic-access.log

let seed = 20261124;
function random() {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (items) => items[Math.floor(random() * items.length)];
const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

const PRODUCTS = ["wool-runner", "linen-shirt", "trail-sock-3-pack", "canvas-tote", "merino-beanie", "rain-shell", "cork-sandal", "denim-jacket", "travel-mug", "leather-belt"];
const GONE = ["summer-espadrille-2024", "holiday-gift-box", "bamboo-tee-classic"];
const PAGES = ["/", "/collections/all", "/collections/new-arrivals", "/collections/sale", "/pages/about", "/pages/shipping", "/policies/refund-policy", "/blogs/journal/how-to-wash-wool", "/blogs/journal/packing-list"];
const ASSETS = ["/cdn/shop/files/logo.svg", "/cdn/shop/t/4/assets/base.css", "/cdn/shop/t/4/assets/global.js", "/cdn/shop/products/wool-runner_1024x.jpg"];

const product = () => `/products/${pick(PRODUCTS)}`;
const visitorIps = [...range("192.0.2.", 10, 250), ...range("198.51.100.", 2, 120), ...range("2001:db8:4a1::", 10, 99)];
const spoofIps = [...range("203.0.113.", 5, 9), ...range("198.51.100.", 200, 203)];

const UA = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
  "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot",
  "ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  "Claude-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "Perplexity-User": "Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  "meta-externalagent": "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  Amazonbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1) Chrome/119.0.6045.214 Safari/537.36",
  CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  DuckAssistBot: "DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)",
  "MistralAI-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)",
  Googlebot: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.204 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  Applebot: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  bingbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  AhrefsBot: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
};

// Who visits, from where, how often, and what they ask for. `path` returns [path, status].
const ok = (path) => [path, 200];
const crawl = () => (random() < 0.7 ? ok(product()) : ok(pick(PAGES)));
const actors = [
  { ua: () => pick([UA.chrome, UA.safari, UA.firefox]), ips: visitorIps, count: 400, path: () => (random() < 0.3 ? ok(pick(ASSETS)) : random() < 0.5 ? ok(product()) : random() < 0.1 ? ["/cart/add", 302] : ok(pick(PAGES))) },
  { ua: () => UA.GPTBot, ips: [...range("132.196.86.", 10, 40), ...range("172.182.202.", 5, 20)], count: 90, path: () => (random() < 0.04 ? ok("/robots.txt") : random() < 0.03 ? [product(), 503] : crawl()) },
  { ua: () => UA.GPTBot, ips: spoofIps, count: 30, path: () => pick([ok("/wp-login.php"), ["/.env", 404], ok(product()), ["/admin", 302]]) },
  { ua: () => UA["OAI-SearchBot"], ips: range("135.234.64.", 5, 40), count: 40, path: () => (random() < 0.05 ? ok("/robots.txt") : random() < 0.08 ? ok("/sitemap.xml") : crawl()) },
  { ua: () => UA["ChatGPT-User"], ips: range("104.208.184.", 193, 206), count: 20, path: () => ok(product()) },
  { ua: () => UA.ClaudeBot, ips: range("216.73.216.", 2, 90), count: 110, path: () => (random() < 0.03 ? ok("/robots.txt") : random() < 0.02 ? ok("/llms.txt") : random() < 0.2 ? [`/products/${pick(GONE)}`, 404] : crawl()) },
  { ua: () => UA["Claude-User"], ips: range("216.73.217.", 2, 20), count: 6, path: () => ok(product()) },
  { ua: () => UA.PerplexityBot, ips: ["107.20.236.150", ...range("18.97.9.", 100, 103)], count: 30, path: () => (random() < 0.05 ? ok("/robots.txt") : random() < 0.05 ? ok("/llms.txt") : crawl()) },
  { ua: () => UA.PerplexityBot, ips: spoofIps, count: 10, path: () => pick([ok(product()), ["/xmlrpc.php", 404], ok("/collections/all")]) },
  { ua: () => UA["Perplexity-User"], ips: range("18.97.43.", 80, 86), count: 5, path: () => ok(product()) },
  { ua: () => UA["meta-externalagent"], ips: range("2001:db8:fb::", 1, 40), count: 50, path: () => (random() < 0.04 ? ok("/robots.txt") : crawl()) },
  { ua: () => UA.Amazonbot, ips: ["3.81.245.78", "3.81.253.213", "3.85.116.107"], count: 24, path: () => (random() < 0.15 ? [product(), 429] : random() < 0.05 ? ok("/sitemap_products_1.xml") : crawl()) },
  { ua: () => UA.CCBot, ips: range("18.97.9.", 169, 174), count: 12, path: () => (random() < 0.1 ? ok("/robots.txt") : crawl()) },
  { ua: () => UA.DuckAssistBot, ips: ["104.43.54.127"], count: 4, path: () => ok(product()) },
  { ua: () => UA["MistralAI-User"], ips: ["20.240.160.161"], count: 2, path: () => ok(product()) },
  { ua: () => UA.Googlebot, ips: [...range("66.249.64.", 1, 30), ...range("2001:4860:4801:10::", 10, 40)], count: 100, path: () => (random() < 0.03 ? ok("/robots.txt") : random() < 0.05 ? ok("/sitemap.xml") : random() < 0.02 ? [`/products/${pick(GONE)}`, 404] : crawl()) },
  { ua: () => UA.Googlebot, ips: spoofIps, count: 8, path: () => pick([ok("/"), ["/.git/config", 404]]) },
  { ua: () => UA.Applebot, ips: range("17.241.208.", 161, 190), count: 16, path: crawl },
  { ua: () => UA.bingbot, ips: range("192.0.2.", 251, 254), count: 36, path: crawl },
  { ua: () => UA.AhrefsBot, ips: range("198.51.100.", 230, 240), count: 18, path: crawl },
];

const START = Date.UTC(2026, 10, 17);
const WEEK = 7 * 24 * 3600 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n) => String(n).padStart(2, "0");
const clfTime = (ms) => {
  const d = new Date(ms);
  return `${two(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000`;
};

const requests = [];
for (const actor of actors) {
  for (let i = 0; i < actor.count; i++) {
    const [path, status] = actor.path();
    const bytes = status === 200 ? 2000 + Math.floor(random() * 60000) : status === 302 ? 0 : 150 + Math.floor(random() * 400);
    requests.push({ time: START + Math.floor(random() * WEEK), ip: pick(actor.ips), path, status, bytes, ua: actor.ua() });
  }
}
requests.sort((a, b) => a.time - b.time);

const lines = requests.map((r) => `${r.ip} - - [${clfTime(r.time)}] "GET ${r.path} HTTP/1.1" ${r.status} ${r.bytes || "-"} "-" "${r.ua}"`);
// What real logs also hold: a TLS handshake sent to the plain-HTTP port, and a line cut short when the disk filled.
lines.splice(300, 0, `203.0.113.77 - - [18/Nov/2026:09:12:44 +0000] "\\x16\\x03\\x01\\x02\\x00\\x01\\x00\\x01\\xFC\\x03\\x03" 400 157 "-" "-"`);
lines.splice(800, 0, `192.0.2.44 - - [22/Nov/2026:18:40:02 +0000] "GET /products/canvas-to`);
process.stdout.write(`${lines.join("\n")}\n`);
