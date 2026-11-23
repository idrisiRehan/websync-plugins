# Contributing

Thanks for helping. Bug reports with a failing input are the most useful contribution of all.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Each package solves one problem. A feature that needs a new dependency, a network call in
  library code, or a second responsibility probably belongs somewhere else.

## Setup

```sh
npm install
npm run check
```

Node 22.18 or later. There is no separate build step for tests: `node --test` runs the
TypeScript sources directly.

## Conventions

- **Cite the source of every rule.** Validation and grading rules link to the spec, registry or
  official algorithm they implement, in a comment next to the code. Tests use published
  examples from those sources where they exist.
- **Tests come with every change.** Cover the malformed and edge-case inputs, not only the happy
  path. A bug fix starts with a test that fails.
- **No dependencies** in published packages unless an ADR in `docs/adr/` justifies one.
- **Library code is pure.** No network, filesystem or environment access outside a package's
  CLI entry point.
- **Keep it simple.** No abstraction until a second real use needs it, and no dead code.
- **Writing style.** Plain, specific English. No em dashes anywhere (`npm run check:text`
  enforces it).
- **Changelog.** Add a line under `[Unreleased]` in the package's `CHANGELOG.md`.

## Commits and pull requests

- One logical change per pull request, with `npm run check` passing.
- Commit messages: `type(scope): summary`, for example `fix(validators): reject IBAN with lower-case country`.

## Releases

Maintainers only. See `docs/ecosystem/RELEASING.md`.
