# ADR 0003: Packages may depend on each other, resolved from source in development

- Status: accepted
- Date: 2026-11-24

## Context

`product-csv-lint` validates barcode columns. `websync-validators` already has tested GTIN and
ISBN check digits. Copying them would break DRY. Depending on them breaks the "zero runtime
dependencies" line from ADR 0001.

There is also a tooling problem. In a workspace, `import "websync-validators"` resolves through
the package's `exports` to `dist/`, which doesn't exist on a fresh clone. Typecheck and tests
would then depend on build order, and npm runs workspace scripts alphabetically, so
`validators` builds last.

## Decision

1. **A package may depend on another package from this repository.** Third-party runtime
   dependencies still need their own ADR. The dependent declares a normal semver range
   (`"websync-validators": "^1.1.0"`), so the published package installs it from npm like any
   other dependency.
2. **Development resolves internal packages from source** through a custom export condition:
   - The depended-on package adds `"websync-source": "./src/index.ts"` as the first entry in
     its `exports` map.
   - `tsconfig.base.json` sets `"customConditions": ["websync-source"]`, so typecheck and
     builds read the TypeScript source.
   - Test scripts run `node --conditions=websync-source --test ...`, so Node loads the source
     through type stripping.
   - Consumers never set this condition, so they get `dist/` as usual. The condition name is
     namespaced so it can't collide with other tools' conventions.
3. **Release order matters.** A dependency must be published before a package that needs its
   new version (here: `websync-validators` 1.1.0 before `product-csv-lint` 1.0.0).

## Verification

- With every `dist/` deleted, `product-csv-lint` typechecks, tests and builds. Its compiled
  output imports `websync-validators` by name and doesn't copy any of its code.

## Consequences

- `websync-validators` stays dependency-free. `product-csv-lint` has one dependency, from the
  same maintainer, with no dependencies of its own.
- The CLIs still repeat about 20 lines of argument handling (ADR 0002). A shared CLI helper
  package would now be possible under this ADR. It isn't worth a published package for 20
  lines, so this stays as it is unless the helpers grow.
