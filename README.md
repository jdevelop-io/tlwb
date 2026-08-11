# tlwb

[![CI](https://github.com/jdevelop-io/tlwb/actions/workflows/ci.yml/badge.svg)](https://github.com/jdevelop-io/tlwb/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The little whiteboard: instant, collaborative, agent-friendly.

Monorepo packages:

- `packages/engine`: framework-agnostic whiteboard engine, data layer,
  rendering, and interactions (element model, fractional z-ordering,
  board store with per-origin undo and redo, versioned JSON snapshots,
  camera and viewport math, sketchy shape and free-drawing rendering,
  canvas text and images, an invalidation-driven render loop). The
  interaction layer hit-tests on real geometry and runs one state
  machine per tool, with group and lasso selection, resize and rotate
  handles, alignment snapping, arrow bindings that follow their shapes,
  keyboard shortcuts, and a headless controller that routes pointer and
  keyboard input without touching the DOM.

## Getting started

Requires Node.js >= 22 and pnpm >= 11. The exact pnpm version is pinned
in the root `packageManager` field, which any pnpm from version 10
onwards reads and honors automatically.

```bash
pnpm install
pnpm test
```

## Contributing

Read the [contributing guide](CONTRIBUTING.md) for the development setup,
the checks to run, and the pull request process. Everyone taking part is
expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security vulnerability, follow the
[security policy](SECURITY.md) rather than opening a public issue.

## License

[MIT](LICENSE)
