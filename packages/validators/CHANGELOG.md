# Changelog

All notable changes to `websync-validators` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - Unreleased (ready, awaiting publish approval)

### Added

- `validateGtin`, `isValidGtin`, `gtinCheckDigit`, `convertGtin` and `normalizeGtin` for
  GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13) and GTIN-14, including GS1 packaging indicator
  digits. Ported from the GTIN Converter on websync.in. A differential test over 200,000
  inputs gave the same results as the site.
- `validateIsbn`, `isValidIsbn`, `isbn10CheckDigit`, `isbn10To13`, `isbn13To10` and
  `normalizeIsbn`.

### Changed

- Moved into the `websync-plugins` monorepo (`packages/validators`). Existing exports are
  unchanged.

## [1.0.0] - 2026-11-21

### Added

- `validateVatNumber` for the 27 EU member states, GB and XI.
- `analyzeIban`, `validateIban`, `generateIban` and `formatIban` for all 89 SWIFT IBAN Registry countries.
- `validateAbnOrAcn`, `isValidAbn` and `isValidAcn` for Australian business and company numbers.
- `validateRoutingNumber` for US ABA routing numbers.
- `validateGstin` for Indian GST identification numbers.
