import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { IpRangeSet, networkOf, parseIp, parseRangeFile, verifyIp } from "../src/ip.ts";

const hex = (bytes: Uint8Array | null) => (bytes ? Buffer.from(bytes).toString("hex") : null);

describe("parseIp", () => {
  test("reads IPv4 as its IPv4-mapped IPv6 form", () => {
    assert.equal(hex(parseIp("192.0.2.1")), "00000000000000000000ffffc0000201");
    assert.equal(hex(parseIp("0.0.0.0")), "00000000000000000000ffff00000000");
    assert.equal(hex(parseIp("255.255.255.255")), "00000000000000000000ffffffffffff");
  });

  test("reads IPv6 in full, compressed and with an embedded IPv4 part", () => {
    assert.equal(hex(parseIp("2001:db8:0:0:0:0:0:1")), "20010db8000000000000000000000001");
    assert.equal(hex(parseIp("2001:DB8::1")), "20010db8000000000000000000000001");
    assert.equal(hex(parseIp("::")), "00000000000000000000000000000000");
    assert.equal(hex(parseIp("::1")), "00000000000000000000000000000001");
    assert.equal(hex(parseIp("fe80::")), "fe800000000000000000000000000000");
    assert.equal(hex(parseIp("::ffff:192.0.2.1")), hex(parseIp("192.0.2.1")));
    assert.equal(hex(parseIp("64:ff9b::192.0.2.33")), "0064ff9b0000000000000000c0000221");
    assert.equal(hex(parseIp("1:2:3:4:5:6:1.2.3.4")), "00010002000300040005000601020304");
    assert.equal(hex(parseIp("::1.2.3.4")), "00000000000000000000000001020304");
  });

  test("refuses anything that isn't exactly an address", () => {
    const bad = [
      "", " 192.0.2.1", "192.0.2.1 ", "192.0.2", "192.0.2.1.5", "192.0.2.256", "192.0.2.01", "192.0.2.-1", "1e2.0.0.1", "0x7f.0.0.1",
      "::1::", "1::2::3", ":1:2:3:4:5:6:7", "1:2:3:4:5:6:7:", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "12345::", "g::1", "fe80::1%eth0", "[::1]",
      "::ffff:192.0.2", "::ffff:192.0.2.1.1", "1:2:3:4:5:6:7:1.2.3.4", "1.2.3.4::", "localhost", "-", "shop.example",
    ];
    for (const text of bad) assert.equal(parseIp(text), null, text);
    assert.equal(parseIp(undefined as unknown as string), null);
  });
});

describe("CIDR ranges", () => {
  test("IPv4 prefixes, with the edges of the range", () => {
    const set = new IpRangeSet(["192.0.2.0/24", "198.51.100.64/26", "203.0.113.7/32"]);
    for (const ip of ["192.0.2.0", "192.0.2.255", "198.51.100.64", "198.51.100.127", "203.0.113.7"]) assert.ok(verifyIp(ip, set), ip);
    for (const ip of ["192.0.3.0", "192.0.1.255", "198.51.100.63", "198.51.100.128", "203.0.113.6", "203.0.113.8"]) assert.ok(!verifyIp(ip, set), ip);
  });

  test("prefix lengths that don't fall on a byte boundary", () => {
    const set = new IpRangeSet(["20.125.66.80/28", "2001:db8:abcd:12::/63"]);
    assert.ok(verifyIp("20.125.66.95", set));
    assert.ok(!verifyIp("20.125.66.96", set));
    assert.ok(!verifyIp("20.125.66.79", set));
    assert.ok(verifyIp("2001:db8:abcd:13:ffff::1", set));
    assert.ok(!verifyIp("2001:db8:abcd:14::", set));
  });

  test("IPv6 prefixes, /128 and /0", () => {
    assert.ok(verifyIp("2001:4860:4801:10::abcd", ["2001:4860:4801:10::/64"]));
    assert.ok(!verifyIp("2001:4860:4801:11::1", ["2001:4860:4801:10::/64"]));
    assert.ok(verifyIp("2001:db8::1", ["2001:db8::1/128"]));
    assert.ok(!verifyIp("2001:db8::2", ["2001:db8::1/128"]));
    assert.ok(verifyIp("2001:db8::2", ["::/0"]));
  });

  test("an IPv4 /0 covers every IPv4 address and no native IPv6 one", () => {
    assert.ok(verifyIp("1.2.3.4", ["0.0.0.0/0"]));
    assert.ok(verifyIp("::ffff:1.2.3.4", ["0.0.0.0/0"]));
    assert.ok(!verifyIp("2001:db8::1", ["0.0.0.0/0"]));
  });

  test("IPv4-mapped IPv6 addresses match IPv4 ranges and the other way round", () => {
    assert.ok(verifyIp("::ffff:132.196.86.12", ["132.196.86.0/24"]));
    assert.ok(verifyIp("::FFFF:132.196.86.12", ["132.196.86.0/24"]));
    assert.ok(verifyIp("132.196.86.12", ["::ffff:132.196.86.0/120"]));
    assert.ok(!verifyIp("::132.196.86.12", ["132.196.86.0/24"]), "IPv4-compatible is not IPv4-mapped");
  });

  test("bare addresses are single-address ranges, as Amazon lists them", () => {
    const set = new IpRangeSet(["3.81.245.78", "2600:1f28:365:8000::1"]);
    assert.equal(set.size, 2);
    assert.ok(verifyIp("3.81.245.78", set));
    assert.ok(!verifyIp("3.81.245.79", set));
    assert.ok(verifyIp("2600:1f28:365:8000::1", set));
  });

  test("bits past the prefix are ignored", () => {
    assert.ok(verifyIp("192.0.2.200", ["192.0.2.77/24"]));
  });

  test("invalid entries are skipped and counted", () => {
    const set = new IpRangeSet(["192.0.2.0/33", "2001:db8::/129", "192.0.2.0/", "192.0.2.0/024", "192.0.2.0/-1", "nonsense", "192.0.2.0/24"]);
    assert.equal(set.size, 1);
    assert.equal(set.invalid, 6);
  });

  test("an invalid address is never in a range", () => {
    for (const ip of ["", "-", "shop.example", "::ffff:999.1.1.1"]) assert.equal(verifyIp(ip, ["::/0"]), false, ip);
  });
});

test("networkOf truncates to /24 and /48", () => {
  assert.equal(networkOf(parseIp("203.0.113.77")!), "203.0.113.0/24");
  assert.equal(networkOf(parseIp("::ffff:203.0.113.77")!), "203.0.113.0/24");
  assert.equal(networkOf(parseIp("2001:db8:4a1:9::1")!), "2001:db8:4a1::/48");
});

describe("parseRangeFile", () => {
  test("reads the JSON shape OpenAI, Perplexity, Google and others publish", () => {
    const text = JSON.stringify({ creationTime: "2026-09-22T02:00:07.000000", prefixes: [{ ipv4Prefix: "132.196.86.0/24" }, { ipv6Prefix: "2001:db8::/32" }] }, null, 2);
    assert.deepEqual(parseRangeFile(text), { creationTime: "2026-09-22T02:00:07.000000", prefixes: ["132.196.86.0/24", "2001:db8::/32"] });
  });

  test("reads Amazon's HTML pages, bare addresses and the ip_prefix key", () => {
    const html = `<!doctype html><html><head><title>Amazonbot IP addresses</title><script>var x = {"a": 1};</script></head>
<body><pre><code class="container">{\r\n  "creationTime": "2026-09-08T05:24:10.610952+00:00",\r\n  "prefixes": [\r\n    {\r\n      "ipv4Prefix": "3.81.245.78"\r\n    },\r\n    {\r\n      "ip_prefix": "3.82.67.224/32"\r\n    }\r\n  ]\r\n}</code></pre></body></html>`;
    assert.deepEqual(parseRangeFile(html), { creationTime: "2026-09-08T05:24:10.610952+00:00", prefixes: ["3.81.245.78", "3.82.67.224/32"] });
  });

  test("never throws, and finds nothing in text without prefixes", () => {
    assert.deepEqual(parseRangeFile("<html>Not found</html>"), { creationTime: null, prefixes: [] });
    assert.deepEqual(parseRangeFile(null as unknown as string), { creationTime: null, prefixes: [] });
    const long = `"ipv4Prefix": "${"1".repeat(100_000)}`;
    const start = performance.now();
    assert.deepEqual(parseRangeFile(long.repeat(20)).prefixes, []);
    assert.ok(performance.now() - start < 1000);
  });
});
