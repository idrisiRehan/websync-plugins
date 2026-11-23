import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { analyzeHeaders, type HeaderRule } from "../src/analyze.ts";

// Fixtures use the normalized shape: lower-cased names, and a repeated header's values joined
// with ", " (what normalizeHeaders() produces from any input).

// A header set that passes every rule: a perfect 100.
const STRONG: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

// websync.in's own Content-Security-Policy, copied verbatim from its server config (November 2026).
const WEBSYNC_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.googletagmanager.com https://*.clarity.ms https://www.google.com https://www.gstatic.com https://plausible.io https://analytics.ahrefs.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://*.clarity.ms https://www.google.com https://plausible.io https://analytics.ahrefs.com; frame-src https://www.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

function withHeaders(overrides: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = { ...STRONG };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

function rule(rules: HeaderRule[], name: string): HeaderRule {
  const found = rules.filter((r) => r.name === name);
  assert.equal(found.length, 1, `expected exactly one rule named ${name}`);
  return found[0];
}

describe("analyzeHeaders - overall shape and score", () => {
  test("a fully hardened header set scores 100 with every rule passed", () => {
    const { score, rules } = analyzeHeaders(STRONG);
    assert.equal(score, 100);
    assert.equal(rules.length, 7);
    for (const r of rules) {
      assert.equal(r.status, "passed", `${r.name} should pass`);
      assert.equal(r.scoreImpact, 0);
    }
  });

  test("emits exactly one rule per check, in a fixed order", () => {
    const { rules } = analyzeHeaders({});
    assert.deepEqual(
      rules.map((r) => r.name),
      [
        "Strict-Transport-Security",
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "Clickjacking protection",
        "Referrer-Policy",
        "Permissions-Policy",
        "Server info disclosure",
      ],
    );
  });

  test("no headers at all scores 48 (15+15+5+10+2+5 = 52 deducted; no Server header to disclose)", () => {
    const { score, rules } = analyzeHeaders({});
    assert.equal(score, 48);
    assert.deepEqual(
      rules.map((r) => r.id),
      ["hsts-missing", "csp-missing", "xcto-missing", "clickjack-missing", "referrer-missing", "permissions-missing", "info-ok"],
    );
  });

  test("the worst possible result is 43 - the 0..100 clamp is never reached", () => {
    const { score } = analyzeHeaders({ server: "Apache/2.4.1", "x-powered-by": "PHP/7.0" });
    assert.equal(score, 43);
  });

  test("score always equals 100 minus the sum of every rule's scoreImpact", () => {
    const fixtures: Record<string, string>[] = [
      {},
      STRONG,
      withHeaders({ "strict-transport-security": "max-age=60", server: "nginx" }),
      withHeaders({ "content-security-policy": "script-src 'self' 'unsafe-inline'", "x-frame-options": undefined }),
      { "x-frame-options": "SAMEORIGIN", "referrer-policy": "no-referrer" },
    ];
    for (const h of fixtures) {
      const { score, rules } = analyzeHeaders(h);
      const deducted = rules.reduce((sum, r) => sum + r.scoreImpact, 0);
      assert.equal(score, 100 - deducted);
    }
  });

  test("failed/warning rules carry a positive impact, passed rules carry zero", () => {
    const { rules } = analyzeHeaders({ server: "x", "strict-transport-security": "max-age=1", "content-security-policy": "script-src 'unsafe-eval'" });
    for (const r of rules) {
      if (r.status === "passed") assert.equal(r.scoreImpact, 0);
      else assert.ok(r.scoreImpact > 0, `${r.id} should deduct`);
    }
  });

  test("header names are matched case-insensitively", () => {
    const { rules } = analyzeHeaders({ "X-Content-Type-Options": "nosniff" });
    assert.equal(rule(rules, "X-Content-Type-Options").status, "passed");
  });

  test("rating follows the score: strong at 80+, needs-work at 50-79, weak below 50", () => {
    assert.equal(analyzeHeaders(STRONG).rating, "strong");
    assert.equal(analyzeHeaders({}).rating, "weak");
    assert.equal(analyzeHeaders(withHeaders({ "content-security-policy": undefined, "x-frame-options": "DENY" })).rating, "strong");
    assert.equal(analyzeHeaders({ "content-security-policy": "default-src 'self'", "x-content-type-options": "nosniff" }).rating, "needs-work");
  });
});

describe("Strict-Transport-Security", () => {
  test("missing -> failed, -15", () => {
    const r = rule(analyzeHeaders(withHeaders({ "strict-transport-security": undefined })).rules, "Strict-Transport-Security");
    assert.equal(r.id, "hsts-missing");
    assert.equal(r.status, "failed");
    assert.equal(r.scoreImpact, 15);
    assert.equal(r.category, "Transport");
  });

  test("max-age one second below 15768000 -> warning, -5", () => {
    const { score, rules } = analyzeHeaders(withHeaders({ "strict-transport-security": "max-age=15767999" }));
    const r = rule(rules, "Strict-Transport-Security");
    assert.equal(r.id, "hsts-short");
    assert.equal(r.status, "warning");
    assert.equal(r.scoreImpact, 5);
    assert.equal(score, 95);
  });

  test("max-age exactly 15768000 (6 months) -> passed, reported as a rounded 183-day max-age", () => {
    const r = rule(analyzeHeaders(withHeaders({ "strict-transport-security": "max-age=15768000" })).rules, "Strict-Transport-Security");
    assert.equal(r.id, "hsts-ok");
    assert.equal(r.status, "passed");
    assert.equal(r.message, "Present with a 183-day max-age.");
  });

  test("one year -> passed with a 365-day max-age", () => {
    const r = rule(analyzeHeaders(STRONG).rules, "Strict-Transport-Security");
    assert.equal(r.message, "Present with a 365-day max-age.");
  });

  test("max-age=0 (the RFC 6797 'forget this host' value) -> warning naming 0s", () => {
    const r = rule(analyzeHeaders(withHeaders({ "strict-transport-security": "max-age=0" })).rules, "Strict-Transport-Security");
    assert.equal(r.status, "warning");
    assert.match(r.message, /only 0s/);
  });

  test("header present without any max-age directive is treated as max-age 0 -> warning", () => {
    const r = rule(analyzeHeaders(withHeaders({ "strict-transport-security": "includeSubDomains" })).rules, "Strict-Transport-Security");
    assert.equal(r.id, "hsts-short");
    assert.match(r.message, /only 0s/);
  });

  test("directive name is matched case-insensitively and anywhere in the value", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "strict-transport-security": "includeSubDomains; MAX-AGE=63072000" })).rules,
      "Strict-Transport-Security",
    );
    assert.equal(r.status, "passed");
  });

  // RFC 6797 s8.1: only the first Strict-Transport-Security field is processed.
  test("a duplicated header (joined with ', ' on input) is graded on the first field only", () => {
    const short = rule(
      analyzeHeaders(withHeaders({ "strict-transport-security": "max-age=300, max-age=31536000" })).rules,
      "Strict-Transport-Security",
    );
    assert.equal(short.status, "warning");
    assert.match(short.message, /only 300s/);
    const long = rule(
      analyzeHeaders(withHeaders({ "strict-transport-security": "max-age=31536000; includeSubDomains, max-age=0" })).rules,
      "Strict-Transport-Security",
    );
    assert.equal(long.status, "passed");
    assert.equal(long.message, "Present with a 365-day max-age.");
  });

  test("a max-age only in the second field doesn't count - the first field has none, so it reads as 0", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "strict-transport-security": "includeSubDomains, max-age=31536000" })).rules,
      "Strict-Transport-Security",
    );
    assert.equal(r.status, "warning");
    assert.match(r.message, /only 0s/);
  });

  // RFC 6797 s6.1 / s6.1.1: directive values may be a quoted-string.
  test('quoted max-age="31536000" is read as the number, not as 0', () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "strict-transport-security": 'max-age="31536000"' })).rules,
      "Strict-Transport-Security",
    );
    assert.equal(r.id, "hsts-ok");
    assert.equal(r.status, "passed");
    assert.equal(r.message, "Present with a 365-day max-age.");
  });

  test("a short quoted max-age is still a warning", () => {
    const r = rule(analyzeHeaders(withHeaders({ "strict-transport-security": 'max-age="60"; preload' })).rules, "Strict-Transport-Security");
    assert.equal(r.status, "warning");
    assert.match(r.message, /only 60s/);
  });

  test("directive name is case-insensitive and whitespace around '=' is allowed", () => {
    for (const value of ["Max-Age=31536000", 'MAX-AGE = "31536000" ; includeSubDomains', "  max-age=31536000  "]) {
      const r = rule(analyzeHeaders(withHeaders({ "strict-transport-security": value })).rules, "Strict-Transport-Security");
      assert.equal(r.status, "passed", value);
    }
  });

  test("a non-numeric max-age reads as 0", () => {
    const r = rule(analyzeHeaders(withHeaders({ "strict-transport-security": "max-age=abc" })).rules, "Strict-Transport-Security");
    assert.equal(r.status, "warning");
    assert.match(r.message, /only 0s/);
  });

  test("a similarly named directive (x-max-age) isn't mistaken for max-age", () => {
    const r = rule(analyzeHeaders(withHeaders({ "strict-transport-security": "x-max-age=31536000" })).rules, "Strict-Transport-Security");
    assert.equal(r.status, "warning");
  });
});

describe("Content-Security-Policy", () => {
  test("missing -> failed, -15", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": undefined, "x-frame-options": "DENY" })).rules, "Content-Security-Policy");
    assert.equal(r.id, "csp-missing");
    assert.equal(r.status, "failed");
    assert.equal(r.scoreImpact, 15);
  });

  test("'unsafe-inline' -> warning, -5", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.id, "csp-unsafe");
    assert.equal(r.status, "warning");
    assert.equal(r.scoreImpact, 5);
  });

  test("'unsafe-eval' -> warning", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'unsafe-eval'" })).rules, "Content-Security-Policy");
    assert.equal(r.status, "warning");
  });

  test("match is case-insensitive", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'UNSAFE-INLINE'" })).rules, "Content-Security-Policy");
    assert.equal(r.status, "warning");
  });

  test("'unsafe-inline' confined to style-src is still flagged (rule does not distinguish directives)", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'" })).rules, "Content-Security-Policy");
    assert.equal(r.status, "warning");
  });

  // CSP3 s2.3.1 / s4.5.1: 'wasm-unsafe-eval' only permits WebAssembly compilation - not eval().
  test("'wasm-unsafe-eval' alone passes, with an informational note", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'self' 'wasm-unsafe-eval'; frame-ancestors 'none'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.id, "csp-ok");
    assert.equal(r.status, "passed");
    assert.equal(r.scoreImpact, 0);
    assert.match(r.message, /'wasm-unsafe-eval' isn't penalised/);
  });

  test("'wasm-unsafe-eval' together with a real 'unsafe-eval' is still flagged for 'unsafe-eval'", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.status, "warning");
    assert.match(r.message, /allows 'unsafe-eval'/);
  });

  test("websync.in's own CSP (public/.htaccess) is not penalised for 'wasm-unsafe-eval'", () => {
    const withoutWasmCsp = WEBSYNC_CSP.replace(" 'wasm-unsafe-eval'", "");
    assert.notEqual(withoutWasmCsp, WEBSYNC_CSP);
    const withWasm = rule(analyzeHeaders(withHeaders({ "content-security-policy": WEBSYNC_CSP })).rules, "Content-Security-Policy");
    const withoutWasm = rule(analyzeHeaders(withHeaders({ "content-security-policy": withoutWasmCsp })).rules, "Content-Security-Policy");
    // Same grade with or without the keyword: it costs nothing.
    assert.equal(withWasm.status, withoutWasm.status);
    assert.equal(withWasm.scoreImpact, withoutWasm.scoreImpact);
    assert.doesNotMatch(withWasm.message, /(?<!wasm-)'unsafe-eval'/);
    assert.match(withWasm.message, /'wasm-unsafe-eval' isn't penalised/);
    // It IS still flagged, correctly, for script-src/style-src 'unsafe-inline' with no nonce or hash.
    assert.equal(withWasm.status, "warning");
    assert.equal(withWasm.scoreImpact, 5);
    assert.match(withWasm.message, /'unsafe-inline' for scripts, event handlers and styles/);
  });

  // CSP3 s6.7.3.2: a nonce-source, hash-source or (scripts only) 'strict-dynamic' in the same
  // source list makes CSP Level 2+ browsers ignore 'unsafe-inline'.
  test("'unsafe-inline' alongside a nonce in script-src is not penalised", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'nonce-r4nd0m' 'unsafe-inline'; frame-ancestors 'none'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.id, "csp-ok");
    assert.equal(r.scoreImpact, 0);
    assert.match(r.message, /ignored by CSP Level 2\+ browsers/);
  });

  test("'unsafe-inline' alongside a hash (any case) in script-src is not penalised", () => {
    for (const hash of ["'sha256-abc123='", "'SHA384-abc123='", "'sha512-abc123='"]) {
      const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": `script-src 'self' 'unsafe-inline' ${hash}` })).rules, "Content-Security-Policy");
      assert.equal(r.status, "passed", hash);
    }
  });

  test("'unsafe-inline' alongside 'strict-dynamic' in script-src is not penalised", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'strict-dynamic' 'nonce-x' 'unsafe-inline' https:" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.status, "passed");
    const sdOnly = rule(analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'strict-dynamic' 'unsafe-inline'" })).rules, "Content-Security-Policy");
    assert.equal(sdOnly.status, "passed");
  });

  test("'strict-dynamic' does not neutralise 'unsafe-inline' in style-src (it only applies to scripts)", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "style-src 'strict-dynamic' 'unsafe-inline'" })).rules, "Content-Security-Policy");
    assert.equal(r.status, "warning");
    assert.match(r.message, /'unsafe-inline' for styles/);
  });

  test("a nonce does not neutralise 'unsafe-eval'", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'nonce-x' 'unsafe-eval'" })).rules, "Content-Security-Policy");
    assert.equal(r.status, "warning");
    assert.match(r.message, /allows 'unsafe-eval'/);
  });

  test("a nonce in style-src does not neutralise 'unsafe-inline' in script-src", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'self' 'unsafe-inline'; style-src 'nonce-x' 'unsafe-inline'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.status, "warning");
    assert.match(r.message, /'unsafe-inline' for scripts and event handlers -/);
  });

  test("'unsafe-inline' in default-src is overridden by stricter script-src and style-src (CSP3 s6.8.3 fallback)", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "default-src 'self' 'unsafe-inline'; script-src 'self'; style-src 'self'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.status, "passed");
  });

  test("'unsafe-inline' in default-src applies to scripts and styles when nothing overrides it", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "default-src 'self' 'unsafe-inline'" })).rules, "Content-Security-Policy");
    assert.equal(r.status, "warning");
    assert.match(r.message, /'unsafe-inline' for scripts, event handlers and styles/);
  });

  test("directive names are case-insensitive, and a repeated directive is ignored (CSP3 s2.2.1)", () => {
    const upper = rule(analyzeHeaders(withHeaders({ "content-security-policy": "SCRIPT-SRC 'self' 'unsafe-inline'" })).rules, "Content-Security-Policy");
    assert.equal(upper.status, "warning");
    const repeated = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'self'; script-src 'unsafe-inline'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(repeated.status, "passed");
  });

  // CSP3 s3.1: a comma-separated value is a list of policies, all enforced.
  test("the same weak CSP sent twice (joined with ', ' on input) is flagged once, -5", () => {
    const policy = "script-src 'self' 'unsafe-inline'";
    const { score, rules } = analyzeHeaders(withHeaders({ "content-security-policy": `${policy}, ${policy}`, "x-frame-options": "DENY" }));
    const r = rule(rules, "Content-Security-Policy");
    assert.equal(r.status, "warning");
    assert.equal(r.scoreImpact, 5);
    assert.equal(score, 95);
  });

  test("a second, stricter policy blocks what the first allows -> not penalised", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'unsafe-inline' 'unsafe-eval', default-src 'self'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.status, "passed");
  });

  test("a nonce in one policy still blocks un-nonced inline scripts that a second policy allows", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'nonce-x' 'unsafe-inline', script-src 'unsafe-inline'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.status, "passed");
  });

  test("a second policy that doesn't govern scripts doesn't hide the first policy's 'unsafe-inline'", () => {
    const r = rule(
      analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'unsafe-inline', frame-ancestors 'none'" })).rules,
      "Content-Security-Policy",
    );
    assert.equal(r.status, "warning");
  });

  test("frame-ancestors in any policy of a multi-policy header covers clickjacking", () => {
    const r = rule(analyzeHeaders({ "content-security-policy": "default-src 'self', frame-ancestors 'self'" }).rules, "Clickjacking protection");
    assert.equal(r.status, "passed");
  });

  test("'unsafe-hashes' alone does not trip the check", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "script-src 'self' 'unsafe-hashes' 'sha256-abc='" })).rules, "Content-Security-Policy");
    assert.equal(r.status, "passed");
  });

  test("any other non-empty policy passes - strength beyond the two keywords isn't graded", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "default-src *" })).rules, "Content-Security-Policy");
    assert.equal(r.id, "csp-ok");
    assert.equal(r.status, "passed");
  });

  test("Content-Security-Policy-Report-Only does not count as a CSP", () => {
    const h = withHeaders({ "content-security-policy": undefined, "x-frame-options": "DENY" });
    h["content-security-policy-report-only"] = "default-src 'self'";
    assert.equal(rule(analyzeHeaders(h).rules, "Content-Security-Policy").status, "failed");
  });
});

describe("X-Content-Type-Options", () => {
  test("missing -> warning, -5, with the explanatory message", () => {
    const r = rule(analyzeHeaders(withHeaders({ "x-content-type-options": undefined })).rules, "X-Content-Type-Options");
    assert.equal(r.id, "xcto-missing");
    assert.equal(r.status, "warning");
    assert.equal(r.scoreImpact, 5);
    assert.match(r.message, /^Missing\./);
  });

  test("wrong value -> warning that quotes the value", () => {
    const r = rule(analyzeHeaders(withHeaders({ "x-content-type-options": "sniff" })).rules, "X-Content-Type-Options");
    assert.equal(r.status, "warning");
    assert.equal(r.message, 'Set to "sniff" instead of "nosniff".');
  });

  test("value is compared case-insensitively", () => {
    const r = rule(analyzeHeaders(withHeaders({ "x-content-type-options": "NoSniff" })).rules, "X-Content-Type-Options");
    assert.equal(r.status, "passed");
  });

  // Fetch Standard "determine nosniff": split on commas, only the first value counts.
  test("a header sent twice (joined to 'nosniff, nosniff' on input) passes", () => {
    for (const value of ["nosniff, nosniff", "NOSNIFF,nosniff", "nosniff,  nosniff,nosniff"]) {
      const r = rule(analyzeHeaders(withHeaders({ "x-content-type-options": value })).rules, "X-Content-Type-Options");
      assert.equal(r.status, "passed", value);
      assert.equal(r.message, 'Set to "nosniff".');
    }
  });

  test("first value nosniff, later value different -> passed (browsers only read the first), noting the ignored value", () => {
    const r = rule(analyzeHeaders(withHeaders({ "x-content-type-options": "nosniff, sniff" })).rules, "X-Content-Type-Options");
    assert.equal(r.status, "passed");
    assert.equal(r.message, 'Set to "nosniff". Later values ("sniff") are ignored by browsers.');
  });

  test("first value not nosniff -> warning, even if a later one is", () => {
    const r = rule(analyzeHeaders(withHeaders({ "x-content-type-options": "sniff, nosniff" })).rules, "X-Content-Type-Options");
    assert.equal(r.status, "warning");
    assert.equal(r.scoreImpact, 5);
    assert.match(r.message, /only read the first value \("sniff"\)/);
  });
});

describe("Clickjacking protection", () => {
  test("neither X-Frame-Options nor frame-ancestors -> failed, -10", () => {
    const r = rule(analyzeHeaders(withHeaders({ "content-security-policy": "default-src 'self'" })).rules, "Clickjacking protection");
    assert.equal(r.id, "clickjack-missing");
    assert.equal(r.status, "failed");
    assert.equal(r.scoreImpact, 10);
  });

  test("X-Frame-Options alone passes and is echoed back", () => {
    const r = rule(analyzeHeaders({ "x-frame-options": "SAMEORIGIN" }).rules, "Clickjacking protection");
    assert.equal(r.status, "passed");
    assert.equal(r.message, "X-Frame-Options: SAMEORIGIN");
  });

  test("CSP frame-ancestors alone passes, and is preferred in the message when both are set", () => {
    const only = rule(analyzeHeaders(STRONG).rules, "Clickjacking protection");
    assert.equal(only.status, "passed");
    assert.equal(only.message, "Covered by CSP's frame-ancestors directive.");
    const both = rule(analyzeHeaders(withHeaders({ "x-frame-options": "DENY" })).rules, "Clickjacking protection");
    assert.equal(both.message, "Covered by CSP's frame-ancestors directive.");
  });

  // HTML Standard s7.7 "The X-Frame-Options header" - see evaluateXfo() in analyze.ts.
  const clickjack = (xfo: string, csp?: string) => {
    const h: Record<string, string> = { "x-frame-options": xfo };
    if (csp) h["content-security-policy"] = csp;
    return rule(analyzeHeaders(h).rules, "Clickjacking protection");
  };

  test("DENY and SAMEORIGIN pass, case- and whitespace-insensitively, echoing the trimmed value", () => {
    for (const value of ["DENY", "deny", "SameOrigin", "  sameorigin  ", "Deny "]) {
      const r = clickjack(value);
      assert.equal(r.id, "clickjack-ok", value);
      assert.equal(r.status, "passed", value);
      assert.equal(r.scoreImpact, 0, value);
      assert.equal(r.message, `X-Frame-Options: ${value.trim()}`);
    }
  });

  test("a header sent twice ('DENY, DENY', joined on input) is one value in the spec's set -> plain pass", () => {
    for (const value of ["DENY, DENY", "deny,DENY", "SAMEORIGIN, sameorigin"]) {
      const r = clickjack(value);
      assert.equal(r.status, "passed", value);
      assert.equal(r.message, `X-Frame-Options: ${value}`);
    }
  });

  test("conflicting 'deny, sameorigin' -> passes: browsers block framing entirely (behaves like DENY), explained", () => {
    const r = clickjack("deny, sameorigin");
    assert.equal(r.status, "passed");
    assert.match(r.message, /conflicting values, which browsers treat as DENY/);
  });

  test("any multi-value set containing a recognised keyword blocks framing (spec step 6), even with allowall", () => {
    for (const value of ["SAMEORIGIN, ALLOWALL", "junk, deny"]) {
      assert.equal(clickjack(value).status, "passed", value);
    }
  });

  test("ALLOW-FROM (obsolete) without frame-ancestors -> failed, -10, saying why", () => {
    const { score, rules } = analyzeHeaders(withHeaders({ "content-security-policy": "default-src 'self'", "x-frame-options": "ALLOW-FROM https://x.example" }));
    const r = rule(rules, "Clickjacking protection");
    assert.equal(r.id, "clickjack-invalid");
    assert.equal(r.status, "failed");
    assert.equal(r.scoreImpact, 10);
    assert.match(r.message, /ALLOW-FROM is obsolete and ignored by current browsers/);
    assert.match(r.message, /no CSP frame-ancestors/);
    assert.equal(score, 90);
  });

  test("ALLOWALL -> failed, -10 (treated as if the header were absent)", () => {
    const r = clickjack("ALLOWALL");
    assert.equal(r.id, "clickjack-invalid");
    assert.equal(r.status, "failed");
    assert.equal(r.scoreImpact, 10);
    assert.match(r.message, /ALLOWALL isn't a protective value/);
  });

  test("junk values -> failed, -10, as invalid", () => {
    for (const value of ["yes", "DENY-ALL", "true"]) {
      const r = clickjack(value);
      assert.equal(r.id, "clickjack-invalid", value);
      assert.equal(r.scoreImpact, 10, value);
      assert.match(r.message, /isn't a valid value \(only DENY or SAMEORIGIN are\), so browsers ignore it/);
    }
  });

  test("several distinct values, none recognised -> failed (spec step 7: treated as absent)", () => {
    const r = clickjack("ALLOW-FROM https://a.example, ALLOW-FROM https://b.example");
    assert.equal(r.id, "clickjack-invalid");
    assert.match(r.message, /none of its values is valid/);
  });

  test("invalid X-Frame-Options plus CSP frame-ancestors -> passed: frame-ancestors supersedes XFO, with a note", () => {
    for (const value of ["ALLOW-FROM https://x.example", "ALLOWALL", "junk"]) {
      const r = clickjack(value, "default-src 'self'; frame-ancestors 'self'");
      assert.equal(r.id, "clickjack-ok", value);
      assert.equal(r.status, "passed", value);
      assert.equal(r.scoreImpact, 0, value);
      assert.match(r.message, /^Covered by CSP's frame-ancestors directive\. \(X-Frame-Options ".+" .+ browsers ignore X-Frame-Options when frame-ancestors is present anyway\.\)$/);
    }
  });

  test("Content-Security-Policy-Report-Only's frame-ancestors doesn't rescue an invalid X-Frame-Options", () => {
    const r = rule(
      analyzeHeaders({ "x-frame-options": "ALLOWALL", "content-security-policy-report-only": "frame-ancestors 'none'" }).rules,
      "Clickjacking protection",
    );
    assert.equal(r.status, "failed");
  });

  test("frame-ancestors value is not validated - a permissive '*' still passes", () => {
    const r = rule(analyzeHeaders({ "content-security-policy": "frame-ancestors *" }).rules, "Clickjacking protection");
    assert.equal(r.status, "passed");
  });
});

describe("Referrer-Policy", () => {
  // W3C Referrer Policy s3 / Fetch: browsers default to strict-origin-when-cross-origin.
  test("missing -> minor warning, -2, explaining the browser default", () => {
    const { score, rules } = analyzeHeaders(withHeaders({ "referrer-policy": undefined }));
    const r = rule(rules, "Referrer-Policy");
    assert.equal(r.id, "referrer-missing");
    assert.equal(r.status, "warning");
    assert.equal(r.scoreImpact, 2);
    assert.equal(r.category, "Privacy");
    assert.equal(score, 98);
    assert.match(r.message, /default to strict-origin-when-cross-origin/);
    assert.doesNotMatch(r.message, /to every link/);
  });

  test("a duplicated header still counts as present", () => {
    const r = rule(analyzeHeaders(withHeaders({ "referrer-policy": "no-referrer, strict-origin-when-cross-origin" })).rules, "Referrer-Policy");
    assert.equal(r.status, "passed");
  });

  test("present -> passed, value echoed", () => {
    const r = rule(analyzeHeaders(STRONG).rules, "Referrer-Policy");
    assert.equal(r.message, 'Set to "strict-origin-when-cross-origin".');
  });

  test("value is not graded - even 'unsafe-url' passes", () => {
    const r = rule(analyzeHeaders(withHeaders({ "referrer-policy": "unsafe-url" })).rules, "Referrer-Policy");
    assert.equal(r.status, "passed");
  });
});

describe("Permissions-Policy", () => {
  test("missing -> warning, -5", () => {
    const r = rule(analyzeHeaders(withHeaders({ "permissions-policy": undefined })).rules, "Permissions-Policy");
    assert.equal(r.id, "permissions-missing");
    assert.equal(r.status, "warning");
    assert.equal(r.scoreImpact, 5);
  });

  test("present -> passed", () => {
    const r = rule(analyzeHeaders(STRONG).rules, "Permissions-Policy");
    assert.equal(r.id, "permissions-ok");
    assert.equal(r.message, "Present.");
  });

  test("the legacy Feature-Policy header does not count", () => {
    const h = withHeaders({ "permissions-policy": undefined });
    h["feature-policy"] = "camera 'none'";
    assert.equal(rule(analyzeHeaders(h).rules, "Permissions-Policy").status, "warning");
  });
});

describe("Server info disclosure", () => {
  test("neither header -> passed", () => {
    const r = rule(analyzeHeaders(STRONG).rules, "Server info disclosure");
    assert.equal(r.id, "info-ok");
    assert.equal(r.status, "passed");
  });

  test("Server alone -> warning, -5, quoting it", () => {
    const { score, rules } = analyzeHeaders(withHeaders({ server: "nginx/1.18.0" }));
    const r = rule(rules, "Server info disclosure");
    assert.equal(r.id, "info-disclosure");
    assert.equal(r.status, "warning");
    assert.equal(r.scoreImpact, 5);
    assert.match(r.message, /^Server: nginx\/1\.18\.0 - reveals/);
    assert.equal(score, 95);
  });

  test("X-Powered-By alone -> warning quoting it", () => {
    const r = rule(analyzeHeaders(withHeaders({ "x-powered-by": "Express" })).rules, "Server info disclosure");
    assert.match(r.message, /^X-Powered-By: Express - reveals/);
  });

  test("both present -> one warning, one -5 deduction, both quoted", () => {
    const { score, rules } = analyzeHeaders(withHeaders({ server: "Apache", "x-powered-by": "PHP/8.2.1" }));
    const r = rule(rules, "Server info disclosure");
    assert.match(r.message, /^Server: Apache, X-Powered-By: PHP\/8\.2\.1 - /);
    assert.equal(score, 95);
  });

  test("a version-less Server value is still flagged", () => {
    const r = rule(analyzeHeaders(withHeaders({ server: "cloudflare" })).rules, "Server info disclosure");
    assert.equal(r.status, "warning");
  });
});
