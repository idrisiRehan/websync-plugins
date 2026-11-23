export type { CheckStatus } from "./types.ts";

export { validateVatNumber, normalizeVat, VAT_COUNTRIES } from "./vat.ts";
export type { VatCheck, VatCountry, VatResult } from "./vat.ts";

export { analyzeIban, validateIban, generateIban, formatIban, IBAN_COUNTRIES } from "./iban.ts";
export type { IbanAnalysis, IbanCheck, IbanCountry, IbanValidationResult } from "./iban.ts";

export {
  validateAbnOrAcn,
  isValidAbn,
  isValidAcn,
  abnChecksum,
  acnCheckDigit,
  formatAbn,
  formatAcn,
  normalizeAbn,
} from "./abn.ts";
export type { AbnCheck, AbnKind, AbnResult } from "./abn.ts";

export {
  validateRoutingNumber,
  routingChecksum,
  routingCheckDigit,
  readPrefix,
  normalizeRouting,
  FED_DISTRICTS,
} from "./routing.ts";
export type { RoutingCheck, RoutingResult } from "./routing.ts";

export { validateGstin, normalizeGstin, computeCheckDigit as gstinCheckDigit, withCheckDigit as withGstinCheckDigit, STATE_CODES as GSTIN_STATE_CODES } from "./gstin.ts";
export type { GstinCheck, GstinResult } from "./gstin.ts";
