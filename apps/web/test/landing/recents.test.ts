import { describe, expect, it } from 'vitest'
import type { Me } from '../../src/auth/client'
import { renderResume, renderSession } from '../../src/landing/recents'

const me: Me = { name: 'Ada', email: 'ada@x.com', image: null, plan: 'free' }

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

describe('renderSession', () => {
  it('links to sign in when signed out', () => {
    const link = document.createElement('a')
    renderSession(link, null)
    expect(link.getAttribute('href')).toBe('/login')
    expect(link.textContent).toBe('Sign in')
  })

  it('links to the dashboard when signed in', () => {
    const link = document.createElement('a')
    renderSession(link, me)
    expect(link.getAttribute('href')).toBe('/dashboard')
    expect(link.textContent).toBe('Dashboard')
  })
})
