import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(
  path.join(import.meta.dirname, '../../index.html'),
  'utf8',
)

// Strip <link>/<script> tags before parsing: happy-dom's DOMParser
// otherwise tries to actually fetch the stylesheets and the module
// script, which this test has no server to serve.
const markup = html
  .replace(/<link\b[^>]*>/gi, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')

describe('index.html', () => {
  it('exposes the DOM hooks recents.ts depends on', () => {
    const doc = new DOMParser().parseFromString(markup, 'text/html')

    const sessionLink = doc.getElementById('session-link')
    expect(sessionLink).toBeInstanceOf(HTMLAnchorElement)

    expect(doc.getElementById('resume')).not.toBeNull()
  })
})
