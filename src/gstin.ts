// Offline GSTIN validation.
//
// A GSTIN is 15 characters: a 2-digit state code, a 10-character PAN, a 1-character entity
// number, the fixed letter "Z", and a check digit computed over the first 14 characters.
// Every one of those checks can be run in the browser with no network call, because the
// check digit is arithmetic over the string itself. What none of it can tell you is whether
// the number was ever issued, or is still active. Only the GST portal knows that.

import type { CheckStatus } from "./types.ts";

/** Value alphabet for the check-digit sum: index 0-35 maps to '0'-'9' then 'A'-'Z'. */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Published state/UT codes that may appear as the first two digits of a GSTIN. */
export const STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu (old code)",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (pre-bifurcation code)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

/**
 * Fourth character of a PAN encodes the holder type. Useful context, never a pass/fail
 * condition: an unrecognised letter still makes a structurally valid GSTIN.
 */
const PAN_HOLDER_TYPES: Record<string, string> = {
  A: "Association of Persons (AOP)",
  B: "Body of Individuals (BOI)",
  C: "Company",
  F: "Firm or LLP",
  G: "Government",
  H: "Hindu Undivided Family (HUF)",
  J: "Artificial Juridical Person",
  L: "Local Authority",
  P: "Individual",
  T: "Trust",
};

const FULL_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;


export interface GstinCheck {
  id: "length" | "pattern" | "state" | "checkdigit";
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface GstinResult {
  normalized: string;
  valid: boolean;
  checks: GstinCheck[];
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  panHolderType: string | null;
  entityCode: string | null;
  expectedCheckDigit: string | null;
  providedCheckDigit: string | null;
}

/** Strip spaces, hyphens and case so a pasted value from a PDF still validates. */
export function normalizeGstin(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Check digit for the first 14 characters, per the published GSTIN algorithm.
 *
 * Each character's alphabet index is multiplied by a weight that alternates 1, 2, 1, 2 …
 * starting at 1 for the first character. Both halves of the product (quotient and remainder
 * over 36) are added to the running sum. The check digit is whatever brings that sum up to
 * the next multiple of 36.
 *
 * Returns null if any of the 14 characters falls outside the alphabet.
 */
export function computeCheckDigit(first14: string): string | null {
  if (first14.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = ALPHABET.indexOf(first14[i]);
    if (value === -1) return null;
    const weight = i % 2 === 0 ? 1 : 2;
    const product = value * weight;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

/** Build a valid GSTIN from a 14-character prefix by appending its correct check digit. */
export function withCheckDigit(first14: string): string | null {
  const digit = computeCheckDigit(normalizeGstin(first14));
  return digit === null ? null : normalizeGstin(first14) + digit;
}

export function validateGstin(raw: string): GstinResult {
  const normalized = normalizeGstin(raw);

  const result: GstinResult = {
    normalized,
    valid: false,
    checks: [],
    stateCode: null,
    stateName: null,
    pan: null,
    panHolderType: null,
    entityCode: null,
    expectedCheckDigit: null,
    providedCheckDigit: null,
  };

  // Check 1: length.
  const lengthOk = normalized.length === 15;
  result.checks.push({
    id: "length",
    label: "Length is 15 characters",
    status: lengthOk ? "pass" : "fail",
    detail: lengthOk
      ? "15 characters, ignoring spaces and hyphens."
      : `Got ${normalized.length} character${normalized.length === 1 ? "" : "s"}. A GSTIN is always 15.`,
  });

  if (!lengthOk) {
    for (const id of ["pattern", "state", "checkdigit"] as const) {
      result.checks.push({
        id,
        label: labelFor(id),
        status: "skipped",
        detail: "Not checked until the length is right.",
      });
    }
    return result;
  }

  // Check 2: character pattern, position by position.
  const patternOk = FULL_PATTERN.test(normalized);
  result.checks.push({
    id: "pattern",
    label: "Character pattern",
    status: patternOk ? "pass" : "fail",
    detail: patternOk
      ? "Two digits, a valid PAN, an entity character, then Z."
      : describePatternFailure(normalized),
  });

  // Positional pieces are worth showing even when the pattern check fails, since they
  // narrow down where the typo is.
  const stateCode = normalized.slice(0, 2);
  const pan = normalized.slice(2, 12);
  result.stateCode = stateCode;
  result.entityCode = normalized.slice(12, 13);
  result.providedCheckDigit = normalized.slice(14, 15);
  if (PAN_PATTERN.test(pan)) {
    result.pan = pan;
    result.panHolderType = PAN_HOLDER_TYPES[pan[3]] ?? null;
  }

  // Check 3: state code.
  const stateName = STATE_CODES[stateCode] ?? null;
  result.stateName = stateName;
  result.checks.push({
    id: "state",
    label: "State code",
    status: stateName ? "pass" : "fail",
    detail: stateName
      ? `${stateCode} is ${stateName}.`
      : `${stateCode} is not on the published list of state and UT codes.`,
  });

  // Check 4: check digit.
  const expected = computeCheckDigit(normalized.slice(0, 14));
  result.expectedCheckDigit = expected;
  const checkDigitOk = expected !== null && expected === result.providedCheckDigit;
  result.checks.push({
    id: "checkdigit",
    label: "Check digit",
    status: expected === null ? "fail" : checkDigitOk ? "pass" : "fail",
    detail:
      expected === null
        ? "The first 14 characters contain something outside 0-9 and A-Z, so no check digit can be computed."
        : checkDigitOk
          ? `The 15th character (${expected}) matches the checksum of the first 14.`
          : `The 15th character is ${result.providedCheckDigit}. The checksum of the first 14 characters gives ${expected}.`,
  });

  result.valid = result.checks.every((c) => c.status === "pass");
  return result;
}

function labelFor(id: GstinCheck["id"]): string {
  if (id === "length") return "Length is 15 characters";
  if (id === "pattern") return "Character pattern";
  if (id === "state") return "State code";
  return "Check digit";
}

function describePatternFailure(value: string): string {
  const problems: string[] = [];
  if (!/^[0-9]{2}/.test(value)) problems.push("characters 1-2 must be digits (the state code)");
  if (!PAN_PATTERN.test(value.slice(2, 12))) {
    problems.push("characters 3-12 must be a PAN: five letters, four digits, one letter");
  }
  if (!/^[0-9A-Z]$/.test(value.slice(12, 13))) problems.push("character 13 must be a digit or a letter");
  if (value[13] !== "Z") problems.push(`character 14 must be the letter Z, not "${value[13]}"`);
  if (!/^[0-9A-Z]$/.test(value.slice(14, 15))) problems.push("character 15 must be a digit or a letter");
  return problems.join("; ") + ".";
}
