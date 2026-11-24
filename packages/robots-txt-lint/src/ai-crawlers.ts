// AI crawler product tokens as data. Upkeep means editing one entry: each one names the operator's
// own documentation page it was taken from and the date it was last compared with it. Only tokens
// an operator documents for robots.txt are listed. Operators add and rename crawlers often, so
// recheck the list every quarter.

/**
 * training: collects content that may be used to train models.
 * search: indexes pages for an AI search or answer product.
 * user: fetches a page when a person asks the assistant to.
 * dataset: builds a public crawl dataset that others reuse.
 */
export type AiCrawlerPurpose = "training" | "search" | "user" | "dataset";

export interface AiCrawler {
  /** The product token for the User-agent line. */
  token: string;
  operator: string;
  purpose: AiCrawlerPurpose;
  /** The operator's page that documents the token. */
  source: string;
  /** Date the entry was last compared with `source`. */
  checked: string;
  /** What the operator says that changes how robots.txt applies. */
  note?: string;
  /**
   * The product name the crawler's User-Agent header carries, or null for a token that only
   * controls robots.txt and sends no requests under a user agent of its own.
   */
  userAgent: string | null;
  /** The list of the crawler's IP addresses that `source` links to, or null when it links to none. */
  ipRanges: string | null;
}

const OPENAI = "https://developers.openai.com/api/docs/bots";
const ANTHROPIC = "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const GOOGLE = "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended";
const APPLE = "https://support.apple.com/en-us/119829";
const PERPLEXITY = "https://docs.perplexity.ai/docs/resources/perplexity-crawlers";
const META = "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers";
const AMAZON = "https://developer.amazon.com/amazonbot";
const MISTRAL = "https://docs.mistral.ai/robots";

// Anthropic's page names its bots and links one IP list for all three, but shows no example
// User-Agent header; the header is taken to carry the token, as every other operator's does.
const ANTHROPIC_IPS = "https://claude.com/crawling/bots.json";

export const AI_CRAWLERS: readonly AiCrawler[] = [
  { token: "GPTBot", operator: "OpenAI", purpose: "training", source: OPENAI, checked: "2026-11-24", userAgent: "GPTBot", ipRanges: "https://openai.com/gptbot.json" },
  { token: "OAI-SearchBot", operator: "OpenAI", purpose: "search", source: OPENAI, checked: "2026-11-24", userAgent: "OAI-SearchBot", ipRanges: "https://openai.com/searchbot.json" },
  {
    token: "ChatGPT-User",
    operator: "OpenAI",
    purpose: "user",
    source: OPENAI,
    checked: "2026-11-24",
    note: "OpenAI says robots.txt rules may not apply, because a user starts these fetches.",
    userAgent: "ChatGPT-User",
    ipRanges: "https://openai.com/chatgpt-user.json",
  },
  {
    token: "ClaudeBot",
    operator: "Anthropic",
    purpose: "training",
    source: ANTHROPIC,
    checked: "2026-11-24",
    note: "When robots.txt doesn't name ClaudeBot, Anthropic says it follows the site's general AI training preference (an IETF aipref draft signal).",
    userAgent: "ClaudeBot",
    ipRanges: ANTHROPIC_IPS,
  },
  { token: "Claude-SearchBot", operator: "Anthropic", purpose: "search", source: ANTHROPIC, checked: "2026-11-24", userAgent: "Claude-SearchBot", ipRanges: ANTHROPIC_IPS },
  { token: "Claude-User", operator: "Anthropic", purpose: "user", source: ANTHROPIC, checked: "2026-11-24", userAgent: "Claude-User", ipRanges: ANTHROPIC_IPS },
  {
    token: "Google-Extended",
    operator: "Google",
    purpose: "training",
    source: GOOGLE,
    checked: "2026-11-24",
    note: "A control token, not a crawler: Google crawls with its usual user agents. It also covers grounding in Gemini, and doesn't affect Google Search.",
    userAgent: null,
    ipRanges: null,
  },
  {
    token: "Applebot-Extended",
    operator: "Apple",
    purpose: "training",
    source: APPLE,
    checked: "2026-11-24",
    note: "Doesn't crawl: it decides whether pages Applebot crawled may train Apple's foundation models.",
    userAgent: null,
    ipRanges: null,
  },
  { token: "PerplexityBot", operator: "Perplexity", purpose: "search", source: PERPLEXITY, checked: "2026-11-24", userAgent: "PerplexityBot", ipRanges: "https://www.perplexity.ai/perplexitybot.json" },
  {
    token: "Perplexity-User",
    operator: "Perplexity",
    purpose: "user",
    source: PERPLEXITY,
    checked: "2026-11-24",
    note: "Perplexity says it generally ignores robots.txt rules, because a user requested the fetch.",
    userAgent: "Perplexity-User",
    ipRanges: "https://www.perplexity.ai/perplexity-user.json",
  },
  { token: "meta-externalagent", operator: "Meta", purpose: "training", source: META, checked: "2026-11-24", userAgent: "meta-externalagent", ipRanges: null },
  { token: "meta-webindexer", operator: "Meta", purpose: "search", source: META, checked: "2026-11-24", userAgent: "meta-webindexer", ipRanges: null },
  {
    token: "meta-externalfetcher",
    operator: "Meta",
    purpose: "user",
    source: META,
    checked: "2026-11-24",
    note: "Meta says it may bypass robots.txt, because a user requested the fetch.",
    userAgent: "meta-externalfetcher",
    ipRanges: null,
  },
  { token: "Amazonbot", operator: "Amazon", purpose: "training", source: AMAZON, checked: "2026-11-24", userAgent: "Amazonbot", ipRanges: "https://developer.amazon.com/amazonbot/ip-addresses/" },
  {
    token: "Amzn-SearchBot",
    operator: "Amazon",
    purpose: "search",
    source: AMAZON,
    checked: "2026-11-24",
    note: "When robots.txt doesn't name it but allows other search bots, Amazon says it follows the rules given to those bots.",
    userAgent: "Amzn-SearchBot",
    ipRanges: "https://developer.amazon.com/amazonbot/searchbot-ip-addresses/",
  },
  {
    token: "Amzn-User",
    operator: "Amazon",
    purpose: "user",
    source: AMAZON,
    checked: "2026-11-24",
    note: "Amazon says it may not follow all robots.txt directives, because a user can start these fetches.",
    userAgent: "Amzn-User",
    ipRanges: "https://developer.amazon.com/amazonbot/live-ip-addresses/",
  },
  { token: "MistralAI-Training", operator: "Mistral AI", purpose: "training", source: MISTRAL, checked: "2026-11-24", userAgent: "MistralAI-Training", ipRanges: null },
  { token: "MistralAI-Index", operator: "Mistral AI", purpose: "search", source: MISTRAL, checked: "2026-11-24", userAgent: "MistralAI-Index", ipRanges: "https://mistral.ai/mistralai-index-ips.json" },
  { token: "MistralAI-User", operator: "Mistral AI", purpose: "user", source: MISTRAL, checked: "2026-11-24", userAgent: "MistralAI-User", ipRanges: "https://mistral.ai/mistralai-user-ips.json" },
  {
    token: "DuckAssistBot",
    operator: "DuckDuckGo",
    purpose: "search",
    source: "https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot",
    checked: "2026-11-24",
    userAgent: "DuckAssistBot",
    ipRanges: "https://duckduckgo.com/duckassistbot.json",
  },
  { token: "CCBot", operator: "Common Crawl", purpose: "dataset", source: "https://commoncrawl.org/ccbot", checked: "2026-11-24", userAgent: "CCBot", ipRanges: "https://index.commoncrawl.org/ccbot.json" },
];
