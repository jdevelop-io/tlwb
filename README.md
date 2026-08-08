# tlwb

The little whiteboard: instant, collaborative, agent-friendly.

Monorepo packages:

- `packages/engine`: framework-agnostic whiteboard engine data layer
  (element model, fractional z-ordering, board store with per-origin
  undo and redo, versioned JSON snapshots).

Requires Node.js >= 22 and pnpm >= 10. Run `pnpm install`, then
`pnpm test`.
