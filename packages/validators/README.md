# websync-validators

Offline validators for business and bank identifiers, with check-digit maths for each country's rules:

- **EU, UK and Northern Ireland VAT numbers**: all 27 EU member states, GB and XI
- **IBANs**: all 89 countries in the SWIFT IBAN Registry
- **Australian ABNs and ACNs**
- **US ABA routing numbers**
- **Indian GSTINs**

Each validator returns a list of individual checks (format, length, check digits and so on), each marked `pass`, `fail` or `skipped`. You can tell a user *what* is wrong, not just that something is.

Zero dependencies and no network calls: it runs the same in Node, the browser, edge runtimes and workers. Written in TypeScript, types included.

Each validator has a free browser version on websync.in: [VAT number checker](https://websync.in/tools/vat-number-checker/), [IBAN validator](https://websync.in/tools/iban-validator/), [ABN validator](https://websync.in/tools/abn-validator/), [routing number validator](https://websync.in/tools/routing-number-validator/) and [GSTIN validator](https://websync.in/tools/gstin-validator/).

## Install

```sh
npm install websync-validators
```

The package is ESM. Node 18+ for `import`; Node 20.19+ or 22.12+ can also `require()` it.

## Usage

### VAT numbers (EU 27, GB, XI)

```ts
import { validateVatNumber } from "websync-validators";

const r = validateVatNumber("DE 136 695 976");
r.valid;            // true
r.country?.name;    // "Germany"
r.number;           // "136695976" (normalised, prefix removed)
r.checks;           // [{ id: "prefix", ... }, { id: "format", ... }, { id: "checksum", status: "pass", ... }]
```

- Spaces, dots, hyphens and case are ignored.
- Greece is `EL`; `GR` is accepted and flagged.
- Old Belgian (9-digit) and Greek (8-digit) numbers are padded.
- UK government department (`GD`) and health authority (`HA`) numbers have no check digit. They come back `valid: true` with `noCheckDigit: true`.

### IBANs

```ts
import { analyzeIban, validateIban, generateIban } from "websync-validators";

const r = analyzeIban("GB29 NWBK 6016 1331 9268 19");
r.valid;               // true
r.formatted;           // "GB29 NWBK 6016 1331 9268 19"
r.country?.name;       // "United Kingdom"
r.bban;                // "NWBK60161331926819"

analyzeIban("DE88370400440532013000").expectedCheckDigits; // "89"

validateIban("DE89370400440532013000"); // { valid: true, country }: short form, first failure only
generateIban("FR");                     // random, checksum-correct test IBAN (not a real account)
```

`analyzeIban` runs five checks:

1. characters
2. country code
3. length for that country
4. per-position layout of the account part (BBAN)
5. MOD 97-10 check digits

### Australian ABN / ACN

```ts
import { validateAbnOrAcn, isValidAbn, isValidAcn } from "websync-validators";

const r = validateAbnOrAcn("51 824 753 556");
r.kind;         // "abn" (11 digits) or "acn" (9 digits), detected from length
r.valid;        // true
r.formatted;    // "51 824 753 556"
r.embeddedAcn;  // the last nine digits when they also pass the ACN check (company ABNs do)

isValidAbn("51824753556"); // true
isValidAcn("004085616");   // true
```

### US routing numbers (ABA RTN)

```ts
import { validateRoutingNumber } from "websync-validators";

const r = validateRoutingNumber("011000015");
r.valid;          // true
r.district;       // "Boston" (Federal Reserve district from the first two digits)
r.prefixMeaning;  // "Bank or credit union"
```

It checks for nine digits, an assigned first-two-digit range, and the 3-7-1 weighted checksum.

### Indian GSTINs

```ts
import { validateGstin } from "websync-validators";

const r = validateGstin("27AAPFU0939F1ZV");
r.valid;          // true
r.stateName;      // "Maharashtra"
r.pan;            // "AAPFU0939F"
r.panHolderType;  // the holder type encoded in the PAN's 4th letter
```

## What a pass means, and what it doesn't

Every check here is arithmetic on the characters, so a pass means the identifier is **well formed**. It does not mean the identifier was issued, is active, or belongs to who you think. For that, use the official registers:

- **VAT numbers:** the European Commission's VIES (EU and XI) or HMRC's checker (GB)
- **ABNs:** ABN Lookup
- **GSTINs:** the GST portal
- **IBANs and routing numbers:** the bank

Validate offline first to catch typos instantly, then confirm with the register when it matters.

## Sources

- **VAT number rules** were reimplemented from the public algorithm descriptions in [python-stdnum](https://github.com/arthurdejong/python-stdnum). Its published test numbers are part of this package's test suite; the code is not copied.
- **IBAN layouts** follow the current SWIFT IBAN Registry: 89 countries, including Honduras and Yemen.
- **ABN and ACN checks** follow the ATO's and ASIC's published algorithms.
- **Routing number checks** follow the ABA checksum and prefix ranges.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)
