# Changelog

All notable changes to `websync-validators` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Moved into the `websync-plugins` monorepo (`packages/validators`). The published API is unchanged.

## [1.0.0] - 2026-11-21

### Added

- `validateVatNumber` for the 27 EU member states, GB and XI.
- `analyzeIban`, `validateIban`, `generateIban` and `formatIban` for all 89 SWIFT IBAN Registry countries.
- `validateAbnOrAcn`, `isValidAbn` and `isValidAcn` for Australian business and company numbers.
- `validateRoutingNumber` for US ABA routing numbers.
- `validateGstin` for Indian GST identification numbers.
