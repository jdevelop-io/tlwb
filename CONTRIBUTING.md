# Contributing to tlwb

Thanks for your interest in tlwb. This guide covers everything you need
to get from a clone to a merged pull request.

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Requirements

- Node.js >= 22
- pnpm >= 11

The exact pnpm version is pinned in the root `packageManager` field. Any
pnpm from version 10 onwards reads that field and switches to the pinned
version automatically, so you do not have to install a specific one by
hand.

## Getting started

```bash
git clone https://github.com/jdevelop-io/tlwb.git
cd tlwb
pnpm install
pnpm test
```

## Repository layout

- `packages/engine`: the framework-agnostic whiteboard engine. Its data
  layer holds the element model, fractional z-ordering, the board store
  with per-origin undo and redo, and the versioned JSON snapshot format.

## Checks

Run all three before opening a pull request. Continuous integration runs
the same commands, so a green local run is a green pipeline.

```bash
pnpm check      # formatting, lint rules, and import order (Biome)
pnpm typecheck  # tsc --noEmit across the workspace
pnpm test       # Vitest across the workspace
```

`pnpm check:write` applies the formatting and safe lint fixes for you.

## Tests

Tests are written with Vitest and drive development: write the failing
test first, then the code that makes it pass. Tests exercise real
behavior through public interfaces rather than mocks.

The board store has one behavioral contract, `describeBoardStoreContract`
in `packages/engine/src/store/contract.ts`, exported from the package as
`@tlwb/engine/testing`. Every store implementation must satisfy it. When
you change what a store guarantees, change the contract, not just one
implementation.

## Commit messages

Commits follow [gitmoji](https://gitmoji.dev) plus
[Conventional Commits](https://www.conventionalcommits.org):

```
<emoji> <type>(<optional scope>): <summary>
```

For example:

```
✨ feat(engine): add fractional z-order utilities
🐛 fix(store): stop leaking internal element state
📝 docs: describe the snapshot format
```

Write the summary in the imperative mood and state the actual objective.

## Pull requests

1. Branch off `main`.
2. Keep the change focused. Several small pull requests are easier to
   review than one large one.
3. Add or update the tests that cover your change.
4. Make sure `pnpm check`, `pnpm typecheck`, and `pnpm test` all pass.
5. Describe what the change does and why. Link any related issue.

Review comments follow
[Conventional Comments](https://conventionalcomments.org), so expect
feedback labelled `suggestion`, `question`, `nitpick`, and the like. A
label such as `nitpick` or `(non-blocking)` means the comment does not
hold up the merge.

## Reporting bugs and requesting features

Open an [issue](https://github.com/jdevelop-io/tlwb/issues) using the
matching template. For anything security related, follow the
[security policy](SECURITY.md) instead of opening a public issue.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
