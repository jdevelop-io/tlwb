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
  it('exposes the resume hook and links nowhere the anonymous application does not serve', () => {
    const doc = new DOMParser().parseFromString(markup, 'text/html')
    expect(doc.getElementById('resume')).not.toBeNull()
    expect(doc.getElementById('session-link')).toBeNull()
    const hrefs = Array.from(doc.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    )
    for (const forbidden of [
      '/login',
      '/dashboard',
      '/privacy',
      '/terms',
      '#pricing',
    ]) {
      expect(hrefs).not.toContain(forbidden)
    }
    expect(doc.getElementById('pricing')).toBeNull()
  })
})
