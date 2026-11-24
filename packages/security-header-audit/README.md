# security-header-audit

Grade a response's HTTP security headers, and get a reason for every result that follows the
relevant spec.

```text
$ npx security-header-audit --raw examples/headers.txt
examples/headers.txt
Score 68/100 (needs-work)

FAIL  Strict-Transport-Security (-15)
      Missing. Without HSTS, a visitor's first request (or one after a cleared cache) can still be intercepted over plain HTTP before any redirect to HTTPS happens.
WARN  Content-Security-Policy (-5)
      Present, but allows 'unsafe-inline' for scripts and event handlers - these significantly weaken CSP's protection against injected code.
PASS  X-Content-Type-Options
      Set to "nosniff".
PASS  Clickjacking protection
      X-Frame-Options: SAMEORIGIN
...
```

- **Offline library.** `analyzeHeaders()` reads headers you already have: a fetch `Headers`
  object, Node's `res.headers`, or a plain object. It makes no network calls, so it runs in
  Node, browsers, edge runtimes and test suites.
- **Spec-accurate.** CSP is read per CSP Level 3, including fallback directives, multiple
  policies, nonces, hashes, `'strict-dynamic'` and `'wasm-unsafe-eval'`. HSTS follows RFC 6797,
  X-Frame-Options follows the HTML Standard, and X-Content-Type-Options follows the Fetch
  Standard. Each rule's source comment cites its section.
- **CLI for CI.** `--min-score` fails a pipeline when headers regress. `--raw -` grades
  `curl -sI` output, so you don't need a second HTTP client.
- **Zero dependencies.** TypeScript types are included.

The same rules power the free [Security Header Checker](https://websync.in/tools/security-header-checker/)
on websync.in.

## Install

```sh
npm install security-header-audit
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later.

## Library

```ts
import { analyzeHeaders } from "security-header-audit";

const res = await fetch("https://example.com", { method: "HEAD" });
const result = analyzeHeaders(res.headers);

result.score;   // 0-100
result.rating;  // "strong" (80+), "needs-work" (50-79) or "weak" (below 50)
result.rules;   // one entry per check, always in the same order
```

Each rule:

```ts
interface HeaderRule {
  id: string;           // stable, e.g. "hsts-short", "csp-unsafe", "clickjack-ok"
  name: string;         // "Strict-Transport-Security", "Clickjacking protection", ...
  category: "Transport" | "Content Security" | "Clickjacking" | "Privacy" | "Disclosure";
  status: "passed" | "warning" | "failed";
  message: string;      // what was found and why it matters
  scoreImpact: number;  // points deducted; 0 when passed
}
```

### Asserting headers in tests

Because it takes any header object, you can check your own app's responses in an existing
test suite without starting a scanner:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHeaders } from "security-header-audit";

test("home page keeps its security headers", async () => {
  const res = await fetch("http://localhost:3000/");
  await res.body?.cancel();
  const { score, rules } = analyzeHeaders(res.headers);
  const failed = rules.filter((r) => r.status === "failed").map((r) => r.name);
  assert.deepEqual(failed, []);
  assert.ok(score >= 90, `score ${score}`);
});
```

A runnable version is in [examples/assert-headers.test.mjs](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/security-header-audit/examples/assert-headers.test.mjs).

### Other inputs

```ts
import { analyzeHeaders, normalizeHeaders, parseRawHeaders } from "security-header-audit";

analyzeHeaders({ "Content-Security-Policy": "default-src 'self'" }); // plain object, any case
analyzeHeaders(req.headers);                                         // Node IncomingHttpHeaders
analyzeHeaders(parseRawHeaders(curlOutput));                         // raw "Name: value" text

normalizeHeaders(input); // { "lower-case-name": "value" }; repeated headers joined with ", "
```

`parseRawHeaders()` reads only the last response in the text, so `curl -sIL` output (one block
per redirect) is graded on the final page, the one a browser actually renders.

## CLI

```text
security-header-audit <url> [options]
security-header-audit --raw <file> [options]    (use - to read stdin)

  --raw <file>       Grade a raw HTTP header block instead of fetching a URL
  --json             Print the result as JSON
  --min-score <n>    Exit with code 1 when the score is below n (0-100)
  --timeout <ms>     Request timeout in milliseconds (default 10000)
```

Exit codes: `0` graded, `1` score below `--min-score`, `2` usage or network error.

```sh
npx security-header-audit example.com                    # https:// is assumed
npx security-header-audit https://staging.example.com --min-score 85
curl -sIL https://example.com | npx security-header-audit --raw -
npx security-header-audit https://example.com --json > headers-report.json
```

The CLI sends one `GET`, follows redirects and grades the final response. It cancels the body
without reading it. The `User-Agent` names this package.

### GitHub Actions

```yaml
- name: Security headers
  run: npx --yes security-header-audit@1 https://staging.example.com --min-score 85
```

## What is checked

| Check | Deduction | Passes when |
|---|---|---|
| Strict-Transport-Security | 15 if missing, 5 if `max-age` < 15768000 (6 months) | `max-age` is at least 6 months |
| Content-Security-Policy | 15 if missing, 5 if `'unsafe-inline'` or `'unsafe-eval'` is in effect | a policy is present and neither keyword takes effect |
| X-Content-Type-Options | 5 | the first value is `nosniff` |
| Clickjacking protection | 10 | CSP `frame-ancestors` is present, or X-Frame-Options is a value browsers honour |
| Referrer-Policy | 2 (browsers already default to `strict-origin-when-cross-origin`) | present |
| Permissions-Policy | 5 | present |
| Server / X-Powered-By | 5 | neither header is sent |

The score is 100 minus the deductions. The lowest possible score is 43.

## Limitations

- **A good score is not a security certification.** Headers are one layer. This tool can't see
  your application's code, dependencies, TLS configuration or cookies.
- **CSP strength is only partly graded.** It flags `'unsafe-inline'` and `'unsafe-eval'` when
  they actually take effect. Overly broad sources (`*`, `https:`, wide CDNs) aren't scored. For
  a deeper CSP review, use Google's
  [CSP Evaluator](https://csp-evaluator.withgoogle.com/).
- **Values for Referrer-Policy and Permissions-Policy aren't graded.** Only whether they're
  present.
- **`Server` is flagged even without a version number** (for example `Server: cloudflare`).
- **One response only.** The CLI grades the final page of a redirect chain. Headers on the
  redirects themselves, for example HSTS on the `http://` hop, aren't graded.
- **`Content-Security-Policy-Report-Only` doesn't count**, because browsers don't enforce it.

## Security

The library never touches the network. The CLI fetches only the URL you give it, from your
machine, which includes `localhost` and private addresses, so you can test a dev server. Don't
expose the CLI as a service that fetches URLs for other people without your own SSRF controls.
See [SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md) to report a vulnerability.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)
