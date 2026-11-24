// IP addresses and CIDR ranges. Every address is held as 16 bytes: IPv6 as is, IPv4 as its
// IPv4-mapped IPv6 form (::ffff:a.b.c.d, RFC 4291 s2.5.5.2), so one prefix comparison serves both
// families and a dual-stack server's "::ffff:192.0.2.1" matches an IPv4 range.

const MAPPED_PREFIX = 96;

function parseIpv4(text: string, into: Uint8Array, offset: number): boolean {
  const parts = text.split(".");
  if (parts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    // Leading zeros are refused: some parsers read "010" as octal, so its meaning is ambiguous.
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return false;
    const n = Number(part);
    if (n > 255) return false;
    into[offset + i] = n;
  }
  return true;
}

function parseHexGroups(text: string): number[] | null {
  if (text === "") return [];
  const groups = text.split(":");
  const out: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out.push(parseInt(group, 16));
  }
  return out;
}

/** The address as 16 bytes, or null unless `text` is exactly an IPv4 or IPv6 address. Zone ids and brackets are refused. */
export function parseIp(text: string): Uint8Array | null {
  if (typeof text !== "string" || text.length > 45) return null;
  const bytes = new Uint8Array(16);
  if (!text.includes(":")) {
    bytes[10] = 0xff;
    bytes[11] = 0xff;
    return parseIpv4(text, bytes, 12) ? bytes : null;
  }

  // A trailing dotted IPv4 part fills the last 32 bits (::ffff:192.0.2.1, 64:ff9b::192.0.2.1).
  let hex = text;
  let tailGroups = 0;
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".", lastColon)) {
    if (!parseIpv4(text.slice(lastColon + 1), bytes, 12)) return null;
    hex = text.slice(0, lastColon + 1);
    // "::" before the IPv4 part keeps both colons; a single colon is only a separator.
    hex = hex.endsWith("::") ? hex : hex.slice(0, -1);
    tailGroups = 2;
  }

  const halves = hex.split("::");
  if (halves.length > 2) return null;
  const head = parseHexGroups(halves[0]);
  const tail = halves.length === 2 ? parseHexGroups(halves[1]) : [];
  if (!head || !tail) return null;
  const groups = head.length + tail.length + tailGroups;
  if (halves.length === 1 ? groups !== 8 : groups > 7) return null;
  head.forEach((g, i) => {
    bytes[i * 2] = g >> 8;
    bytes[i * 2 + 1] = g & 0xff;
  });
  const tailStart = 8 - tailGroups - tail.length;
  tail.forEach((g, i) => {
    bytes[(tailStart + i) * 2] = g >> 8;
    bytes[(tailStart + i) * 2 + 1] = g & 0xff;
  });
  return bytes;
}

/** True when the 16-byte address is IPv4-mapped, so it is shown and truncated as IPv4. */
function isMapped(bytes: Uint8Array): boolean {
  for (let i = 0; i < 10; i++) if (bytes[i] !== 0) return false;
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

/** The first `bits` bits of the address as a string key; the rest is masked off. */
function prefixKey(bytes: Uint8Array, bits: number): string {
  const whole = bits >> 3;
  let key = "";
  for (let i = 0; i < whole; i++) key += String.fromCharCode(bytes[i]);
  const rest = bits & 7;
  if (rest) key += String.fromCharCode(bytes[whole] & (0xff << (8 - rest)) & 0xff);
  return key;
}

interface Cidr {
  bytes: Uint8Array;
  /** Prefix length over the 16-byte form, so an IPv4 /24 is 120. */
  bits: number;
}

/**
 * "192.0.2.0/24", "2001:db8::/32" or a bare address (a /32 or /128, as some operators list
 * them). Bits past the prefix are ignored, as the range they name is unambiguous.
 */
function parseCidr(text: string): Cidr | null {
  if (typeof text !== "string") return null;
  const slash = text.indexOf("/");
  const bytes = parseIp(slash === -1 ? text : text.slice(0, slash));
  if (!bytes) return null;
  const v4 = !text.includes(":");
  const max = v4 ? 32 : 128;
  if (slash === -1) return { bytes, bits: 128 };
  const length = text.slice(slash + 1);
  if (!/^(?:0|[1-9]\d{0,2})$/.test(length) || Number(length) > max) return null;
  return { bytes, bits: Number(length) + (v4 ? MAPPED_PREFIX : 0) };
}

/** A set of CIDR ranges, built once and then queried with verifyIp(). */
export class IpRangeSet {
  /** Prefix length to the keys of the ranges with that length, so a lookup is one Set probe per length. */
  readonly #byLength = new Map<number, Set<string>>();
  /** Ranges added. */
  readonly size: number;
  /** Entries that weren't a valid address or CIDR range, and were skipped. */
  readonly invalid: number;

  constructor(ranges: Iterable<string>) {
    let size = 0;
    let invalid = 0;
    for (const text of ranges) {
      const cidr = parseCidr(text);
      if (!cidr) {
        invalid++;
        continue;
      }
      let keys = this.#byLength.get(cidr.bits);
      if (!keys) this.#byLength.set(cidr.bits, (keys = new Set()));
      keys.add(prefixKey(cidr.bytes, cidr.bits));
      size++;
    }
    this.size = size;
    this.invalid = invalid;
  }

  /** Whether the 16-byte address falls in any range. */
  has(bytes: Uint8Array): boolean {
    for (const [bits, keys] of this.#byLength) {
      if (keys.has(prefixKey(bytes, bits))) return true;
    }
    return false;
  }
}

/**
 * Whether `ip` lies in one of the ranges: an IpRangeSet, or CIDR strings (build an IpRangeSet once
 * when checking many addresses). False for anything that isn't a valid IPv4 or IPv6 address.
 */
export function verifyIp(ip: string, ranges: IpRangeSet | readonly string[]): boolean {
  const bytes = parseIp(ip);
  if (!bytes) return false;
  return (ranges instanceof IpRangeSet ? ranges : new IpRangeSet(ranges)).has(bytes);
}

/** The /24 (IPv4) or /48 (IPv6) network holding the address, such as "192.0.2.0/24", so reports never show a full address. */
export function networkOf(bytes: Uint8Array): string {
  if (isMapped(bytes)) return `${bytes[12]}.${bytes[13]}.${bytes[14]}.0/24`;
  const groups: string[] = [];
  for (let i = 0; i < 6; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return `${groups.join(":")}::/48`;
}

export interface RangeFile {
  /** The file's `creationTime`, when it has one. */
  creationTime: string | null;
  /** Every prefix listed, as written. */
  prefixes: string[];
}

// Operators publish the shape Google introduced ({"prefixes": [{"ipv4Prefix": ...}]}), but not
// always as bare JSON: Amazon's lists are HTML pages with the JSON inside, one of them uses
// AWS's "ip_prefix" key, and some list bare addresses. Reading the key-value pairs wherever they
// appear handles all of them. The pattern has no nested quantifiers, so it runs in linear time.
const PREFIX_FIELD = /"(?:ipv4Prefix|ipv6Prefix|ip_prefix|ipv6_prefix)"\s*:\s*"([^"\\]{0,64})"/g;
const CREATION_TIME = /"creationTime"\s*:\s*"([^"\\]{0,64})"/;

/** Reads an operator's published range file (JSON, or an HTML page holding the JSON). Never throws. */
export function parseRangeFile(text: string): RangeFile {
  if (typeof text !== "string") return { creationTime: null, prefixes: [] };
  const prefixes = Array.from(text.matchAll(PREFIX_FIELD), (m) => m[1].trim());
  return { creationTime: CREATION_TIME.exec(text)?.[1] ?? null, prefixes };
}
