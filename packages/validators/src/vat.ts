// Offline EU / UK / Northern Ireland VAT number checks: format and check digits.
//
// Each country sets its own VAT number layout and, nearly always, its own check-digit rule.
// The rules below follow the public descriptions implemented in the python-stdnum library
// (reimplemented here, not copied) and are tested against its published test numbers.
//
// What none of this can tell you is whether the number is registered and active. That needs
// the European Commission's VIES service (EU and XI numbers) or HMRC's checker (GB numbers),
// which this library does not contact: it makes no network calls.


import type { CheckStatus } from "./types.ts";

export interface VatCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface VatCountry {
  /** VAT prefix (Greece is EL, Northern Ireland XI). */
  prefix: string;
  name: string;
  /** Plain-language description of the accepted layout(s), after the prefix. */
  format: string;
}

export interface VatResult {
  normalized: string;
  country: VatCountry | null;
  /** The part after the prefix, after country-specific normalisation (e.g. Belgian leading 0). */
  number: string | null;
  valid: boolean;
  /** True when the format is right but this format has no check digit to test. */
  noCheckDigit: boolean;
  checks: VatCheck[];
}

// --- shared arithmetic --------------------------------------------------------------------

const mod = (a: number, m: number) => ((a % m) + m) % m;
const digitsOf = (s: string) => s.split("").map(Number);
const weighted = (s: string, weights: number[]) => weights.reduce((sum, w, i) => sum + w * Number(s[i]), 0);

/** Luhn sum mod 10, counting from the rightmost digit; a valid Luhn number gives 0. */
function luhnChecksum(s: string): number {
  let sum = 0;
  digitsOf(s)
    .reverse()
    .forEach((d, i) => {
      if (i % 2 === 1) {
        const doubled = d * 2;
        sum += doubled > 9 ? doubled - 9 : doubled;
      } else {
        sum += d;
      }
    });
  return sum % 10;
}

/** The digit that makes body + digit pass Luhn. */
const luhnCalc = (body: string) => (10 - luhnChecksum(body + "0")) % 10;

/** ISO 7064 MOD 11,10 (Germany, Croatia). */
function mod11_10(s: string): boolean {
  let c = 5;
  for (const d of digitsOf(s)) c = ((((c || 10) * 2) % 11) + d) % 10;
  return c === 1;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

// --- per-country rules --------------------------------------------------------------------
//
// Each rule takes the number after the prefix and returns:
//   null                         - the format is wrong
//   { number, check: boolean }   - format OK, check digit passes or fails
//   { number, check: null }      - format OK, this format has no check digit

interface RuleResult {
  number: string;
  check: boolean | null;
}
type Rule = (s: string) => RuleResult | null;

// Czech/Slovak birth number (rodne cislo). Returns null for a bad date or length, else the check.
function birthNumber(s: string): boolean | null | "bad" {
  if (!/^\d{9,10}$/.test(s)) return "bad";
  let year = 1900 + Number(s.slice(0, 2));
  const month = (Number(s.slice(2, 4)) % 50) % 20;
  const day = Number(s.slice(4, 6));
  if (s.length === 9) {
    if (year >= 1980) year -= 100;
    if (year > 1953) return "bad";
  } else if (year < 1954) {
    year += 100;
  }
  if (!isRealDate(year, month, day)) return "bad";
  if (s.length === 9) return null; // nine-digit birth numbers carry no check digit
  return (Number(s.slice(0, 9)) % 11) % 10 === Number(s[9]);
}

const IE_ALPHABET = "WABCDEFGHIJKLMNOPQRSTUV";
const ES_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const FR_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function latvianPersonalCheck(s: string): boolean {
  return (1 + weighted(s, [10, 5, 8, 4, 2, 1, 6, 3, 7, 9])) % 11 % 10 === Number(s[10]);
}

function ukRule(s: string): RuleResult | null {
  // Government departments (GD000-499) and health authorities (HA500-999): no check digit.
  const gdHa = /^(GD|HA)(\d{3})$/.exec(s);
  if (gdHa) {
    const n = Number(gdHa[2]);
    return (gdHa[1] === "GD" && n < 500) || (gdHa[1] === "HA" && n >= 500) ? { number: s, check: null } : null;
  }
  const long = /^(GD|HA)8888(\d{3})(\d{2})$/.exec(s);
  if (long) {
    const n = Number(long[2]);
    if (!((long[1] === "GD" && n < 500) || (long[1] === "HA" && n >= 500))) return null;
    return { number: s, check: String(n % 97).padStart(2, "0") === long[3] };
  }
  if (!/^\d{9}(\d{3})?$/.test(s)) return null;
  const r = weighted(s, [8, 7, 6, 5, 4, 3, 2, 10, 1]) % 97;
  const ok = Number(s.slice(0, 3)) >= 100 ? [0, 42, 55].includes(r) : r === 0;
  return { number: s, check: ok };
}

const RULES: Record<string, Rule> = {
  AT: (s) => (/^U\d{8}$/.test(s) ? { number: s, check: mod(6 - luhnChecksum(s.slice(1, 8)), 10) === Number(s[8]) } : null),

  BE: (s) => {
    let n = s.replace(/^\(0\)/, "0");
    if (/^\d{9}$/.test(n)) n = "0" + n;
    if (!/^[01]\d{9}$/.test(n) || /^0+$/.test(n)) return null;
    return { number: n, check: (Number(n.slice(0, 8)) + Number(n.slice(8))) % 97 === 0 };
  },

  BG: (s) => {
    if (/^\d{9}$/.test(s)) {
      let r = weighted(s, [1, 2, 3, 4, 5, 6, 7, 8]) % 11;
      if (r === 10) r = weighted(s, [3, 4, 5, 6, 7, 8, 9, 10]) % 11;
      return { number: s, check: r % 10 === Number(s[8]) };
    }
    if (!/^\d{10}$/.test(s)) return null;
    const last = Number(s[9]);
    // Personal number (EGN): a real birth date plus a weighted check.
    let year = Number(s.slice(0, 2));
    let month = Number(s.slice(2, 4));
    if (month > 40) {
      year += 2000;
      month -= 40;
    } else if (month > 20) {
      year += 1800;
      month -= 20;
    } else {
      year += 1900;
    }
    const egn = isRealDate(year, month, Number(s.slice(4, 6))) && (weighted(s, [2, 4, 8, 5, 10, 9, 7, 3, 6]) % 11) % 10 === last;
    // Foreigner's number (PNF).
    const pnf = weighted(s, [21, 19, 17, 13, 11, 9, 7, 3, 1]) % 10 === last;
    // Other 10-digit registrations.
    const other = mod(11 - weighted(s, [4, 3, 2, 7, 6, 5, 4, 3, 2]), 11) === last;
    return { number: s, check: egn || pnf || other };
  },

  CY: (s) => {
    if (!/^\d{8}[A-Z]$/.test(s) || s.startsWith("12")) return null;
    const odd = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21];
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += i % 2 === 0 ? odd[Number(s[i])] : Number(s[i]);
    return { number: s, check: String.fromCharCode(65 + (sum % 26)) === s[8] };
  },

  CZ: (s) => {
    if (/^\d{8}$/.test(s)) {
      if (s[0] === "9") return null;
      const c = mod(11 - weighted(s, [8, 7, 6, 5, 4, 3, 2]), 11);
      return { number: s, check: (c === 0 ? 1 : c) % 10 === Number(s[7]) };
    }
    if (/^6\d{8}$/.test(s)) {
      const t = weighted(s.slice(1), [8, 7, 6, 5, 4, 3, 2]) % 11;
      return { number: s, check: mod(8 - mod(10 - t, 11), 10) === Number(s[8]) };
    }
    const rc = birthNumber(s);
    if (rc === "bad") return null;
    return { number: s, check: rc };
  },

  DE: (s) => (/^[1-9]\d{8}$/.test(s) ? { number: s, check: mod11_10(s) } : null),

  DK: (s) => (/^[1-9]\d{7}$/.test(s) ? { number: s, check: weighted(s, [2, 7, 6, 5, 4, 3, 2, 1]) % 11 === 0 } : null),

  EE: (s) => (/^\d{9}$/.test(s) ? { number: s, check: weighted(s, [3, 7, 1, 3, 7, 1, 3, 7, 1]) % 10 === 0 } : null),

  EL: (s) => {
    const n = /^\d{8}$/.test(s) ? "0" + s : s;
    if (!/^\d{9}$/.test(n)) return null;
    let c = 0;
    for (let i = 0; i < 8; i++) c = c * 2 + Number(n[i]);
    return { number: n, check: ((c * 2) % 11) % 10 === Number(n[8]) };
  },

  ES: (s) => {
    if (!/^[0-9A-Z]\d{7}[0-9A-Z]$/.test(s)) return null;
    const first = s[0];
    const last = s[8];
    if ("KLM".includes(first)) return { number: s, check: ES_LETTERS[Number(s.slice(1, 8)) % 23] === last };
    if (/\d/.test(first)) {
      if (!/^\d{8}[A-Z]$/.test(s)) return null;
      return { number: s, check: ES_LETTERS[Number(s.slice(0, 8)) % 23] === last };
    }
    if ("XYZ".includes(first)) {
      if (!/[A-Z]$/.test(s)) return null;
      const n = String("XYZ".indexOf(first)) + s.slice(1, 8);
      return { number: s, check: ES_LETTERS[Number(n) % 23] === last };
    }
    if ("ABCDEFGHJNPQRSUVW".includes(first)) {
      const c = luhnCalc(s.slice(1, 8));
      return { number: s, check: last === String(c) || last === "JABCDEFGHI"[c] };
    }
    return null;
  },

  FI: (s) => (/^\d{8}$/.test(s) ? { number: s, check: weighted(s, [7, 9, 10, 5, 8, 4, 2, 1]) % 11 === 0 } : null),

  FR: (s) => {
    if (!/^[0-9A-HJ-NP-Z]{2}\d{9}$/.test(s)) return null;
    const siren = s.slice(2);
    if (!siren.startsWith("000") && luhnChecksum(siren) !== 0) return { number: s, check: false };
    const key = s.slice(0, 2);
    if (/^\d{2}$/.test(key)) return { number: s, check: Number(key) === Number(siren + "12") % 97 };
    const i0 = FR_ALPHABET.indexOf(key[0]);
    const i1 = FR_ALPHABET.indexOf(key[1]);
    const c = /\d/.test(key[0]) ? i0 * 24 + i1 - 10 : i0 * 34 + i1 - 100;
    return { number: s, check: (Number(siren) + 1 + Math.floor(c / 11)) % 11 === c % 11 };
  },

  HR: (s) => (/^\d{11}$/.test(s) ? { number: s, check: mod11_10(s) } : null),

  HU: (s) => (/^\d{8}$/.test(s) ? { number: s, check: weighted(s, [9, 7, 3, 1, 9, 7, 3, 1]) % 10 === 0 } : null),

  IE: (s) => {
    if (!/^\d[0-9A-Z+*]\d{5}[A-W][A-W]?$/.test(s)) return null;
    if ([...s.slice(7)].some((ch) => !IE_ALPHABET.includes(ch))) return null;
    if (/^\d{7}/.test(s)) {
      const ninth = s[8] ? IE_ALPHABET.indexOf(s[8]) : 0;
      const sum = weighted(s, [8, 7, 6, 5, 4, 3, 2]) + 9 * ninth;
      return { number: s, check: IE_ALPHABET[sum % 23] === s[7] };
    }
    // Old format: second character is a letter, + or *.
    const digits = "0" + s.slice(2, 7) + s[0];
    return { number: s, check: IE_ALPHABET[weighted(digits, [8, 7, 6, 5, 4, 3, 2]) % 23] === s[7] };
  },

  IT: (s) => {
    if (!/^\d{11}$/.test(s) || /^0{7}/.test(s)) return null;
    const office = Number(s.slice(7, 10));
    if (!((office >= 1 && office <= 100) || [120, 121, 888, 999].includes(office))) return null;
    return { number: s, check: luhnChecksum(s) === 0 };
  },

  LT: (s) => {
    if (!((/^\d{9}$/.test(s) && s[7] === "1") || (/^\d{12}$/.test(s) && s[10] === "1"))) return null;
    const body = s.slice(0, -1);
    let r = [...body].reduce((sum, d, i) => sum + (1 + (i % 9)) * Number(d), 0) % 11;
    if (r === 10) r = [...body].reduce((sum, d, i) => sum + (1 + ((i + 2) % 9)) * Number(d), 0) % 11;
    return { number: s, check: (r % 11) % 10 === Number(s[s.length - 1]) };
  },

  LU: (s) => (/^\d{8}$/.test(s) ? { number: s, check: String(Number(s.slice(0, 6)) % 89).padStart(2, "0") === s.slice(6) } : null),

  LV: (s) => {
    if (!/^\d{11}$/.test(s)) return null;
    if (Number(s[0]) >= 4) return { number: s, check: weighted(s, [9, 1, 4, 8, 3, 10, 2, 5, 7, 6, 1]) % 11 === 3 };
    if (s.startsWith("32")) return { number: s, check: latvianPersonalCheck(s) };
    const year = 1800 + 100 * Number(s[6]) + Number(s.slice(4, 6));
    if (!isRealDate(year, Number(s.slice(2, 4)), Number(s.slice(0, 2)))) return null;
    return { number: s, check: latvianPersonalCheck(s) };
  },

  MT: (s) => (/^[1-9]\d{7}$/.test(s) ? { number: s, check: weighted(s, [3, 4, 6, 7, 8, 9, 10, 1]) % 37 === 0 } : null),

  NL: (s) => {
    if (s.length < 4) return null;
    const n = s.slice(0, -3).padStart(9, "0") + s.slice(-3);
    if (!/^\d{9}B\d{2}$/.test(n) || Number(n.slice(0, 9)) === 0 || Number(n.slice(10)) === 0) return null;
    // Pre-2020 numbers: the 11-test on the first nine digits (last weight -1).
    const elevenTest = mod(weighted(n, [9, 8, 7, 6, 5, 4, 3, 2]) - Number(n[8]), 11) === 0;
    // Since 2020: ISO 7064 MOD 97-10 over "NL" + the number, letters as 10-35.
    const numeric = ("NL" + n)
      .split("")
      .map((ch) => (/\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)))
      .join("");
    let rem = 0;
    for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
    return { number: n, check: elevenTest || rem === 1 };
  },

  PL: (s) => (/^\d{10}$/.test(s) ? { number: s, check: mod(weighted(s, [6, 5, 7, 2, 3, 4, 5, 6, 7, -1]), 11) === 0 } : null),

  PT: (s) =>
    /^[1-9]\d{8}$/.test(s)
      ? { number: s, check: mod(11 - weighted(s, [9, 8, 7, 6, 5, 4, 3, 2]), 11) % 10 === Number(s[8]) }
      : null,

  RO: (s) => {
    if (/^[1-9]\d{1,9}$/.test(s)) {
      const body = s.slice(0, -1).padStart(9, "0");
      const check = ((10 * weighted(body, [7, 5, 3, 2, 1, 7, 5, 3, 2])) % 11) % 10;
      return { number: s, check: check === Number(s[s.length - 1]) };
    }
    if (!/^[1-9]\d{12}$/.test(s)) return null;
    // Personal numeric code (CNP).
    const century = ({ "1": 1900, "2": 1900, "3": 1800, "4": 1800, "5": 2000, "6": 2000 } as Record<string, number>)[s[0]] ?? 1900;
    if (!isRealDate(century + Number(s.slice(1, 3)), Number(s.slice(3, 5)), Number(s.slice(5, 7)))) return null;
    const county = Number(s.slice(7, 9));
    if (!((county >= 1 && county <= 48) || [51, 52, 70, 80, 81, 82, 83].includes(county))) return null;
    const r = weighted(s, [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]) % 11;
    return { number: s, check: (r === 10 ? 1 : r) === Number(s[12]) };
  },

  SE: (s) => (/^\d{10}01$/.test(s) ? { number: s, check: luhnChecksum(s.slice(0, 10)) === 0 } : null),

  SI: (s) => {
    if (!/^[1-9]\d{7}$/.test(s)) return null;
    const c = 11 - (weighted(s, [8, 7, 6, 5, 4, 3, 2]) % 11);
    if (c === 11) return { number: s, check: false };
    return { number: s, check: (c === 10 ? 0 : c) === Number(s[7]) };
  },

  SK: (s) => {
    if (!/^\d{10}$/.test(s)) return null;
    const rc = birthNumber(s);
    if (rc === true) return { number: s, check: true };
    const legal = s[0] !== "0" && "234789".includes(s[2]) && Number(s) % 11 === 0;
    return { number: s, check: legal };
  },

  GB: ukRule,
  XI: ukRule,
};

export const VAT_COUNTRIES: VatCountry[] = [
  { prefix: "AT", name: "Austria", format: "U followed by 8 digits" },
  { prefix: "BE", name: "Belgium", format: "10 digits starting with 0 or 1" },
  { prefix: "BG", name: "Bulgaria", format: "9 or 10 digits" },
  { prefix: "CY", name: "Cyprus", format: "8 digits then a letter" },
  { prefix: "CZ", name: "Czechia", format: "8, 9 or 10 digits" },
  { prefix: "DE", name: "Germany", format: "9 digits, not starting with 0" },
  { prefix: "DK", name: "Denmark", format: "8 digits, not starting with 0" },
  { prefix: "EE", name: "Estonia", format: "9 digits" },
  { prefix: "EL", name: "Greece", format: "9 digits" },
  { prefix: "ES", name: "Spain", format: "9 characters: a letter or digit, 7 digits, a letter or digit" },
  { prefix: "FI", name: "Finland", format: "8 digits" },
  { prefix: "FR", name: "France", format: "2 key characters then the 9-digit SIREN" },
  { prefix: "HR", name: "Croatia", format: "11 digits" },
  { prefix: "HU", name: "Hungary", format: "8 digits" },
  { prefix: "IE", name: "Ireland", format: "7 digits and 1 or 2 letters (older numbers have a letter, + or * second)" },
  { prefix: "IT", name: "Italy", format: "11 digits" },
  { prefix: "LT", name: "Lithuania", format: "9 or 12 digits" },
  { prefix: "LU", name: "Luxembourg", format: "8 digits" },
  { prefix: "LV", name: "Latvia", format: "11 digits" },
  { prefix: "MT", name: "Malta", format: "8 digits, not starting with 0" },
  { prefix: "NL", name: "Netherlands", format: "9 digits, the letter B, then 2 digits" },
  { prefix: "PL", name: "Poland", format: "10 digits" },
  { prefix: "PT", name: "Portugal", format: "9 digits, not starting with 0" },
  { prefix: "RO", name: "Romania", format: "2 to 10 digits" },
  { prefix: "SE", name: "Sweden", format: "12 digits ending in 01" },
  { prefix: "SI", name: "Slovenia", format: "8 digits, not starting with 0" },
  { prefix: "SK", name: "Slovakia", format: "10 digits" },
  { prefix: "GB", name: "United Kingdom", format: "9 or 12 digits, or GD/HA plus 3 digits for government bodies" },
  { prefix: "XI", name: "Northern Ireland", format: "9 or 12 digits, same rules as GB" },
];

export function normalizeVat(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-./,:]/g, "");
}

export function validateVatNumber(raw: string): VatResult {
  const normalized = normalizeVat(raw);
  const result: VatResult = { normalized, country: null, number: null, valid: false, noCheckDigit: false, checks: [] };

  let prefix = normalized.slice(0, 2);
  const greekGr = prefix === "GR";
  if (greekGr) prefix = "EL";
  const country = VAT_COUNTRIES.find((c) => c.prefix === prefix) ?? null;
  result.country = country;
  result.checks.push({
    id: "prefix",
    label: "Country prefix",
    status: country ? "pass" : "fail",
    detail: country
      ? greekGr
        ? "GR read as Greece. Greek VAT numbers officially use the prefix EL."
        : `${prefix} is ${country.name}.`
      : /^[A-Z]{2}/.test(normalized)
        ? `${prefix} is not an EU, UK or Northern Ireland VAT prefix.`
        : "Start with the two-letter VAT prefix, for example DE, FR or GB.",
  });

  if (!country) {
    result.checks.push(
      { id: "format", label: "Format", status: "skipped", detail: "Not checked without a recognised prefix." },
      { id: "checksum", label: "Check digits", status: "skipped", detail: "Not checked without a recognised prefix." },
    );
    return result;
  }

  const rest = normalized.slice(2);
  const rule = RULES[country.prefix](rest);
  result.checks.push({
    id: "format",
    label: "Format",
    status: rule ? "pass" : "fail",
    detail: rule
      ? `Matches the ${country.name} layout: ${country.format}.`
      : `"${rest || "(nothing)"}" doesn't match the ${country.name} layout: ${country.format}.`,
  });

  if (!rule) {
    result.checks.push({ id: "checksum", label: "Check digits", status: "skipped", detail: "Not checked until the format is right." });
    return result;
  }

  result.number = rule.number;
  if (rule.check === null) {
    result.noCheckDigit = true;
    result.checks.push({
      id: "checksum",
      label: "Check digits",
      status: "skipped",
      detail: "This kind of number has no check digit, so only the format can be tested.",
    });
  } else {
    result.checks.push({
      id: "checksum",
      label: "Check digits",
      status: rule.check ? "pass" : "fail",
      detail: rule.check
        ? `The check digits match the ${country.name} rule.`
        : `The check digits don't match the ${country.name} rule. A character is wrong or two are swapped.`,
    });
  }

  result.valid = result.checks.every((c) => c.status !== "fail");
  return result;
}
