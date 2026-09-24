import { describe, expect, it } from 'vitest'
import { renderResume } from '../../src/landing/recents'

describe('renderResume', () => {
  it('renders nothing for an empty index', () => {
    const container = document.createElement('div')
    renderResume(container, [])
    expect(container.innerHTML).toBe('')
  })

  it('lists up to five boards as links', () => {
    const container = document.createElement('div')
    renderResume(
      container,
      Array.from({ length: 7 }, (_, i) => ({
        id: `b${i}`,
        name: i === 0 ? '' : `Board ${i}`,
        updatedAt: 1,
      })),
    )
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(5)
    expect(links[0]?.getAttribute('href')).toBe('/b/b0')
    expect(links[0]?.textContent).toContain('Untitled')
    expect(container.querySelector('h2')?.textContent).toBe('Resume')
  })
})
