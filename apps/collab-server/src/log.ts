/** One JSON line per event on stdout; no logging library. */
export function log(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...event }))
}
