import { fileURLToPath } from 'node:url'
import { GlobalFonts, Path2D } from '@napi-rs/canvas'

// The engine references the DOM Path2D global; tests run in Node where
// @napi-rs/canvas provides the implementation.
globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D

// Caveat (SIL OFL, see test/visual/fixtures/OFL.txt) keeps text
// rasterization identical on every platform Skia runs on.
GlobalFonts.registerFromPath(
  fileURLToPath(new URL('./visual/fixtures/Caveat.ttf', import.meta.url)),
  'Caveat',
)
