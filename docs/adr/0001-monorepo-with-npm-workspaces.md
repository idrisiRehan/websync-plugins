# ADR 0001: One monorepo, npm workspaces, no extra build tooling

- Status: accepted
- Date: 2026-11-24

## Context

WebSync publishes small, zero-dependency TypeScript packages, maintained by one person.
`websync-validators` already exists with its own repository. More packages are planned
(TOOL-OPPORTUNITY-MATRIX.md). The brief suggested pnpm, Turborepo, ESLint, Prettier, Vitest,
Changesets and a `shared-core` package.

## Decision

- **One repository** (`websync-plugins`) with packages under `packages/<name>`.
  `websync-validators` was imported with its git history.
- **npm workspaces.** npm is already used by the site and the existing package. pnpm would add
  a tool with no gain at this size.
- **No Turborepo.** Builds take seconds. There's nothing to cache.
- **`tsc` with strict settings** (including `noUnusedLocals` and `noUnusedParameters`) as the
  static check, from one shared `tsconfig.base.json`. No ESLint or Prettier for now: the
  packages have no framework code, and strict `tsc` catches the defects lint would. Add lint
  when outside contributors arrive.
- **`node:test` with Node's built-in TypeScript type stripping.** No Vitest, no test build
  step. That's what `websync-validators` already used.
- **Manual versioning** with a per-package `CHANGELOG.md` and tag-driven releases
  (RELEASING.md). Revisit Changesets past five packages.
- **No `shared-core` package.** The packages share no runtime code today. Shared config lives
  at the root. Extract a shared module only when two published packages need the same code.
- A separate repository only for a project with a different toolchain or release cadence
  (for example a hosted MCP server).

## Consequences

- Contributors need Node 22.18 or later to run tests. Published packages declare their own
  `engines`.
- One CI workflow tests every package on every change. A change to shared config is tested
  against all packages at once.
- The published `websync-validators` 1.0.0 still points at the old repository. The next
  release points at this one (`repository.directory`). The old repository should be archived
  with a pointer here once this one is public.
