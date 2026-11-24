import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AI_CRAWLERS } from "robots-txt-lint";
import { CRAWLERS, RANGE_URLS, SEARCH_CRAWLERS, matchCrawler } from "../src/crawlers.ts";

const token = (ua: string) => matchCrawler(ua)?.token ?? null;

describe("matchCrawler", () => {
  test("finds each operator's documented user agent", () => {
    const cases: [string, string][] = [
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot", "GPTBot"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot", "OAI-SearchBot"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ChatGPT-User"],
      ["Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "PerplexityBot"],
      ["Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", "Perplexity-User"],
      ["meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", "meta-externalagent"],
      ["meta-externalfetcher/1.1", "meta-externalfetcher"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1) Chrome/W.X.Y.Z Safari/537.36", "Amzn-SearchBot"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)", "MistralAI-User"],
      ["DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)", "DuckAssistBot"],
      ["CCBot/2.0 (https://commoncrawl.org/faq/)", "CCBot"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36", "Googlebot"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)", "Applebot"],
      // The rest of the strings the operators' pages show, as read on 2026-11-24.
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot", "OAI-SearchBot"],
      ["meta-webindexer/1.1 (+/documentation/sharing/webmasters/web-crawlers)", "meta-webindexer"],
      ["meta-externalagent/1.1", "meta-externalagent"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1) Chrome/W.X.Y.Z Safari/537.36", "Amazonbot"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-User/0.1) Chrome/W.X.Y.Z Safari/537.36", "Amzn-User"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-Index/1.0; +https://docs.mistral.ai/robots)", "MistralAI-Index"],
      ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-Training/1.0; +https://docs.mistral.ai/robots)", "MistralAI-Training"],
      ["Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot"],
      ["Googlebot/2.1 (+http://www.google.com/bot.html)", "Googlebot"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1 (Applebot/0.1; +http://www.apple.com/go/applebot)", "Applebot"],
    ];
    for (const [ua, expected] of cases) assert.equal(token(ua), expected, ua);
  });

  test("ignores case and version numbers", () => {
    assert.equal(token("gptbot"), "GPTBot");
    assert.equal(token("GPTBOT/9.9"), "GPTBot");
    assert.equal(token("claudebot/1.0 (+claudebot@anthropic.com)"), "ClaudeBot");
    assert.equal(token("Mozilla/5.0 (compatible; Claude-SearchBot/2.0)"), "Claude-SearchBot");
  });

  test("a name inside a longer product name doesn't count", () => {
    for (const ua of ["NotGPTBot/1.0", "GPTBotX/1.0", "MyCCBot", "Googlebot-Image/1.0", "Googlebot-Video/1.0", "Storebot-Google/1.0", "Applebot_Fake", "ClaudeBot2", "xClaude-User"]) {
      assert.equal(token(ua), null, ua);
    }
    // Names that share a prefix stay apart.
    assert.equal(token("Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)"), "Claude-User");
    assert.equal(token("Mozilla/5.0 (compatible; Perplexity-User/1.0)"), "Perplexity-User");
    assert.equal(token("meta-externalfetcher/1.1 (+/documentation/sharing/webmasters/web-crawlers)"), "meta-externalfetcher");
    for (const ua of ["Mozilla/5.0 (compatible; Claude-Agent/1.0)", "Mozilla/5.0 (compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot)", "meta-externalads/1.1", "facebookexternalhit/1.1"]) {
      assert.equal(token(ua), null, ua);
    }
  });

  test("control tokens that never crawl are never matched", () => {
    assert.equal(token("Mozilla/5.0 (compatible; Google-Extended/1.0)"), null);
    assert.equal(token("Applebot-Extended/0.1"), null);
    assert.ok(!CRAWLERS.some((c) => c.token === "Google-Extended" || c.token === "Applebot-Extended"));
  });

  test("browsers, other bots and empty values are no crawler", () => {
    for (const ua of ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36", "Mozilla/5.0 (compatible; bingbot/2.0)", "", "-"]) {
      assert.equal(token(ua), null, ua);
    }
    assert.equal(matchCrawler(null as unknown as string), null);
  });

  test("stays fast on a long user agent full of near misses", () => {
    const ua = "gptbotx".repeat(20_000);
    const start = performance.now();
    assert.equal(token(ua), null);
    assert.ok(performance.now() - start < 500);
  });
});

describe("the crawler table", () => {
  test("holds every AI crawler that sends a user agent, then the search engines", () => {
    const ai = AI_CRAWLERS.filter((c) => c.userAgent !== null).map((c) => c.token);
    assert.deepEqual(CRAWLERS.map((c) => c.token), [...ai, ...SEARCH_CRAWLERS.map((c) => c.token)]);
    assert.ok(CRAWLERS.every((c) => (c.kind === "ai") === (c.purpose !== null)));
  });

  test("search engine entries are sourced and point at https IP lists", () => {
    for (const c of SEARCH_CRAWLERS) {
      assert.match(c.source, /^https:\/\//);
      assert.match(c.ipRanges, /^https:\/\//);
      assert.match(c.checked, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("RANGE_URLS lists each IP list once", () => {
    assert.equal(new Set(RANGE_URLS).size, RANGE_URLS.length);
    assert.deepEqual(new Set(RANGE_URLS), new Set(CRAWLERS.flatMap((c) => (c.ipRanges ? [c.ipRanges] : []))));
    assert.ok(RANGE_URLS.includes("https://openai.com/gptbot.json"));
  });
});
