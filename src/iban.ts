// IBAN generation & validation per ISO 13616 (MOD-97-10 checksum).
// BBAN formats below are the standard per-country segment layouts (bank/branch/account),
// encoded as tokens of "<count><type>" where type is n = digit, a = uppercase letter, c = alphanumeric.

import type { CheckStatus } from "./types.ts";

export interface IbanCountry {
  code: string;
  name: string;
  bbanFormat: string;
}

export const IBAN_COUNTRIES: IbanCountry[] = [
  { code: "AD", name: "Andorra", bbanFormat: "8n12c" },
  { code: "AE", name: "United Arab Emirates", bbanFormat: "3n16n" },
  { code: "AT", name: "Austria", bbanFormat: "16n" },
  { code: "BA", name: "Bosnia and Herzegovina", bbanFormat: "16n" },
  { code: "BE", name: "Belgium", bbanFormat: "12n" },
  { code: "BG", name: "Bulgaria", bbanFormat: "4a6n8c" },
  { code: "BH", name: "Bahrain", bbanFormat: "4a14c" },
  { code: "CH", name: "Switzerland", bbanFormat: "5n12c" },
  { code: "CY", name: "Cyprus", bbanFormat: "8n16c" },
  { code: "CZ", name: "Czech Republic", bbanFormat: "20n" },
  { code: "DE", name: "Germany", bbanFormat: "18n" },
  { code: "DK", name: "Denmark", bbanFormat: "14n" },
  { code: "EE", name: "Estonia", bbanFormat: "16n" },
  { code: "ES", name: "Spain", bbanFormat: "20n" },
  { code: "FI", name: "Finland", bbanFormat: "14n" },
  { code: "FO", name: "Faroe Islands", bbanFormat: "14n" },
  { code: "FR", name: "France", bbanFormat: "10n11c2n" },
  { code: "GB", name: "United Kingdom", bbanFormat: "4a6n8n" },
  { code: "GI", name: "Gibraltar", bbanFormat: "4a15c" },
  { code: "GL", name: "Greenland", bbanFormat: "14n" },
  { code: "GR", name: "Greece", bbanFormat: "7n16c" },
  { code: "HR", name: "Croatia", bbanFormat: "17n" },
  { code: "HU", name: "Hungary", bbanFormat: "24n" },
  { code: "IE", name: "Ireland", bbanFormat: "4a14n" },
  { code: "IL", name: "Israel", bbanFormat: "19n" },
  { code: "IS", name: "Iceland", bbanFormat: "22n" },
  { code: "IT", name: "Italy", bbanFormat: "1a10n12c" },
  { code: "KW", name: "Kuwait", bbanFormat: "4a22c" },
  { code: "LB", name: "Lebanon", bbanFormat: "4n20c" },
  { code: "LI", name: "Liechtenstein", bbanFormat: "5n12c" },
  { code: "LT", name: "Lithuania", bbanFormat: "16n" },
  { code: "LU", name: "Luxembourg", bbanFormat: "3n13c" },
  { code: "LV", name: "Latvia", bbanFormat: "4a13c" },
  { code: "MC", name: "Monaco", bbanFormat: "10n11c2n" },
  { code: "ME", name: "Montenegro", bbanFormat: "18n" },
  { code: "MK", name: "North Macedonia", bbanFormat: "3n10c2n" },
  { code: "MT", name: "Malta", bbanFormat: "4a5n18c" },
  { code: "NL", name: "Netherlands", bbanFormat: "4a10n" },
  { code: "NO", name: "Norway", bbanFormat: "11n" },
  { code: "PK", name: "Pakistan", bbanFormat: "4a16c" },
  { code: "PL", name: "Poland", bbanFormat: "24n" },
  { code: "PS", name: "Palestine", bbanFormat: "4a21c" },
  { code: "PT", name: "Portugal", bbanFormat: "21n" },
  { code: "QA", name: "Qatar", bbanFormat: "4a21c" },
  { code: "RO", name: "Romania", bbanFormat: "4a16c" },
  { code: "RS", name: "Serbia", bbanFormat: "18n" },
  { code: "SA", name: "Saudi Arabia", bbanFormat: "2n18c" },
  { code: "SE", name: "Sweden", bbanFormat: "20n" },
  { code: "SI", name: "Slovenia", bbanFormat: "15n" },
  { code: "SK", name: "Slovakia", bbanFormat: "20n" },
  { code: "SM", name: "San Marino", bbanFormat: "1a10n12c" },
  { code: "TR", name: "Turkey", bbanFormat: "5n1n16c" },
  { code: "VA", name: "Vatican City", bbanFormat: "3n15n" },
  // Added Nov 2026 from the current SWIFT IBAN Registry (89 countries in total, including
  // Honduras and Yemen). Brazil uses the Release 96 layout, which every real Brazilian IBAN fits.
  { code: "AL", name: "Albania", bbanFormat: "8n16c" },
  { code: "AZ", name: "Azerbaijan", bbanFormat: "4a20c" },
  { code: "BI", name: "Burundi", bbanFormat: "5n5n11n2n" },
  { code: "BR", name: "Brazil", bbanFormat: "8n5n10n1a1c" },
  { code: "BY", name: "Belarus", bbanFormat: "4c4n16c" },
  { code: "CR", name: "Costa Rica", bbanFormat: "4n14n" },
  { code: "DJ", name: "Djibouti", bbanFormat: "5n5n11n2n" },
  { code: "DO", name: "Dominican Republic", bbanFormat: "4c20n" },
  { code: "EG", name: "Egypt", bbanFormat: "4n4n17n" },
  { code: "FK", name: "Falkland Islands", bbanFormat: "2a12n" },
  { code: "GE", name: "Georgia", bbanFormat: "2a16n" },
  { code: "GT", name: "Guatemala", bbanFormat: "4c20c" },
  { code: "HN", name: "Honduras", bbanFormat: "4a20n" },
  { code: "IQ", name: "Iraq", bbanFormat: "4a3n12n" },
  { code: "JO", name: "Jordan", bbanFormat: "4a4n18c" },
  { code: "KZ", name: "Kazakhstan", bbanFormat: "3n13c" },
  { code: "LC", name: "Saint Lucia", bbanFormat: "4a24c" },
  { code: "LY", name: "Libya", bbanFormat: "3n3n15n" },
  { code: "MD", name: "Moldova", bbanFormat: "2c18c" },
  { code: "MN", name: "Mongolia", bbanFormat: "4n12n" },
  { code: "MR", name: "Mauritania", bbanFormat: "5n5n11n2n" },
  { code: "MU", name: "Mauritius", bbanFormat: "4a2n2n12n3n3a" },
  { code: "NI", name: "Nicaragua", bbanFormat: "4a20n" },
  { code: "OM", name: "Oman", bbanFormat: "3n16c" },
  { code: "RU", name: "Russia", bbanFormat: "9n5n15c" },
  { code: "SC", name: "Seychelles", bbanFormat: "4a2n2n16n3a" },
  { code: "SD", name: "Sudan", bbanFormat: "2n12n" },
  { code: "SO", name: "Somalia", bbanFormat: "4n3n12n" },
  { code: "ST", name: "Sao Tome and Principe", bbanFormat: "4n4n11n2n" },
  { code: "SV", name: "El Salvador", bbanFormat: "4a20n" },
  { code: "TL", name: "Timor-Leste", bbanFormat: "3n14n2n" },
  { code: "TN", name: "Tunisia", bbanFormat: "2n3n13n2n" },
  { code: "UA", name: "Ukraine", bbanFormat: "6n19c" },
  { code: "VG", name: "British Virgin Islands", bbanFormat: "4a16n" },
  { code: "XK", name: "Kosovo", bbanFormat: "4n10n2n" },
  { code: "YE", name: "Yemen", bbanFormat: "4a4n18c" },
].sort((a, b) => a.name.localeCompare(b.name));

const DIGITS = "0123456789";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomChar(type: "n" | "a" | "c"): string {
  const pool = type === "n" ? DIGITS : type === "a" ? LETTERS : DIGITS + LETTERS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function expandFormat(format: string): ("n" | "a" | "c")[] {
  const tokens: ("n" | "a" | "c")[] = [];
  for (const [, countStr, type] of format.matchAll(/(\d+)([nac])/g)) {
    const count = parseInt(countStr, 10);
    for (let i = 0; i < count; i++) tokens.push(type as "n" | "a" | "c");
  }
  return tokens;
}

function letterToDigits(ch: string): string {
  if (ch >= "0" && ch <= "9") return ch;
  return (ch.charCodeAt(0) - 55).toString(); // A=10 ... Z=35
}

// ISO 7064 MOD 97-10, computed in chunks since the numeric string exceeds safe integer size.
function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder;
}

function checkDigitsFor(countryCode: string, bban: string): string {
  const rearranged = bban + countryCode + "00";
  const numeric = rearranged
    .split("")
    .map(letterToDigits)
    .join("");
  const remainder = mod97(numeric);
  return (98 - remainder).toString().padStart(2, "0");
}

export function generateIban(countryCode: string): string {
  const country = IBAN_COUNTRIES.find((c) => c.code === countryCode);
  if (!country) throw new Error(`Unknown IBAN country code: ${countryCode}`);

  const bban = expandFormat(country.bbanFormat)
    .map((type) => randomChar(type))
    .join("");
  const checkDigits = checkDigitsFor(countryCode, bban);
  return `${countryCode}${checkDigits}${bban}`;
}

export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") ?? iban;
}

export interface IbanValidationResult {
  valid: boolean;
  reason?: string;
  country?: IbanCountry;
}

export function validateIban(rawIban: string): IbanValidationResult {
  const iban = rawIban.replace(/\s+/g, "").toUpperCase();

  if (!/^[A-Z0-9]+$/.test(iban)) {
    return { valid: false, reason: "IBAN can only contain letters and digits." };
  }
  if (iban.length < 5) {
    return { valid: false, reason: "IBAN is too short." };
  }

  const countryCode = iban.slice(0, 2);
  const country = IBAN_COUNTRIES.find((c) => c.code === countryCode);
  if (!country) {
    return { valid: false, reason: `Unrecognized country code "${countryCode}".` };
  }

  const expectedLength = 4 + expandFormat(country.bbanFormat).length;
  if (iban.length !== expectedLength) {
    return {
      valid: false,
      reason: `${country.name} IBANs are ${expectedLength} characters long (found ${iban.length}).`,
      country,
    };
  }

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.split("").map(letterToDigits).join("");

  if (mod97(numeric) !== 1) {
    return { valid: false, reason: "Checksum does not match (invalid IBAN).", country };
  }

  return { valid: true, country };
}

// Step-by-step analysis. validateIban() above stops at the first
// failure and returns one reason; this runs every check it can and reports each one, so the
// validator can show which part of the IBAN is wrong.

export interface IbanCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface IbanAnalysis {
  normalized: string;
  formatted: string;
  valid: boolean;
  checks: IbanCheck[];
  country: IbanCountry | null;
  checkDigits: string | null;
  bban: string | null;
  /** Check digits the BBAN and country code actually produce, when the length is right. */
  expectedCheckDigits: string | null;
}

const TYPE_WORDS: Record<"n" | "a" | "c", string> = { n: "digit", a: "letter", c: "letter or digit" };

function matchesType(ch: string, type: "n" | "a" | "c"): boolean {
  if (type === "n") return ch >= "0" && ch <= "9";
  if (type === "a") return ch >= "A" && ch <= "Z";
  return /[A-Z0-9]/.test(ch);
}

export function analyzeIban(raw: string): IbanAnalysis {
  // IBANs are written in groups of four, and printed copies sometimes start with "IBAN".
  const normalized = raw.replace(/[\s-]/g, "").toUpperCase().replace(/^IBAN/, "");
  const result: IbanAnalysis = {
    normalized,
    formatted: formatIban(normalized),
    valid: false,
    checks: [],
    country: null,
    checkDigits: null,
    bban: null,
    expectedCheckDigits: null,
  };
  const skip = (id: string, label: string, why: string) =>
    result.checks.push({ id, label, status: "skipped", detail: why });

  const charsOk = /^[A-Z0-9]+$/.test(normalized);
  result.checks.push({
    id: "characters",
    label: "Letters and digits only",
    status: charsOk ? "pass" : "fail",
    detail: charsOk
      ? "Only letters and digits remain once spaces are removed."
      : "An IBAN contains only letters and digits. Remove any other symbols.",
  });

  const countryCode = normalized.slice(0, 2);
  const country = /^[A-Z]{2}$/.test(countryCode) ? (IBAN_COUNTRIES.find((c) => c.code === countryCode) ?? null) : null;
  result.country = country;
  result.checks.push({
    id: "country",
    label: "Country code",
    status: country ? "pass" : "fail",
    detail: country
      ? `${countryCode} is ${country.name}.`
      : /^[A-Z]{2}$/.test(countryCode)
        ? `${countryCode} is not a country in the SWIFT IBAN Registry.`
        : "An IBAN starts with a two-letter country code.",
  });

  const checkDigitsOk = /^\d{2}$/.test(normalized.slice(2, 4));
  if (normalized.length >= 4) result.checkDigits = normalized.slice(2, 4);

  if (!country) {
    skip("length", "Length", "Not checked without a recognised country code.");
    skip("format", "Account part format", "Not checked without a recognised country code.");
    skip("checksum", "Check digits (MOD 97)", "Not checked without a recognised country code.");
    return result;
  }

  const types = expandFormat(country.bbanFormat);
  const expectedLength = 4 + types.length;
  const lengthOk = normalized.length === expectedLength;
  result.checks.push({
    id: "length",
    label: "Length",
    status: lengthOk ? "pass" : "fail",
    detail: lengthOk
      ? `${expectedLength} characters, the length of a ${country.name} IBAN.`
      : `${normalized.length} characters. ${country.name} IBANs have exactly ${expectedLength}.`,
  });

  if (!lengthOk || !charsOk) {
    skip("format", "Account part format", "Not checked until the length is right.");
    skip("checksum", "Check digits (MOD 97)", "Not checked until the length is right.");
    return result;
  }

  const bban = normalized.slice(4);
  result.bban = bban;
  const badIndex = types.findIndex((type, i) => !matchesType(bban[i], type));
  const formatOk = checkDigitsOk && badIndex === -1;
  result.checks.push({
    id: "format",
    label: "Account part format",
    status: formatOk ? "pass" : "fail",
    detail: !checkDigitsOk
      ? "Characters 3 and 4 must be digits: they are the check digits."
      : badIndex === -1
        ? `Each character after the check digits fits the ${country.name} layout.`
        : `Character ${badIndex + 5} is "${bban[badIndex]}", but the ${country.name} layout needs a ${TYPE_WORDS[types[badIndex]]} there.`,
  });

  const expected = checkDigitsFor(countryCode, bban);
  result.expectedCheckDigits = expected;
  const numeric = (bban + normalized.slice(0, 4)).split("").map(letterToDigits).join("");
  const checksumOk = mod97(numeric) === 1;
  result.checks.push({
    id: "checksum",
    label: "Check digits (MOD 97)",
    status: checksumOk ? "pass" : "fail",
    detail: checksumOk
      ? `The check digits ${normalized.slice(2, 4)} match the rest of the IBAN.`
      : `The IBAN has check digits ${normalized.slice(2, 4)}, but the rest of it gives ${expected}. A character is wrong or two are swapped.`,
  });

  result.valid = result.checks.every((c) => c.status === "pass");
  return result;
}
