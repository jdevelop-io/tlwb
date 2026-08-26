// Persistence and assets run against IndexedDB; Node has none, so the
// in-memory implementation registers the globals for every test file.
import 'fake-indexeddb/auto'
