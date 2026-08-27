// The session layer persists to IndexedDB; happy-dom has none.
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// RTL's own auto-cleanup only registers when `afterEach` is a global,
// which this project does not enable; wire it explicitly instead so
// each component test starts from an empty document.
afterEach(cleanup)
