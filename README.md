# tlwb

[![CI](https://github.com/jdevelop-io/tlwb/actions/workflows/ci.yml/badge.svg)](https://github.com/jdevelop-io/tlwb/actions/workflows/ci.yml)

The little whiteboard: instant, collaborative, agent-friendly.

Monorepo packages:

- `packages/engine`: framework-agnostic whiteboard engine data layer
  (element model, fractional z-ordering, board store with per-origin
  undo and redo, versioned JSON snapshots).

Requires Node.js >= 22 and pnpm >= 11. The exact pnpm version is pinned
in the root `packageManager` field, so `corepack enable` is enough to
match it. Run `pnpm install`, then `pnpm test`.
