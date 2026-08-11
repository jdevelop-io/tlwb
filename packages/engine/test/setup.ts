import { Path2D } from '@napi-rs/canvas'

// The engine references the DOM Path2D global; tests run in Node where
// @napi-rs/canvas provides the implementation.
globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D
