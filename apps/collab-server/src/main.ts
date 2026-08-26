import { ConfigError, loadConfig } from './config'
import { log } from './log'
import { startServer } from './server'

let config: ReturnType<typeof loadConfig>
try {
  config = loadConfig(process.env)
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}

const server = await startServer(config).catch((error: unknown) => {
  log({ event: 'boot failed', error: String(error) })
  process.exit(1)
})

let closing = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (closing) {
      return
    }
    closing = true
    log({ event: 'signal', signal })
    void server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        log({ event: 'shutdown failed', error: String(error) })
        process.exit(1)
      },
    )
  })
}
