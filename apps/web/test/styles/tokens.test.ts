// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  new URL('../../src/styles/tokens.css', import.meta.url),
  'utf8',
)

const expected: Record<string, string> = {
  '--color-surface': '#FFFFFF',
  '--color-surface-alt': '#F7F7F5',
  '--color-border': '#E5E4E0',
  '--color-ink': '#1A1A1A',
  '--color-ink-secondary': '#6B6B6B',
  '--color-accent': '#FF6B4A',
  '--color-accent-soft': '#FFEDE8',
  '--color-agent': '#6E56CF',
  '--color-agent-soft': '#EFEBFC',
  '--color-marker-red': '#E5484D',
  '--color-marker-orange': '#FA8C16',
  '--color-marker-yellow': '#F5C518',
  '--color-marker-green': '#46A758',
  '--color-marker-blue': '#3B82F6',
  '--color-marker-violet': '#8E4EC6',
  '--color-marker-red-pastel': '#FDE8E8',
  '--color-marker-orange-pastel': '#FEF0DE',
  '--color-marker-yellow-pastel': '#FDF6D8',
  '--color-marker-green-pastel': '#E7F4E9',
  '--color-marker-blue-pastel': '#E4EEFD',
  '--color-marker-violet-pastel': '#F3EAFA',
  '--color-presence-teal': '#12A594',
  '--color-presence-pink': '#D6409F',
  '--color-success': '#46A758',
  '--text-xs': '12px',
  '--text-sm': '14px',
  '--text-base': '16px',
  '--text-lg': '20px',
  '--text-xl': '28px',
  '--text-2xl': '40px',
  '--spacing-4': '4px',
  '--spacing-8': '8px',
  '--spacing-16': '16px',
  '--spacing-24': '24px',
  '--spacing-32': '32px',
  '--spacing-48': '48px',
  '--radius-md': '8px',
  '--radius-lg': '12px',
  '--radius-full': '999px',
}

describe('tokens.css', () => {
  it('carries every Paper token verbatim', () => {
    for (const [name, value] of Object.entries(expected)) {
      expect(css, name).toMatch(new RegExp(`${name}:\\s*${value};`, 'i'))
    }
  })

  it('no longer defines the pre-Paper agent and accent-soft values', () => {
    expect(css).not.toContain('#8b7cf6')
    expect(css).not.toContain('#8B7CF6')
    expect(css).not.toContain('#ffe1d9')
  })
})
