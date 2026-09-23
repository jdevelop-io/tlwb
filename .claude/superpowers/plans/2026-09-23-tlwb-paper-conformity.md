# tlwb Paper Conformity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every screen of `apps/web` a faithful reproduction of the approved Paper artboards (Foundations tokens, Editor and its Share, Selection and Connect-agent variants, Landing, Dashboard with its Over-quota variant, Agents with its New-token modals), adding the small server surface the Agents screen needs (named, scoped, multiple API tokens with a last-used timestamp).

**Architecture:** Tokens first: `apps/web/src/styles/tokens.css` becomes a verbatim copy of the Paper token set (same CSS variable names), the engine palette and overlay theme align to it, and every later task rewrites one screen's markup and stylesheet against the Paper JSX export. The dashboard becomes a three-view shell (Boards, Agents, Settings) behind one HTML entry with a shared sidebar. The collab-server `api_keys` table gains `name`, `board_ids` and `last_used_at`, and the MCP tools refuse boards outside a token's scope. Every screen task ends with a 1440x900 Playwright capture compared against the Paper screenshot.

**Tech Stack:** React 19, Vite 7 multi-page app, plain CSS with custom properties, `@fontsource/{inter,caveat,jetbrains-mono}`, `lucide-react` (only where the Paper icon is a stock Lucide glyph; every other icon is the inline SVG exported from Paper), Vitest 4 + Testing Library + happy-dom, Playwright 1.55, Hono + Drizzle + Postgres on the server, Biome for lint and format.

**Spec:** `.claude/superpowers/specs/2026-08-07-tlwb-product-design.md` (product design, section 7 visual direction) and the Paper file `The Little WhiteBoard` (id `01KZEFY604R62YDMJWD9455BYA`, pages Foundations `2-0`, Editor `3-0`, Landing `4-0`, Dashboard `5-0`, Agents `6-0`). The Paper file is the source of truth for every pixel value below; the JSX and computed styles quoted in this plan were exported from it on 2026-09-23. When a value in this plan and the Paper file disagree, re-export with `get_jsx(format: "inline-styles")` and the Paper file wins.

## Global Constraints

- Every color, font, size, spacing and radius comes from `apps/web/src/styles/tokens.css`; no new hex literal in any `.css` or `.tsx` under `apps/web/src` except the ones this plan lists (`#FFFFFF` on colored buttons, `#1A1A1A0A`/`#1A1A1A0F`/`#1A1A1A1F`/`#1A1A1A59`/`#1A1A1A38`/`#FFFFFFB8` as named shadow and overlay tokens).
- Token names are the Paper names: `--color-*`, `--font-*`, `--text-*`, `--font-weight-*`, `--spacing-*`, `--radius-*`. Legacy names (`--paper`, `--muted`, `--accent`, `--space-N`, `--radius`, `--shadow`) survive only as aliases until Task 12 deletes them; a task that rewrites a stylesheet migrates it to Paper names.
- Icons: Paper draws Lucide-style thin icons at 1.5 to 1.8 stroke. Use the inline SVG from the Paper export for logotype underlines, sketches, agent bot, share, copy, lock and the toolbar; keep `lucide-react` only where already used and the glyph matches (toolbar tool icons keep Lucide at `size={20}`, `strokeWidth={1.5}`).
- Copy is English and verbatim from the artboards. Deviations from an artboard are listed in "Documented deviations" and nowhere else; do not invent others.
- Artboard sizes: 1440x900 for editor, dashboard, agents; landing is 1440 wide with fit-content height. Every screen must still work at 400px wide (flex wraps, sidebar collapses per Task 6).
- Light mode only.
- Tests: Vitest for components (`apps/web/test/**`), server routes (`apps/collab-server/test/**`, needs `DATABASE_URL`, `docker compose up -d postgres` from the repository root), Playwright for the 1440x900 capture (`apps/web/e2e`). Run `pnpm -r typecheck` and `pnpm biome check --write .` before every commit.
- Commits: gitmoji + Conventional Commits, English, no attribution trailers, no reference to this plan or its task numbers.
- Paper session protocol when a task reads the Paper file: `get_guide({ topic: "paper-mcp-instructions" })` once, then `get_jsx` / `get_computed_styles` for values, `get_screenshot` only to verify. Never read sizes or colors from a screenshot.

## Documented deviations

These are the only places where the code intentionally departs from the artboard. Each is a product or safety decision the user can overturn.

1. **Read-only boards over quota.** The `Dashboard / Over quota` artboard badges two boards "Read-only". The approved accounts specification (2026-08-28, section 2) states the cap gates creation only and nothing is ever frozen. The banner and the "Board limit reached" ghost card are built; the "Read-only" badge is not.
2. **Order buttons.** The style panel artboard shows two order buttons (bring to front, send to back). The editor supports four commands; the four keep the artboard's button style in one row.
3. **New token flow.** The modal artboard shows the configuration snippet already filled. A token has to exist before its key can be shown, so step 2 shows one primary "Create token" button until the token exists, then swaps in the snippet. Cancel before creation creates nothing; after creation the token stays listed.
4. **Step 3 copy.** "Ask your agent to list your boards" names a tool that does not exist. The code says "Ask your agent to read one of your boards." Everything else in the sentence is verbatim.
5. **Legal links.** The landing footer keeps `Privacy` and `Terms` links (legal obligation) next to the artboard's `GitHub · Made by JDevelop`.
6. **Resume list.** The landing keeps the "Resume" list of recent local boards under the hero call to action (it exists today and is a retention feature), styled as quiet pills.
7. **Board card menu.** The card artboard has no delete affordance. The existing "more" button stays, visible on hover and focus only, so a board can still be deleted.
8. **Share dialog first state.** Before a board is hosted the dialog shows a single "Create link" primary button (existing behavior); the artboard only shows the hosted state.

---

## File structure

**apps/web** (modified unless marked new)
- `src/styles/tokens.css`: the Paper token set, shadows, overlay, legacy aliases.
- `src/styles/ui.css` (new): shared primitives used by three or more screens: `.button-primary`, `.button-secondary`, `.pill`, `.logotype`, `.ghost-card`, `.dialog`. Loaded by every HTML entry after tokens.
- `src/board/session/palette.ts`: marker colors aligned to tokens.
- `src/board/components/top-bar.tsx|css`, `toolbar.tsx|css`, `presence-stack.tsx|css`, `zoom-controls.tsx|css`, `help-button.tsx`, `overflow-menu.css`, `board.css`, `context-panel.tsx|css`, `share-dialog.tsx|css`, `board-app.tsx`: editor chrome.
- `src/board/components/logotype.tsx` (new): the `tlwb` wordmark with its coral underline, sized by a prop, reused by editor, landing, dashboard, login.
- `src/board/components/agent-icon.tsx` (new): the bot SVG from Paper, sized by a prop.
- `index.html`, `src/landing/landing.css`, `src/landing/recents.ts`: landing.
- `dashboard.html`, `src/dashboard/main.tsx`, `dashboard-app.tsx`, `sidebar.tsx` (new), `boards-view.tsx` (new, extracted from `dashboard-app.tsx`), `board-card.tsx`, `agents-view.tsx` (new), `new-token-dialog.tsx` (new), `settings.tsx`, `relative-time.ts` (new), `api.ts`, `dashboard.css`.
- `login.html`, `src/login/login.css`.
- `vite.config.ts`, `Caddyfile`: `/dashboard/*` routes.
- `package.json`: `@fontsource/jetbrains-mono`.
- `e2e/visual.spec.ts` (new): 1440x900 captures of each screen for the review gate.

**packages/engine**
- `src/render/overlay.ts`: agent color and label font.
- `src/render/scene.ts`: clear before fill so a transparent background works.

**apps/collab-server**
- `src/db/schema.ts`, `src/migrations/0004_named_api_keys.sql` (generated), `src/accounts/api-keys.ts`, `src/accounts/cleanup.ts`, `src/http.ts`, `src/mcp/caller.ts`, `src/mcp/index.ts`, `src/mcp/tools/{read-board,add-elements,update-elements,delete-elements,get-board-screenshot}.ts`.
- Tests: `test/accounts/api-keys.test.ts`, `test/accounts/api-key-http.test.ts`, `test/mcp/tools.test.ts`.

---

### Task 1: Paper tokens as the single stylesheet source

**Files:**
- Modify: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/ui.css`
- Modify: `apps/web/package.json` (add `@fontsource/jetbrains-mono`)
- Modify: `apps/web/src/board/session/palette.ts`
- Modify: `packages/engine/src/render/overlay.ts:20-26`
- Modify: `apps/web/test/components/context-panel.test.tsx:19-20` (marker hex)
- Test: `apps/web/test/styles/tokens.test.ts` (new)

**Interfaces:**
- Produces: CSS variables with the exact Paper names listed below; `STROKE_COLORS` and `FILL_COLORS` in `palette.ts` carrying the Paper marker values in the order black, red, orange, yellow, green, blue, violet (this order is also the Paper swatch order); `DEFAULT_OVERLAY_THEME.agent === '#6E56CF'`.

- [ ] **Step 1: Write the failing token test**

```ts
// apps/web/test/styles/tokens.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8')

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
      expect(css, name).toMatch(new RegExp(`${name}:\\s*${value};`))
    }
  })

  it('no longer defines the pre-Paper agent and accent-soft values', () => {
    expect(css).not.toContain('#8b7cf6')
    expect(css).not.toContain('#8B7CF6')
    expect(css).not.toContain('#ffe1d9')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @tlwb/web test -- tokens`
Expected: FAIL, `--color-surface` not matched.

- [ ] **Step 3: Install the mono font and rewrite tokens.css**

Run: `pnpm --filter @tlwb/web add @fontsource/jetbrains-mono`

```css
/* apps/web/src/styles/tokens.css */
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/500.css";
@import "@fontsource/inter/600.css";
@import "@fontsource/caveat/500.css";
@import "@fontsource/caveat/600.css";
@import "@fontsource/caveat/700.css";
@import "@fontsource/jetbrains-mono/400.css";

/* Paper file "The Little WhiteBoard", page Foundations. Same names. */
:root {
  --color-surface: #FFFFFF;
  --color-surface-alt: #F7F7F5;
  --color-border: #E5E4E0;
  --color-ink: #1A1A1A;
  --color-ink-secondary: #6B6B6B;
  --color-accent: #FF6B4A;
  --color-accent-soft: #FFEDE8;
  --color-agent: #6E56CF;
  --color-agent-soft: #EFEBFC;
  --color-marker-black: var(--color-ink);
  --color-marker-red: #E5484D;
  --color-marker-orange: #FA8C16;
  --color-marker-yellow: #F5C518;
  --color-marker-green: #46A758;
  --color-marker-blue: #3B82F6;
  --color-marker-violet: #8E4EC6;
  --color-marker-red-pastel: #FDE8E8;
  --color-marker-orange-pastel: #FEF0DE;
  --color-marker-yellow-pastel: #FDF6D8;
  --color-marker-green-pastel: #E7F4E9;
  --color-marker-blue-pastel: #E4EEFD;
  --color-marker-violet-pastel: #F3EAFA;
  --color-presence-teal: #12A594;
  --color-presence-pink: #D6409F;
  --color-success: #46A758;
  --color-danger: #C92A2A;
  --font-ui: "Inter", system-ui, sans-serif;
  --font-hand: "Caveat", cursive;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --text-xs: 12px;
  --text-sm: 14px;
  --text-base: 16px;
  --text-lg: 20px;
  --text-xl: 28px;
  --text-2xl: 40px;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-16: 16px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 999px;

  /* Elevation, as measured on the artboards. */
  --shadow-sm: 0 1px 2px #1A1A1A0A;
  --shadow-md: 0 1px 2px #1A1A1A0A, 0 4px 12px #1A1A1A0F;
  --shadow-lg: 0 8px 32px #1A1A1A1F;
  --overlay: #1A1A1A59;
  --swatch-border: #1A1A1A38;

  /* Legacy aliases, removed once every stylesheet uses Paper names. */
  --paper: var(--color-surface-alt);
  --surface: var(--color-surface);
  --border: var(--color-border);
  --ink: var(--color-ink);
  --muted: var(--color-ink-secondary);
  --accent: var(--color-accent);
  --accent-soft: var(--color-accent-soft);
  --agent: var(--color-agent);
  --danger: var(--color-danger);
  --radius: var(--radius-md);
  --shadow: var(--shadow-md);
  --space-1: var(--spacing-4);
  --space-2: var(--spacing-8);
  --space-3: var(--spacing-16);
  --space-4: var(--spacing-24);
  --space-5: 40px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  font: var(--font-weight-regular) var(--text-sm) / 1.5 var(--font-ui);
  color: var(--color-ink);
  background: var(--color-surface);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

button,
input,
textarea {
  font: inherit;
  color: inherit;
}
```

- [ ] **Step 4: Create the shared primitives stylesheet**

```css
/* apps/web/src/styles/ui.css */
.button-primary,
.button-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-8);
  height: 36px;
  padding-inline: 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: 20px;
  text-decoration: none;
  cursor: pointer;
}

.button-primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #FFFFFF;
}

.button-secondary {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-ink);
}

.button-quiet {
  border: 0;
  background: none;
  color: var(--color-ink-secondary);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding-inline: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface-alt);
  color: var(--color-ink-secondary);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  line-height: 14px;
}

.pill-agent {
  border-color: transparent;
  background: var(--color-agent-soft);
  color: var(--color-agent);
  font-weight: var(--font-weight-semibold);
}

.pill-agent::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-agent);
}

.ghost-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1.5px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-ink-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  cursor: pointer;
}

.dialog {
  padding: var(--spacing-24);
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.dialog::backdrop {
  background: var(--overlay);
}

.dialog-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  line-height: 28px;
}

.dialog-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-ink-secondary);
  cursor: pointer;
}

.divider {
  height: 1px;
  margin: 0;
  border: 0;
  background: var(--color-border);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.caption {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 16px;
  color: var(--color-ink-secondary);
}
```

Link it from every entry after `tokens.css`: `index.html`, `board.html`, `dashboard.html`, `login.html`, `privacy.html`, `terms.html` get
`<link rel="stylesheet" href="/src/styles/ui.css" />`.

- [ ] **Step 5: Align the engine palette and the overlay theme**

```ts
// apps/web/src/board/session/palette.ts
import type { FontConfig } from '@tlwb/engine'

/** Ink first, then the six markers, in the Paper swatch order. */
export const STROKE_COLORS: readonly string[] = [
  '#1A1A1A',
  '#E5484D',
  '#FA8C16',
  '#F5C518',
  '#46A758',
  '#3B82F6',
  '#8E4EC6',
]

/** No fill, then the pastel of each marker, same order. */
export const FILL_COLORS: readonly (string | null)[] = [
  null,
  '#FDE8E8',
  '#FEF0DE',
  '#FDF6D8',
  '#E7F4E9',
  '#E4EEFD',
  '#F3EAFA',
]

/** The board's own white: every export of it. */
export const BOARD_BACKGROUND = '#FFFFFF'

export const FONTS: FontConfig = {
  hand: 'Caveat, cursive',
  ui: 'Inter, system-ui, sans-serif',
}
```

In `packages/engine/src/render/overlay.ts` change the default theme:

```ts
export const DEFAULT_OVERLAY_THEME: OverlayTheme = {
  selection: '#FF6B4A',
  guide: '#FF6B4A',
  lassoFill: 'rgba(255, 107, 74, 0.08)',
  agent: '#6E56CF',
  labelFont: '500 11px Inter, system-ui, sans-serif',
}
```

Update `apps/web/test/components/context-panel.test.tsx` line 19 and 20: `'Stroke #E5484D'` and `{ strokeColor: '#E5484D' }`. Grep `packages/engine/test` for `#8B7CF6` and update any assertion to `#6E56CF`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/engine test && pnpm -r typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/styles apps/web/test/styles apps/web/package.json pnpm-lock.yaml apps/web/*.html apps/web/src/board/session/palette.ts apps/web/test/components/context-panel.test.tsx packages/engine/src/render/overlay.ts packages/engine/test
git commit -m "💄 style(web): adopt the Paper design tokens as the stylesheet source"
```

---

### Task 2: Shared logotype and agent icon components

**Files:**
- Create: `apps/web/src/board/components/logotype.tsx`
- Create: `apps/web/src/board/components/agent-icon.tsx`
- Test: `apps/web/test/components/logotype.test.tsx`

**Interfaces:**
- Produces: `Logotype(props: { size: 'editor' | 'sidebar' | 'nav' | 'footer'; href?: string })` rendering `tlwb` in Caveat 600 over the coral underline path, as an `<a>` when `href` is given, otherwise a `<span>`. Sizes (font-size / line-height / underline width x height / underline path / stroke): editor 24/26/42x5 `M2 3.4 C 12 1.4, 22 3.8, 40 1.8` 2.2; sidebar 26/26/44x6 `M1.5 4 C 11.5 1.8, 22.5 4.8, 42.5 2.5` 2; nav 34/34/60x8 `M2 5.5 C 16 2.5, 31 6.5, 58 3.5` 3; footer 26/26/46x7 `M2 4.5 C 12 2, 24 5.5, 44 3` 2.5.
- Produces: `AgentIcon(props: { size: number; color?: string; strokeWidth?: number })` rendering the Paper bot: `<rect x="5" y="9" width="14" height="10" rx="2.5"/> <path d="M12 5v4"/> <circle cx="12" cy="4" r="1"/> <path d="M9.5 14h.01M14.5 14h.01" strokeWidth={2}/>` on a 24 viewBox, `fill="none"`, `stroke={color ?? 'currentColor'}`, round caps and joins, default strokeWidth 1.5.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/components/logotype.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Logotype } from '../../src/board/components/logotype'

describe('Logotype', () => {
  it('links home with the wordmark and its underline', () => {
    render(<Logotype size="nav" href="/" />)
    const link = screen.getByRole('link', { name: 'tlwb' })
    expect(link).toHaveAttribute('href', '/')
    expect(link.querySelector('svg')).toHaveAttribute('width', '60')
  })

  it('renders as text when no href is given', () => {
    render(<Logotype size="editor" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('tlwb')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @tlwb/web test -- logotype`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both components**

```tsx
// apps/web/src/board/components/logotype.tsx
const SIZES = {
  editor: { font: 24, line: 26, width: 42, height: 5, path: 'M2 3.4 C 12 1.4, 22 3.8, 40 1.8', stroke: 2.2 },
  sidebar: { font: 26, line: 26, width: 44, height: 6, path: 'M1.5 4 C 11.5 1.8, 22.5 4.8, 42.5 2.5', stroke: 2 },
  nav: { font: 34, line: 34, width: 60, height: 8, path: 'M2 5.5 C 16 2.5, 31 6.5, 58 3.5', stroke: 3 },
  footer: { font: 26, line: 26, width: 46, height: 7, path: 'M2 4.5 C 12 2, 24 5.5, 44 3', stroke: 2.5 },
} as const

export function Logotype(props: { size: keyof typeof SIZES; href?: string }) {
  const size = SIZES[props.size]
  const content = (
    <>
      <span style={{ fontSize: size.font, lineHeight: `${size.line}px` }}>tlwb</span>
      <svg width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
        <path d={size.path} fill="none" stroke="var(--color-accent)" strokeWidth={size.stroke} strokeLinecap="round" />
      </svg>
    </>
  )
  return props.href ? (
    <a href={props.href} className="logotype">{content}</a>
  ) : (
    <span className="logotype">{content}</span>
  )
}
```

Add to `ui.css`:

```css
.logotype {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  color: var(--color-ink);
  font-family: var(--font-hand);
  font-weight: 600;
  text-decoration: none;
}
```

```tsx
// apps/web/src/board/components/agent-icon.tsx
export function AgentIcon(props: { size: number; color?: string; strokeWidth?: number }) {
  const stroke = props.color ?? 'currentColor'
  const width = props.strokeWidth ?? 1.5
  const common = { fill: 'none', stroke, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="9" width="14" height="10" rx="2.5" strokeWidth={width} {...common} />
      <path d="M12 5v4" strokeWidth={width} {...common} />
      <circle cx="12" cy="4" r="1" strokeWidth={width} {...common} />
      <path d="M9.5 14h.01M14.5 14h.01" strokeWidth={width + 0.5} {...common} />
    </svg>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tlwb/web test -- logotype`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/board/components/logotype.tsx apps/web/src/board/components/agent-icon.tsx apps/web/src/styles/ui.css apps/web/test/components/logotype.test.tsx
git commit -m "✨ feat(web): add the shared logotype and agent icon components"
```

---

### Task 3: Editor chrome (top bar, toolbar, presence, zoom, help, dot grid)

**Files:**
- Modify: `apps/web/src/board/components/top-bar.tsx`, `top-bar.css`
- Modify: `apps/web/src/board/components/toolbar.tsx`, `toolbar.css`
- Modify: `apps/web/src/board/components/presence-stack.tsx`, `presence-stack.css`
- Modify: `apps/web/src/board/components/zoom-controls.tsx`, `zoom-controls.css`
- Modify: `apps/web/src/board/components/help-button.tsx`, `overflow-menu.css`, `board.css`
- Modify: `apps/web/src/board/components/board-app.tsx:65-66` (transparent live background)
- Modify: `packages/engine/src/render/scene.ts:67` (clear before fill)
- Test: `apps/web/test/components/top-bar.test.tsx`, `presence-stack.test.tsx`, `toolbar.test.tsx` (existing, extend)

**Interfaces:**
- Consumes: `Logotype`, `AgentIcon` from Task 2; tokens from Task 1.
- Produces: no new exports. Every export call in `apps/web/src` (`exportPng(`, `exportSvg(`; grep them, they live in `overflow-menu.tsx` and `board-actions.ts`) passes `{ background: BOARD_BACKGROUND }` explicitly because the live editor now paints on transparent.

Paper values (artboard `Editor / Default`, node `G5-0`):

| Group | Position | Box |
|---|---|---|
| Top left | left 16, top 16 | height 48, padding-inline 14, gap 12, radius-lg, border 1 border, shadow-md, surface |
| Toolbar | centered, top 16 | padding 6, gap 2, radius-lg, border, shadow-md; tool 36x36 radius-md; active tool background accent-soft, icon and shortcut accent; shortcut 9px/10px weight 500, right 4 bottom 2, color ink-secondary when inactive; dividers 1x22 border after Hand and before Eraser |
| Top right | right 16, top 16 | height 48, gap 12, no box: presence stack (avatars 34px, 2px colored ring, 2px white halo `box-shadow: 0 0 0 2px surface`, overlapping by 26px step, initials 12px/600 ink on surface-alt; agent avatar agent-soft with `AgentIcon size 16 color agent` and a 14px agent badge bottom -4 right -4 holding a white 8px bot), Share button (`button-primary`, height 36, padding-inline 16, gap 8, share SVG 15px), overflow 36x36 surface, border, radius-md, shadow-sm, three 1.6 radius dots |
| Bottom left | left 16, bottom 16 | two boxes gap 10: each padding 4, radius-md, border, shadow-md; buttons 32x32 radius 6; zoom level 46px wide 13px/500 centered; redo icon ink-secondary when disabled |
| Bottom right | right 16, bottom 16 | 36x36 radius-full, border, shadow-md, `?` 18px |
| Canvas | | dot grid: `background-image: radial-gradient(var(--color-border) 1px, transparent 1px); background-size: 24px 24px` on `.board`, surface behind |

- [ ] **Step 1: Extend the failing tests**

Add to `apps/web/test/components/top-bar.test.tsx` (inside its existing `describe`, reuse its render helper):

```tsx
  it('shows the saved indicator with its check icon and the rename pencil', () => {
    renderTopBar()
    const indicator = screen.getByText('Saved')
    expect(indicator.previousElementSibling?.tagName).toBe('svg')
    expect(screen.getByRole('button', { name: 'Rename board' })).toBeInTheDocument()
  })
```

Add to `apps/web/test/components/presence-stack.test.tsx`:

```tsx
  it('marks the agent avatar with the bot icon and badge', () => {
    renderStack({ peers: [{ id: 'a', name: 'Claude', color: '#6E56CF', isAgent: true }] })
    const avatar = screen.getByRole('button', { name: 'Claude (agent)' })
    expect(avatar.querySelectorAll('svg')).toHaveLength(2)
  })
```

Add to `apps/web/test/components/toolbar.test.tsx`:

```tsx
  it('separates hand from shapes and image from eraser', () => {
    const { container } = render(<Toolbar editor={fakeEditor()} onPickImage={() => undefined} />)
    expect(container.querySelectorAll('.toolbar-divider')).toHaveLength(2)
  })
```

Adapt the helper names (`renderTopBar`, `renderStack`) to whatever those files already define; if they render inline, inline the same props.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tlwb/web test -- top-bar presence-stack toolbar`
Expected: 3 FAIL.

- [ ] **Step 3: Rewrite the top bar**

In `top-bar.tsx` replace the `<a className="logo">` with `<Logotype size="editor" href={me ? '/dashboard' : '/'} />`, keep the menu toggle, add after the name input a rename pencil button and the indicator with its check:

```tsx
      <span className="top-bar-divider" aria-hidden="true" />
      <input className="board-name" ... />
      <button
        type="button"
        className="rename"
        aria-label="Rename board"
        onClick={() => nameInputRef.current?.focus()}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="indicator">
        {indicator === 'Saved' || indicator === 'Synced' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12.5 L 9.5 18 L 20 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
        {indicator}
      </span>
```

`nameInputRef` is a `useRef<HTMLInputElement>(null)` attached to the name input.

```css
/* top-bar.css: replace the box rules */
.top-bar {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  max-width: calc(50vw - 247px);
  padding-inline: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  z-index: 10;
}

.top-bar-divider {
  flex: none;
  width: 1px;
  height: 22px;
  background: var(--color-border);
}

.board-name {
  min-width: 0;
  width: 160px;
  padding: 0;
  border: 0;
  background: none;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: 20px;
}

.board-name:focus {
  outline: 0;
  border-bottom: 1px solid var(--color-border);
}

.rename {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-ink-secondary);
  cursor: pointer;
}

.indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-ink-secondary);
  font-size: var(--text-xs);
  line-height: 16px;
}
```

Keep the existing `.menu-toggle` and `.board-menu` rules, migrated to Paper token names (`var(--paper)` becomes `var(--color-surface-alt)`, and so on).

- [ ] **Step 4: Rewrite the toolbar**

In `toolbar.tsx`, add `divider?: true` to the entries for `hand` and `image` (the divider paints after them) and render:

```tsx
      {TOOLS.map(({ type, label, key, Icon, divider }) => (
        <Fragment key={type}>
          <label className="tool" title={`${label} (${key})`}>
            <input type="radio" name="tool" ... />
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
            <kbd>{key}</kbd>
          </label>
          {divider ? <span className="toolbar-divider" aria-hidden="true" /> : null}
        </Fragment>
      ))}
```

```css
/* toolbar.css */
.toolbar {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  z-index: 10;
}

.toolbar-divider {
  flex: none;
  width: 1px;
  height: 22px;
  margin-inline: 4px;
  background: var(--color-border);
}

.tool {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  color: var(--color-ink);
  cursor: pointer;
}

.tool input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.tool:has(input:checked) {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.tool kbd {
  position: absolute;
  right: 4px;
  bottom: 2px;
  font-family: var(--font-ui);
  font-size: 9px;
  font-weight: var(--font-weight-medium);
  line-height: 10px;
  color: var(--color-ink-secondary);
}

.tool:has(input:checked) kbd {
  color: var(--color-accent);
}
```

- [ ] **Step 5: Rewrite the presence stack**

`presence-stack.tsx`: the `Avatar` gets `style={{ '--ring': ringColor(props.color) }}` and, when `isAgent`, renders `<AgentIcon size={16} color="var(--color-agent)" />` plus `<span className="avatar-badge"><AgentIcon size={8} color="#FFFFFF" strokeWidth={2.5} /></span>` instead of the initial; its accessible name becomes `${name} (agent)`. The share button gets the share SVG:

```tsx
<button type="button" className="button-primary share" onClick={props.onShare}>
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="6" cy="12" r="2.5" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
    <circle cx="17.5" cy="5.5" r="2.5" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
    <circle cx="17.5" cy="18.5" r="2.5" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
    <path d="M8.3 10.8 L15.2 6.8 M8.3 13.2 L15.2 17.2" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
  Share
</button>
```

```css
/* presence-stack.css */
.presence-stack {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  max-width: calc(100vw - 32px);
  z-index: 10;
}

.presence-avatars {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 2px;
  overflow: auto hidden;
}

.avatar {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-left: -8px;
  border: 2px solid var(--ring, var(--color-ink-secondary));
  border-radius: var(--radius-full);
  background: var(--color-surface-alt);
  box-shadow: 0 0 0 2px var(--color-surface);
  color: var(--color-ink);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
}

.avatar:first-child {
  margin-left: 0;
}

.avatar-agent {
  border-color: var(--color-agent);
  background: var(--color-agent-soft);
}

.avatar-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-surface);
  border-radius: var(--radius-full);
  background: var(--color-agent);
}
```

Remove the old `.avatar-agent { outline }` and `.presence-stack .share` rules. The overflow button (`overflow-menu.css`) becomes `width: 36px; height: 36px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); box-shadow: var(--shadow-sm);` with the three-dot SVG (`<circle cx="5|12|19" cy="12" r="1.6" fill="currentColor" />`) instead of the Lucide glyph.

- [ ] **Step 6: Rewrite zoom, help, canvas**

`zoom-controls.tsx` renders two sibling boxes: `.zoom-cluster` (zoom out, level, zoom in) and `.history-cluster` (undo, redo), each `className="cluster"`:

```css
/* zoom-controls.css */
.zoom-controls {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 10;
}

.cluster {
  display: flex;
  align-items: center;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
}

.cluster button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--color-ink);
  cursor: pointer;
}

.cluster button:disabled {
  color: var(--color-ink-secondary);
  cursor: default;
}

.zoom-level {
  width: 46px;
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  line-height: 18px;
  text-align: center;
}
```

Zoom icons are the Paper paths at 14px (`M5 12h14` minus; plus adds `M12 5v14`), undo/redo the Paper paths at 15px (`M9 14 4 9l5-5` + `M4 9h10.5a5.5 5.5 0 0 1 0 11H11`, mirrored for redo), stroke 1.6 to 1.8, `currentColor`.

`board.css`:

```css
.board {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: var(--color-surface);
  background-image: radial-gradient(var(--color-border) 1px, transparent 1px);
  background-size: 24px 24px;
}

.help-button {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  z-index: 10;
}
```

In `board-app.tsx` line 66 pass `background: 'transparent'` to `createEditor`, and in every `exportPng(` / `exportSvg(` call under `apps/web/src` pass `background: BOARD_BACKGROUND` in the options object. In `packages/engine/src/render/scene.ts` add `ctx.clearRect(0, 0, canvas.width, canvas.height)` immediately before the `ctx.fillStyle = background` line (line 67) so a transparent fill leaves no stale pixels.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/engine test && pnpm -r typecheck`
Expected: all PASS. If an engine test asserts an opaque pixel at the canvas corner after render, keep it: the engine default background stays `#FFFFFF`; only the web app passes `transparent`.

- [ ] **Step 8: Visual check**

Run: `pnpm --filter @tlwb/web dev` in the background, open `http://localhost:5173/b/new` at 1440x900 in Chrome (`mcp__claude-in-chrome__*`, `resize_window` 1440x900) and screenshot. Compare against `get_screenshot(nodeId: "G5-0")`. Fix spacing, then stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/board packages/engine/src/render/scene.ts apps/web/test/components
git commit -m "💄 style(web): rebuild the editor chrome on the Paper artboard"
```

---

### Task 4: Style panel (Editor / Selection)

**Files:**
- Modify: `apps/web/src/board/components/context-panel.tsx`, `context-panel.css`
- Test: `apps/web/test/components/context-panel.test.tsx` (existing, extend)

**Interfaces:**
- Consumes: `STROKE_COLORS`, `FILL_COLORS` from Task 1 (same order as the Paper swatches).
- Produces: the same `ContextPanel(props)` signature; radio accessible names unchanged (`Stroke #E5484D`, `Fill none`, `Stroke width 2`, `Stroke style dashed`, `Font size 28`), plus a range input named `Sketchiness`.

Paper values (node `10M-0`): left 24, top 120, width 248, padding 16, gap 16 between sections, radius-lg, border, shadow-md. Section label 12px/500 ink-secondary, 8px above its row. Swatches 24px round, gap 8; selected swatch `box-shadow: 0 0 0 2px surface, 0 0 0 3.5px ink`; fill swatches have a 1px `--swatch-border` border, the "none" swatch is surface with a diagonal 1.25 ink-secondary line. Segmented rows (width, style, text size): buttons flex 1, height 28, radius-md, border; selected = accent-soft background, accent border, accent content. Order buttons height 32. Sketchiness is a range: 3px track border, filled part accent, thumb 13px surface with 1.5 accent ring.

- [ ] **Step 1: Extend the failing test**

```tsx
  it('exposes sketchiness as a slider and marks the selected swatch', () => {
    const editor = fakeEditor({ activeTool: 'rectangle' })
    render(<ContextPanel editor={editor} store={new InMemoryBoardStore()} />)
    const slider = screen.getByRole('slider', { name: 'Sketchiness' })
    fireEvent.change(slider, { target: { value: '2' } })
    expect(editor.setDefaults).toHaveBeenCalledWith({ roughness: 2 })
    expect(screen.getByRole('radio', { name: 'Stroke #1A1A1A' })).toBeChecked()
  })
```

Check the actual default key name in `context-panel.tsx` (the `Sketchiness` choice group patches it today); use that key in the assertion instead of `roughness` if it differs.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @tlwb/web test -- context-panel`
Expected: FAIL, no slider.

- [ ] **Step 3: Rewrite the panel**

Replace the `Sketchiness` `Choice` with:

```tsx
      <label className="section">
        <span className="section-label">Sketchiness</span>
        <input
          type="range"
          className="slider"
          aria-label="Sketchiness"
          min={0}
          max={2}
          step={1}
          value={current.roughness}
          onChange={(event) => patch({ roughness: Number(event.target.value) })}
        />
      </label>
```

Where `current` and `patch` are the panel's existing accessors for the shown value and the defaults-or-selection update. Give every `Choice` group `className="section"` on the fieldset and `className="section-label"` on the legend; give color choices `data-kind="swatch"` and the others `data-kind="segment"`. Rename `Font size` labels to `S`, `M`, `L` visually (values unchanged, accessible name unchanged). Order buttons keep their four commands and get the two Paper icons for front/back plus the Lucide `ChevronUp`/`ChevronDown` at 16px for forward/backward.

```css
/* context-panel.css */
.context-panel {
  position: absolute;
  top: 120px;
  left: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 248px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  z-index: 10;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.section-label {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  line-height: 16px;
  color: var(--color-ink-secondary);
}

.section-row {
  display: flex;
  gap: 8px;
}

.choice-item {
  position: relative;
  cursor: pointer;
}

.choice-item input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

[data-kind="swatch"] .choice-item {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
}

[data-kind="swatch"] .choice-item:has(input:checked) {
  box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 3.5px var(--color-ink);
}

.swatch {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
}

.swatch-fill {
  border: 1px solid var(--swatch-border);
}

.swatch[data-none] {
  background: var(--color-surface) linear-gradient(135deg, transparent 47%, var(--color-ink-secondary) 47%, var(--color-ink-secondary) 53%, transparent 53%);
}

[data-kind="segment"] .choice-item {
  flex: 1;
  display: grid;
  place-items: center;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-ink);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}

[data-kind="segment"] .choice-item:has(input:checked) {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.slider {
  width: 100%;
  height: 16px;
  margin: 0;
  accent-color: var(--color-accent);
}

.z-order {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.z-order button {
  flex: 1;
  display: grid;
  place-items: center;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-ink);
  cursor: pointer;
}
```

Stroke width samples: a 24px wide bar of 1.5 / 2.5 / 4 px height, radius-full, current color. Stroke style samples: 24x4 SVG line, solid and `strokeDasharray="4 4"`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tlwb/web test -- context-panel`
Expected: PASS.

- [ ] **Step 5: Visual check** against `get_screenshot(nodeId: "T5-0")` after selecting a shape at 1440x900, as in Task 3 step 8.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/board/components/context-panel.tsx apps/web/src/board/components/context-panel.css apps/web/test/components/context-panel.test.tsx
git commit -m "💄 style(web): rebuild the style panel on the Paper selection artboard"
```

---

### Task 5: Share dialog (Editor / Share modal)

**Files:**
- Modify: `apps/web/src/board/components/share-dialog.tsx`, `share-dialog.css`
- Test: `apps/web/test/components/share-dialog.test.tsx` (existing, extend)

**Interfaces:**
- Consumes: `AgentIcon`, `.dialog` primitives.
- Produces: `ShareDialog` gains `onConnectAgent?: () => void`; when given, the "Connect an agent" button calls it, otherwise the button is an `<a href="/login">`. Task 10 wires it.

Paper values (node `Z5-0`): width 440, padding 24, gap 20, radius-lg, shadow-lg, overlay `--overlay`. Header: title 20/600, close 28x28 with a 16px X. Link row: input 36px tall, surface-alt, border, left radii only, 12px padding, 14px text; Copy button attached on the right, accent, right radii only, 14px padding, copy SVG 14px + "Copy" 14/500 white. Access: `ACCESS` 12/500 letter-spacing 0.05em ink-secondary; segmented control 36px tall surface-alt radius-md padding 2, two halves, selected half surface + border + shadow-sm + radius 6 + ink text, other half ink-secondary; caption "Anyone with the link can jump in, no account needed." 12px ink-secondary. Divider. Agent block: 36px agent-soft square radius-md with `AgentIcon size 20 color agent`, title "Let your agent work on this board" 14/500, sub "It joins with its own cursor and draws live, through MCP." 12px. Button "Connect an agent" `button-secondary` full width.

- [ ] **Step 1: Extend the failing test**

```tsx
  it('offers the agent connection and the segmented access control', async () => {
    const onConnectAgent = vi.fn()
    renderHosted({ onConnectAgent }) // the file's helper that renders with keys present
    expect(screen.getByRole('radio', { name: 'Can view' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Can edit' })).toBeChecked()
    expect(screen.getByText('Anyone with the link can jump in, no account needed.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect an agent' }))
    expect(onConnectAgent).toHaveBeenCalled()
  })

  it('sends a signed-out visitor to sign in to connect an agent', () => {
    renderHosted()
    expect(screen.getByRole('link', { name: 'Connect an agent' })).toHaveAttribute('href', '/login')
  })
```

Rename the existing `View only` radio accessible name to `Can view` in the component and in any test asserting it.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- share-dialog`
Expected: FAIL.

- [ ] **Step 3: Rewrite the hosted state**

```tsx
    <dialog ref={dialogRef} className="dialog share-dialog" onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">Share this board</h2>
        <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {/* first state (no keys yet): existing paragraph + <button className="button-primary">Create link</button> */}
      <div className="share-link">
        <input aria-label="Share link" readOnly value={link ?? ''} />
        <button type="button" className="share-copy" aria-live="polite" onClick={() => void copy()}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <fieldset className="share-access">
        <legend>Access</legend>
        <div className="segmented">
          <label><input type="radio" name="role" aria-label="Can view" checked={effectiveRole === 'view'} onChange={() => setRole('view')} />Can view</label>
          <label><input type="radio" name="role" aria-label="Can edit" checked={effectiveRole === 'edit'} onChange={() => setRole('edit')} disabled={!keys?.editKey} />Can edit</label>
        </div>
        <p className="caption">Anyone with the link can jump in, no account needed.</p>
      </fieldset>
      <hr className="divider" />
      <section className="share-agent">
        <span className="share-agent-icon"><AgentIcon size={20} color="var(--color-agent)" /></span>
        <div>
          <p className="share-agent-title">Let your agent work on this board</p>
          <p className="caption">It joins with its own cursor and draws live, through MCP.</p>
        </div>
      </section>
      {props.onConnectAgent ? (
        <button type="button" className="button-secondary" onClick={props.onConnectAgent}>Connect an agent</button>
      ) : (
        <a className="button-secondary" href="/login">Connect an agent</a>
      )}
    </dialog>
```

```css
/* share-dialog.css */
.share-dialog {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: min(440px, calc(100vw - 32px));
}

.share-dialog[open] { display: flex; }

.share-link {
  display: flex;
}

.share-link input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding-inline: 12px;
  border: 1px solid var(--color-border);
  border-right: 0;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  background: var(--color-surface-alt);
  font-size: var(--text-sm);
}

.share-copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding-inline: 14px;
  border: 0;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--color-accent);
  color: #FFFFFF;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.share-access {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.share-access legend {
  padding: 0;
  margin-bottom: 8px;
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-ink-secondary);
}

.segmented {
  display: flex;
  height: 36px;
  padding: 2px;
  border-radius: var(--radius-md);
  background: var(--color-surface-alt);
}

.segmented label {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--color-ink-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.segmented input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
}

.segmented label:has(input:checked) {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  color: var(--color-ink);
}

.share-agent {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.share-agent-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-agent-soft);
}

.share-agent-title {
  margin: 0 0 2px;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: 18px;
}

.share-dialog .error {
  color: var(--color-danger);
}
```

Remove the old `.close` footer button; the header X closes.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @tlwb/web test -- share-dialog`
Expected: PASS.

- [ ] **Step 5: Visual check** against `get_screenshot(nodeId: "N7-0")`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/board/components/share-dialog.tsx apps/web/src/board/components/share-dialog.css apps/web/test/components/share-dialog.test.tsx
git commit -m "💄 style(web): rebuild the share dialog on the Paper artboard"
```

---

### Task 6: Dashboard shell (sidebar, routes, boards view)

**Files:**
- Create: `apps/web/src/dashboard/sidebar.tsx`
- Create: `apps/web/src/dashboard/boards-view.tsx` (the boards grid, header, banners, extracted from `dashboard-app.tsx`)
- Create: `apps/web/src/dashboard/relative-time.ts`
- Modify: `apps/web/src/dashboard/dashboard-app.tsx` (shell + view switch), `board-card.tsx`, `dashboard.css`, `main.tsx`
- Modify: `apps/web/vite.config.ts:15-20`, `apps/web/Caddyfile` (routes `/dashboard/agents`, `/dashboard/settings`)
- Test: `apps/web/test/dashboard/relative-time.test.ts` (new), `apps/web/test/dashboard/dashboard-app.test.tsx` (existing, adapt), `apps/web/test/dashboard/sidebar.test.tsx` (new)

**Interfaces:**
- Consumes: `Logotype`, `AgentIcon`, `.button-primary`, `.pill`, `.ghost-card`.
- Produces:
  - `Sidebar(props: { active: 'boards' | 'agents' | 'settings'; user: { name: string; image: string | null; plan: 'free' | 'pro' }; boardCount: number; cap: number | null; billing: boolean; onUpgrade: () => void })`.
  - `BoardsView(props: { me: MeResponse; boards: DashboardBoard[]; cap: number | null; onCreate: () => void; onDelete: (id: string) => void; onUpgrade: () => void; capReached: boolean })`.
  - `relativeTime(iso: string, now: number): string` returning `just now`, `Nm ago`, `Nh ago`, `yesterday`, `N days ago`, `last week`, `N weeks ago`, `last month`, `N months ago`, `last year`, `N years ago`.
  - `DashboardApp` renders `Sidebar` plus one of `BoardsView`, `AgentsView` (Task 10), `Settings` (Task 7) chosen from `location.pathname`: `/dashboard` → boards, `/dashboard/agents` → agents, `/dashboard/settings` → settings. `DashboardDeps` gains `pathname?: string` (default `location.pathname`) so tests pick the view.

Paper values (nodes `1IZ-0`, `1J0-0`, `1K7-0`, `1KV-0`, `1PK-0`, `290-0`, `2E6-0`): sidebar 240 wide, full height, surface, right border, padding 24/16; logotype block padding-inline 8 padding-top 4; nav gap 4 padding-top 32; nav item height 36 padding-inline 10 gap 10 radius-md, icon 18, label 14/500 ink-secondary, active = accent-soft background, accent icon, 14/600 ink label; spacer; account block border-top, padding-top 16, padding-inline 8, gap 12: avatar 34 with 2px accent ring on surface-alt, name 14/500, plan line 12px ink-secondary `Free · 7/10 boards`; gauge track 4px border radius-full with accent fill `width: round(70%, 1px)`, and `Upgrade` 12/500 accent link. Main: flex 1, surface-alt, padding 32/40/40, gap 24; header height 44 space-between, title 28/600 line 34, "New board" `button-primary` with a 16px plus. Grid: `display:grid; grid-template-columns: repeat(auto-fill, 262px); gap: 24px`. Card: 262 wide, surface, border, radius-md, overflow clip; thumbnail area 184 tall centered, border-bottom; body padding 12/14/14 gap 6: name 14/500, row gap 6: "Edited 2h ago" 12px ink-secondary flex 1, `Shared` pill, `Claude` agent pill. Ghost "New board" card: same width, height matches the row (`align-self: stretch`), plus 24px, label 14/500. Over-quota banner: accent-soft, radius-md, height 56, padding-inline 16, gap 16, lock 20px accent, text 14, `Upgrade` button 32 tall accent. Cap ghost: lock 24px, "Board limit reached" 14/500, "Upgrade to create more" 12px.

- [ ] **Step 1: Write the failing relative-time test**

```ts
// apps/web/test/dashboard/relative-time.test.ts
import { describe, expect, it } from 'vitest'
import { relativeTime } from '../../src/dashboard/relative-time'

const now = Date.parse('2026-09-23T12:00:00Z')
const at = (ms: number) => new Date(now - ms).toISOString()

describe('relativeTime', () => {
  it('rounds down to the artboard vocabulary', () => {
    expect(relativeTime(at(20_000), now)).toBe('just now')
    expect(relativeTime(at(5 * 60_000), now)).toBe('5m ago')
    expect(relativeTime(at(2 * 3_600_000), now)).toBe('2h ago')
    expect(relativeTime(at(26 * 3_600_000), now)).toBe('yesterday')
    expect(relativeTime(at(3 * 86_400_000), now)).toBe('3 days ago')
    expect(relativeTime(at(8 * 86_400_000), now)).toBe('last week')
    expect(relativeTime(at(15 * 86_400_000), now)).toBe('2 weeks ago')
    expect(relativeTime(at(35 * 86_400_000), now)).toBe('last month')
    expect(relativeTime(at(100 * 86_400_000), now)).toBe('3 months ago')
    expect(relativeTime(at(400 * 86_400_000), now)).toBe('last year')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- relative-time`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement relativeTime**

```ts
// apps/web/src/dashboard/relative-time.ts
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function relativeTime(iso: string, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(iso))
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return 'last week'
  if (days < 30) return `${weeks} weeks ago`
  const months = Math.floor(days / 30)
  if (months === 1) return 'last month'
  if (days < 365) return `${months} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? 'last year' : `${years} years ago`
}
```

- [ ] **Step 4: Run to verify it passes**, then commit:

```bash
git add apps/web/src/dashboard/relative-time.ts apps/web/test/dashboard/relative-time.test.ts
git commit -m "✨ feat(web): format board timestamps as relative time"
```

- [ ] **Step 5: Write the failing sidebar test**

```tsx
// apps/web/test/dashboard/sidebar.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../src/dashboard/sidebar'

const user = { name: 'Sam', image: null, plan: 'free' as const }

describe('Sidebar', () => {
  it('marks the active section and shows the free plan gauge', () => {
    const onUpgrade = vi.fn()
    render(<Sidebar active="agents" user={user} boardCount={7} cap={10} billing onUpgrade={onUpgrade} />)
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Free · 7/10 boards')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '7')
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(onUpgrade).toHaveBeenCalled()
  })

  it('hides the gauge and upgrade for pro accounts', () => {
    render(<Sidebar active="boards" user={{ ...user, plan: 'pro' }} boardCount={12} cap={null} billing onUpgrade={() => undefined} />)
    expect(screen.getByText('Pro · 12 boards')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })
})
```

- [ ] **Step 6: Run to verify failure**, then implement the sidebar:

```tsx
// apps/web/src/dashboard/sidebar.tsx
import { AgentIcon } from '../board/components/agent-icon'
import { Logotype } from '../board/components/logotype'

const NAV = [
  { key: 'boards', label: 'Boards', href: '/dashboard' },
  { key: 'agents', label: 'Agents', href: '/dashboard/agents' },
  { key: 'settings', label: 'Settings', href: '/dashboard/settings' },
] as const

function NavIcon(props: { name: (typeof NAV)[number]['key'] }) {
  if (props.name === 'agents') return <AgentIcon size={18} />
  if (props.name === 'boards') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function Sidebar(props: {
  active: 'boards' | 'agents' | 'settings'
  user: { name: string; image: string | null; plan: 'free' | 'pro' }
  boardCount: number
  cap: number | null
  billing: boolean
  onUpgrade: () => void
}) {
  const { user, boardCount, cap } = props
  const free = user.plan === 'free' && cap !== null
  const plan = free ? `Free · ${boardCount}/${cap} boards` : `Pro · ${boardCount} boards`
  return (
    <aside className="sidebar">
      <Logotype size="sidebar" href="/" />
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <a key={item.key} href={item.href} className="nav-item" aria-current={props.active === item.key ? 'page' : undefined}>
            <NavIcon name={item.key} />
            {item.label}
          </a>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-account">
        <div className="account-user">
          {user.image ? (
            <img className="avatar-ring" src={user.image} alt="" />
          ) : (
            <span className="avatar-ring">{user.name.charAt(0).toUpperCase()}</span>
          )}
          <div>
            <div className="account-name">{user.name}</div>
            <div className="account-plan">{plan}</div>
          </div>
        </div>
        {free ? (
          <div className="account-gauge">
            <div className="gauge-track" role="progressbar" aria-label="Boards used" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={boardCount}>
              <div className="gauge-fill" style={{ width: `${Math.min(100, (boardCount / cap) * 100)}%` }} />
            </div>
            {props.billing ? (
              <button type="button" className="gauge-upgrade" onClick={props.onUpgrade}>Upgrade</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
```

- [ ] **Step 7: Rewrite the dashboard app, boards view, card and stylesheet**

`dashboard-app.tsx` keeps every data effect it has today (me, boards, adopt, checkout polling, toast) and renders:

```tsx
  const view = viewFor(deps.pathname ?? location.pathname)
  return (
    <div className="dashboard">
      <Sidebar active={view} user={me.user} boardCount={boards.length} cap={cap} billing={me.billing} onUpgrade={() => void upgrade('month')} />
      <main className="dashboard-main">
        {confirming ? <Notice kind="banner">Payment confirming…</Notice> : null}
        {view === 'boards' ? (
          <BoardsView me={me} boards={boards} cap={cap} capReached={capMessage} onCreate={() => void createBoard()} onDelete={(id) => void deleteBoardById(id)} onUpgrade={() => void upgrade('month')} />
        ) : view === 'agents' ? (
          <AgentsView deps={deps} boards={boards} />
        ) : (
          <Settings user={me.user} billing={me.billing} deps={deps} onSignOut={() => void signOut()} />
        )}
      </main>
      {toast ? <Notice kind="toast" onClose={() => setToast(null)}>{toast}</Notice> : null}
    </div>
  )
```

with `function viewFor(pathname: string): 'boards' | 'agents' | 'settings' { return pathname.endsWith('/agents') ? 'agents' : pathname.endsWith('/settings') ? 'settings' : 'boards' }`. Until Task 10 lands, render `null` in place of `AgentsView`. The old header, `dashboard-boards-toolbar` and "Upgrade monthly / yearly" buttons disappear; the yearly interval remains reachable from Settings (Task 7).

```tsx
// apps/web/src/dashboard/boards-view.tsx
import type { DashboardBoard, MeResponse } from './api'
import { BoardCard } from './board-card'

const Lock = (props: { size: number }) => (
  <svg width={props.size} height={props.size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
)

export function BoardsView(props: {
  me: MeResponse
  boards: DashboardBoard[]
  cap: number | null
  capReached: boolean
  onCreate: () => void
  onDelete: (id: string) => void
  onUpgrade: () => void
}) {
  const { boards, cap } = props
  const over = cap !== null && boards.length > cap
  const full = cap !== null && boards.length >= cap
  return (
    <>
      <header className="main-header">
        <h1>My boards</h1>
        <button type="button" className="button-primary" onClick={props.onCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          New board
        </button>
      </header>
      {over || props.capReached ? (
        <div className="quota-banner" role="status">
          <span className="quota-icon"><Lock size={20} /></span>
          <span className="quota-text">
            {over
              ? `You have ${boards.length} boards on the Free plan (${cap} included). Upgrade or free up space to create more.`
              : 'You have reached your board limit.'}
          </span>
          {props.me.billing ? (
            <button type="button" className="button-primary quota-upgrade" onClick={props.onUpgrade}>Upgrade</button>
          ) : null}
        </div>
      ) : null}
      <div className="board-grid">
        {boards.map((board) => (
          <BoardCard key={board.id} board={board} onDelete={props.onDelete} />
        ))}
        {full ? (
          <div className="ghost-card board-ghost" aria-disabled="true">
            <Lock size={24} />
            <div className="ghost-text">
              <div>Board limit reached</div>
              <div className="caption">Upgrade to create more</div>
            </div>
          </div>
        ) : (
          <button type="button" className="ghost-card board-ghost" onClick={props.onCreate}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            New board
          </button>
        )}
      </div>
    </>
  )
}
```

`board-card.tsx`: thumbnail area `<a className="card-thumb">` (184px tall, `img` `object-fit: contain`, fallback shows `<span className="card-empty">nothing here yet...</span>` in Caveat 20px ink-secondary), body with name, then a row: `<span className="card-time">Edited {relativeTime(board.updatedAt)}</span>`, `{board.shared ? <span className="pill">Shared</span> : null}`, `{board.agent ? <span className="pill pill-agent">Claude</span> : null}`. The more button keeps its markup with `className="card-more"`.

```css
/* dashboard.css (full rewrite) */
.dashboard {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  position: sticky;
  top: 0;
  flex: none;
  display: flex;
  flex-direction: column;
  width: 240px;
  height: 100vh;
  padding: 24px 16px;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

.sidebar > .logotype { align-items: flex-start; padding: 4px 8px 0; }

.sidebar-nav { display: flex; flex-direction: column; gap: 4px; padding-top: 32px; }

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding-inline: 10px;
  border-radius: var(--radius-md);
  color: var(--color-ink-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: 18px;
  text-decoration: none;
}

.nav-item[aria-current="page"] {
  background: var(--color-accent-soft);
  color: var(--color-ink);
  font-weight: var(--font-weight-semibold);
}

.nav-item[aria-current="page"] svg { color: var(--color-accent); }

.sidebar-spacer { flex: 1; }

.sidebar-account {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 8px 0;
  border-top: 1px solid var(--color-border);
}

.account-user { display: flex; align-items: center; gap: 10px; }

.avatar-ring {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 2px solid var(--color-accent);
  border-radius: var(--radius-full);
  background: var(--color-surface-alt);
  object-fit: cover;
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

.account-name { font-size: var(--text-sm); font-weight: var(--font-weight-medium); line-height: 18px; }
.account-plan { font-size: var(--text-xs); line-height: 16px; color: var(--color-ink-secondary); }

.account-gauge { display: flex; align-items: center; gap: 10px; }
.gauge-track { flex: 1; height: 4px; border-radius: var(--radius-full); background: var(--color-border); }
.gauge-fill { height: 4px; border-radius: var(--radius-full); background: var(--color-accent); }
.gauge-upgrade {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-accent);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.dashboard-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 32px 40px 40px;
  background: var(--color-surface-alt);
}

.main-header { display: flex; align-items: center; justify-content: space-between; min-height: 44px; }
.main-header h1 { margin: 0; font-size: var(--text-xl); font-weight: var(--font-weight-semibold); line-height: 34px; }
.main-subline { margin: 4px 0 0; font-size: var(--text-sm); line-height: 20px; color: var(--color-ink-secondary); }

.quota-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 56px;
  padding-inline: 16px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
}
.quota-icon { color: var(--color-accent); display: grid; }
.quota-text { flex: 1; font-size: var(--text-sm); line-height: 18px; }
.quota-upgrade { height: 32px; padding-inline: 14px; }

.board-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 262px);
  gap: 24px;
}

.board-card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 262px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: clip;
}

.card-thumb {
  display: grid;
  place-items: center;
  height: 184px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}
.card-thumb img { width: 100%; height: 100%; object-fit: contain; }
.card-empty { font: 500 20px var(--font-hand); color: var(--color-ink-secondary); }

.card-body { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 14px; }
.card-name { color: var(--color-ink); font-size: var(--text-sm); font-weight: var(--font-weight-medium); line-height: 18px; text-decoration: none; }
.card-row { display: flex; align-items: center; gap: 6px; }
.card-time { flex: 1; font-size: var(--text-xs); line-height: 16px; color: var(--color-ink-secondary); }

.card-more {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  opacity: 0;
  cursor: pointer;
}
.board-card:hover .card-more,
.board-card:focus-within .card-more { opacity: 1; }

.board-ghost { width: 262px; min-height: 256px; background: none; }
.ghost-text { display: flex; flex-direction: column; align-items: center; gap: 2px; }

@media (max-width: 720px) {
  .dashboard { flex-direction: column; }
  .sidebar { position: static; width: auto; height: auto; }
  .sidebar-spacer { display: none; }
  .dashboard-main { padding: 24px 16px; }
  .board-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .board-card, .board-ghost { width: auto; }
}
```

Keep the existing `.board-card-menu` popover rules (renamed `.card-menu`) so delete still works.

Routes: in `vite.config.ts` add `'/dashboard/agents': '/dashboard.html'` and `'/dashboard/settings': '/dashboard.html'` to `pages`. In the `Caddyfile` add `/dashboard/*` to the `@html` list and a block before the final `handle`:

```
	@dashboard path /dashboard/*
	handle @dashboard {
		rewrite * /dashboard.html
		file_server
	}
```

- [ ] **Step 8: Adapt the dashboard tests**

In `apps/web/test/dashboard/dashboard-app.test.tsx`: assertions on `Upgrade monthly` / `Upgrade yearly` move to Task 7's settings test; the cap assertion now expects the banner text `You have reached your board limit.` and the ghost `Board limit reached`; the header assertion expects `My boards`; the timestamp assertion expects `Edited` followed by a relative time (use `vi.useFakeTimers()` with `vi.setSystemTime(Date.parse('2026-01-05T12:00:00Z'))` so `board()`'s `updatedAt` reads `Edited 2h ago`). Add:

```tsx
  it('renders the agents view on its route', async () => {
    render(<DashboardApp deps={{ ...makeDeps(), pathname: '/dashboard/agents' }} />)
    expect(await screen.findByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')
  })
```

- [ ] **Step 9: Run everything**

Run: `pnpm --filter @tlwb/web test && pnpm -r typecheck && pnpm biome check --write .`
Expected: PASS.

- [ ] **Step 10: Visual check** at 1440x900 signed in (seed a session with `apps/web/e2e/session-helper.ts` or sign in through GitHub in dev) against `get_screenshot(nodeId: "1IZ-0")`; with `cap` forced to the board count, against `249-0`'s ghost card.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/dashboard apps/web/test/dashboard apps/web/vite.config.ts apps/web/Caddyfile
git commit -m "💄 style(web): rebuild the dashboard shell and board grid on the Paper artboards"
```

---

### Task 7: Settings view

**Files:**
- Modify: `apps/web/src/dashboard/settings.tsx`, `dashboard.css`
- Test: `apps/web/test/dashboard/settings.test.tsx` (new, moving the billing and delete assertions out of `dashboard-app.test.tsx`)

**Interfaces:**
- Consumes: `Sidebar` layout from Task 6 (this view renders inside `.dashboard-main`).
- Produces: `Settings(props: { user; billing; deps: SettingsDeps; onSignOut: () => void })`; `SettingsDeps` drops `createApiKey`, `revokeApiKey`, `fetchUsage` (they move to Agents in Task 10) and gains `startCheckout`.

There is no artboard for this screen. Build it from the dashboard primitives: `main-header` with `Settings`, then stacked surface cards (`.settings-card`: surface, border, radius-md, padding 24, gap 16, max-width 640) for Account (name, email, Sign out `button-secondary`), Plan (`Free plan` / `Pro plan`, with `Upgrade monthly` / `Upgrade yearly` `button-primary`/`button-secondary` when `billing` and free, or `Manage billing` when pro), Danger zone (Delete account, `button-secondary` with `--color-danger` text and border).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/dashboard/settings.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Settings, type SettingsDeps } from '../../src/dashboard/settings'

const user = { name: 'Ada Lovelace', email: 'ada@example.com', plan: 'free' as const }

function deps(overrides: Partial<SettingsDeps> = {}): SettingsDeps {
  return {
    startCheckout: vi.fn(async () => 'https://stripe.example/checkout'),
    openPortal: vi.fn(async () => 'https://stripe.example/portal'),
    deleteUser: vi.fn(async () => undefined),
    navigate: vi.fn(),
    ...overrides,
  }
}

describe('Settings', () => {
  it('shows the account, offers both upgrade intervals on the free plan, and signs out', () => {
    const d = deps()
    const onSignOut = vi.fn()
    render(<Settings user={user} billing deps={d} onSignOut={onSignOut} />)
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('Free plan')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade yearly' }))
    expect(d.startCheckout).toHaveBeenCalledWith('year')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalled()
  })

  it('opens the billing portal on the pro plan', async () => {
    const d = deps()
    render(<Settings user={{ ...user, plan: 'pro' }} billing deps={d} onSignOut={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Upgrade monthly' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }))
    await waitFor(() => expect(d.openPortal).toHaveBeenCalled())
  })

  it('deletes the account after two confirmations', async () => {
    const d = deps()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Settings user={user} billing={false} deps={d} onSignOut={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    await waitFor(() => expect(d.deleteUser).toHaveBeenCalled())
    expect(d.navigate).toHaveBeenCalledWith('/')
  })
})
```

Delete the billing, portal and delete-account cases from `dashboard-app.test.tsx` (they now live here).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- settings`
Expected: FAIL, `startCheckout` not in `SettingsDeps`, `onSignOut` unknown.

- [ ] **Step 3: Rewrite `settings.tsx`**

```tsx
import { useState } from 'react'
import type { openPortal as defaultOpenPortal, startCheckout as defaultStartCheckout } from './api'

export interface SettingsDeps {
  startCheckout: typeof defaultStartCheckout
  openPortal: typeof defaultOpenPortal
  deleteUser: () => Promise<unknown>
  navigate: (path: string) => void
}

export function Settings(props: {
  user: { name: string; email: string; plan: 'free' | 'pro' }
  billing: boolean
  deps: SettingsDeps
  onSignOut: () => void
}) {
  const { user, billing, deps } = props
  const [error, setError] = useState<string | null>(null)

  const go = async (action: () => Promise<string>, failure: string): Promise<void> => {
    setError(null)
    try {
      location.assign(await action())
    } catch {
      setError(failure)
    }
  }

  const deleteAccount = async (): Promise<void> => {
    if (!confirm(`Delete the account for ${user.email}? This cannot be undone.`)) return
    if (!confirm('This will permanently delete every board you own. Continue?')) return
    setError(null)
    try {
      await deps.deleteUser()
      deps.navigate('/')
    } catch {
      setError('Could not delete the account, try again')
    }
  }

  return (
    <>
      <header className="main-header">
        <h1>Settings</h1>
      </header>
      {error ? <p className="error">{error}</p> : null}
      <section className="settings-card">
        <h2>Account</h2>
        <p className="settings-line">{user.name}</p>
        <p className="settings-line caption">{user.email}</p>
        <button type="button" className="button-secondary" onClick={props.onSignOut}>Sign out</button>
      </section>
      <section className="settings-card">
        <h2>Plan</h2>
        <p className="settings-line">{user.plan === 'pro' ? 'Pro plan' : 'Free plan'}</p>
        {billing && user.plan === 'free' ? (
          <div className="settings-actions">
            <button type="button" className="button-primary" onClick={() => void go(() => deps.startCheckout('month'), 'Could not start checkout, try again')}>Upgrade monthly</button>
            <button type="button" className="button-secondary" onClick={() => void go(() => deps.startCheckout('year'), 'Could not start checkout, try again')}>Upgrade yearly</button>
          </div>
        ) : null}
        {billing && user.plan === 'pro' ? (
          <button type="button" className="button-secondary" onClick={() => void go(deps.openPortal, 'Could not open billing, try again')}>Manage billing</button>
        ) : null}
      </section>
      <section className="settings-card settings-danger">
        <h2>Danger zone</h2>
        <button type="button" className="button-secondary button-danger" onClick={() => void deleteAccount()}>Delete account</button>
      </section>
    </>
  )
}
```

```css
/* dashboard.css additions */
.settings-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  max-width: 640px;
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.settings-card h2 { margin: 0; font-size: var(--text-base); font-weight: var(--font-weight-semibold); line-height: 20px; }
.settings-line { margin: 0; font-size: var(--text-sm); line-height: 20px; }
.settings-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.button-danger { border-color: var(--color-danger); color: var(--color-danger); }
.dashboard-main .error { margin: 0; color: var(--color-danger); }
```

In `dashboard-app.tsx`, `DashboardDeps` loses `createApiKey`, `revokeApiKey`, `fetchUsage` (Task 10 re-adds the first two with their new shapes); remove `fetchUsage` from `api.ts` and its test, and delete the `settings-*` rules the old stylesheet carried.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @tlwb/web test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard apps/web/test/dashboard
git commit -m "💄 style(web): move account settings to their own dashboard view"
```

---

### Task 8: Server, named and scoped API tokens

**Files:**
- Modify: `apps/collab-server/src/db/schema.ts:166-181`
- Create: `apps/collab-server/src/migrations/0004_*.sql` via `pnpm --filter @tlwb/collab-server db:generate`
- Modify: `apps/collab-server/src/accounts/api-keys.ts`, `cleanup.ts:61`
- Modify: `apps/collab-server/src/http.ts:316-331`
- Test: `apps/collab-server/test/accounts/api-keys.test.ts`, `api-key-http.test.ts`

**Interfaces:**
- Produces:
  - `issueApiKey(db, userId, options: { name: string; boardIds: string[] | null }): Promise<{ id: string; key: string }>` (no longer revokes siblings).
  - `listApiKeys(db, userId): Promise<ApiKeySummary[]>` where `ApiKeySummary = { id: string; name: string; boardIds: string[] | null; createdAt: string; lastUsedAt: string | null }`, active keys only, newest first.
  - `revokeApiKey(db, userId, id): Promise<boolean>` (false when no active key matched).
  - `revokeAllApiKeys(db, userId): Promise<void>` (used by account deletion).
  - `resolveApiKey(db, bearer): Promise<{ userId; plan; keyId: string; boardIds: string[] | null } | null>`, and it stamps `last_used_at = now()` on the matched row (fire and forget).
  - Routes: `GET /me/api-keys` → `{ keys: ApiKeySummary[] }`; `POST /me/api-keys` with JSON `{ name: string; boardIds?: string[] }` → 201 `{ id, key }` (name trimmed, 1 to 80 chars, else 400; `boardIds` must all be boards the user owns, else 400); `DELETE /me/api-keys/:id` → 204, or 404. The old `/me/api-key` routes are removed.

- [ ] **Step 1: Write the failing unit tests** (replace the body of `api-keys.test.ts`):

```ts
describe('named api keys', () => {
  it('issues several named keys, lists them newest first, resolves scope and stamps last use', async () => {
    const userA = await createUser('pro')
    const laptop = await issueApiKey(database.db, userA, { name: 'Claude · laptop', boardIds: null })
    const studio = await issueApiKey(database.db, userA, { name: 'Claude Code · studio', boardIds: ['b1', 'b2'] })
    expect(laptop.key.startsWith(API_KEY_PREFIX)).toBe(true)
    const listed = await listApiKeys(database.db, userA)
    expect(listed.map((k) => k.name)).toEqual(['Claude Code · studio', 'Claude · laptop'])
    expect(listed[1]?.lastUsedAt).toBeNull()
    expect(await resolveApiKey(database.db, studio.key)).toEqual({
      userId: userA, plan: 'pro', keyId: studio.id, boardIds: ['b1', 'b2'],
    })
    await new Promise((r) => setTimeout(r, 20))
    const after = await listApiKeys(database.db, userA)
    expect(after.find((k) => k.id === studio.id)?.lastUsedAt).not.toBeNull()
  })

  it('revokes one key by id and leaves the others', async () => {
    const userA = await createUser()
    const a = await issueApiKey(database.db, userA, { name: 'a', boardIds: null })
    const b = await issueApiKey(database.db, userA, { name: 'b', boardIds: null })
    expect(await revokeApiKey(database.db, userA, a.id)).toBe(true)
    expect(await revokeApiKey(database.db, userA, a.id)).toBe(false)
    expect(await resolveApiKey(database.db, a.key)).toBeNull()
    expect(await resolveApiKey(database.db, b.key)).not.toBeNull()
    await revokeAllApiKeys(database.db, userA)
    expect(await resolveApiKey(database.db, b.key)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/collab-server && DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb pnpm test -- api-keys`
Expected: FAIL, signature mismatch.

- [ ] **Step 3: Schema and migration**

```ts
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    keyHash: bytea('key_hash').notNull(),
    name: text('name').notNull().default(''),
    /** Null means every board the user owns; otherwise the allowed ids. */
    boardIds: text('board_ids').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('api_keys_key_hash_idx').on(table.keyHash)],
)
```

Run: `pnpm --filter @tlwb/collab-server db:generate` and check the generated SQL adds the three columns.

- [ ] **Step 4: Rewrite api-keys.ts**

```ts
import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { apiKeys, user } from '../db/schema'
import { generateKey, hashKey } from '../keys'

export const API_KEY_PREFIX = 'tlwb_'

export interface ApiKeySummary {
  id: string
  name: string
  boardIds: string[] | null
  createdAt: string
  lastUsedAt: string | null
}

export async function issueApiKey(
  db: Db,
  userId: string,
  options: { name: string; boardIds: string[] | null },
): Promise<{ id: string; key: string }> {
  const key = generateKey()
  const id = randomBytes(16).toString('base64url')
  await db.insert(apiKeys).values({
    id,
    userId,
    keyHash: hashKey(key),
    name: options.name,
    boardIds: options.boardIds,
  })
  return { id, key: `${API_KEY_PREFIX}${key}` }
}

export async function listApiKeys(db: Db, userId: string): Promise<ApiKeySummary[]> {
  const rows = await db
    .select({ id: apiKeys.id, name: apiKeys.name, boardIds: apiKeys.boardIds, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    boardIds: row.boardIds,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }))
}

export async function revokeApiKey(db: Db, userId: string, id: string): Promise<boolean> {
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id })
  return revoked.length === 1
}

export async function revokeAllApiKeys(db: Db, userId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
}

export async function resolveApiKey(
  db: Db,
  bearer: string,
): Promise<{ userId: string; plan: 'free' | 'pro'; keyId: string; boardIds: string[] | null } | null> {
  if (!bearer.startsWith(API_KEY_PREFIX)) {
    return null
  }
  const keyHash = hashKey(bearer.slice(API_KEY_PREFIX.length))
  const [row] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, plan: user.plan, boardIds: apiKeys.boardIds })
    .from(apiKeys)
    .innerJoin(user, eq(apiKeys.userId, user.id))
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
  if (!row) {
    return null
  }
  // Fire and forget: the Agents page reads this, no tool call waits on it.
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => {})
  return { userId: row.userId, plan: row.plan === 'pro' ? 'pro' : 'free', keyId: row.id, boardIds: row.boardIds }
}
```

`cleanup.ts` line 61 becomes `await revokeAllApiKeys(db, userId)`. Fix `deletion.test.ts` line 97 to the new `issueApiKey` signature (`.key`).

- [ ] **Step 5: Routes**

Replace the two `/me/api-key` handlers in `http.ts`:

```ts
  app.get('/me/api-keys', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    return c.json({ keys: await listApiKeys(db, user.id) })
  })

  app.post('/me/api-keys', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; boardIds?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (name.length === 0 || name.length > 80) {
      return c.json({ error: 'name must be 1 to 80 characters' }, 400)
    }
    let boardIds: string[] | null = null
    if (body?.boardIds !== undefined) {
      if (!Array.isArray(body.boardIds) || !body.boardIds.every((id) => typeof id === 'string')) {
        return c.json({ error: 'boardIds must be a list of board ids' }, 400)
      }
      const owned = new Set((await listOwnedBoards(db, user.id)).map((board) => board.id))
      if (!body.boardIds.every((id) => owned.has(id))) {
        return c.json({ error: 'boardIds must name boards you own' }, 400)
      }
      boardIds = body.boardIds
    }
    return c.json(await issueApiKey(db, user.id, { name, boardIds }), 201)
  })

  app.delete('/me/api-keys/:id', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const revoked = await revokeApiKey(db, user.id, c.req.param('id'))
    return revoked ? c.body(null, 204) : c.json({ error: 'no such token' }, 404)
  })
```

Check `listOwnedBoards`'s return shape in `db/boards.ts:82` and adapt the `.id` access.

- [ ] **Step 6: Rewrite the HTTP test** (`api-key-http.test.ts`): 401 on the three routes signed out; POST with `{ name: 'Claude · laptop' }` returns 201 with `id` and prefixed `key`; POST with an empty name is 400; POST with `boardIds` naming a board the user does not own is 400; GET lists the created key with `lastUsedAt: null`; DELETE by id is 204 then 404; keep the `/me/usage` case.

- [ ] **Step 7: Run the server tests and typecheck**

Run: `cd apps/collab-server && DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb pnpm test && pnpm typecheck`
Expected: PASS (including `deletion.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add apps/collab-server/src apps/collab-server/test
git commit -m "✨ feat(collab-server): issue named, board-scoped API tokens with last use"
```

---

### Task 9: MCP honors the token's board scope

**Files:**
- Modify: `apps/collab-server/src/mcp/caller.ts`, `src/mcp/index.ts:40-46`
- Modify: `apps/collab-server/src/mcp/tools/read-board.ts:45`, `add-elements.ts:54`, `update-elements.ts:33`, `delete-elements.ts:33`, `get-board-screenshot.ts:41`
- Test: `apps/collab-server/test/mcp/tools.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveApiKey` from Task 8.
- Produces: `Caller` keyed variant gains `boardIds: string[] | null`; `assertBoardAllowed(caller: Caller, boardId: string): void` throws `ToolError('this token is not allowed on board <id>')` when the caller is keyed with a non-null scope excluding the board.

- [ ] **Step 1: Write the failing test** (in `tools.test.ts`, following the file's existing helper for a keyed caller):

```ts
  it('refuses a board outside the token scope and accepts one inside', async () => {
    const scoped = { kind: 'keyed', ip: '1.1.1.1', userId, plan: 'free', boardIds: [insideId] } as const
    await expect(callTool(scoped, 'read_board', { board: outsideUrl })).rejects.toThrow(/not allowed on board/)
    await expect(callTool(scoped, 'read_board', { board: insideUrl })).resolves.toBeDefined()
  })
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```ts
// caller.ts additions
export type Caller =
  | { kind: 'anonymous'; ip: string }
  | { kind: 'invalid'; ip: string }
  | { kind: 'keyed'; ip: string; userId: string; plan: 'free' | 'pro'; boardIds: string[] | null }

export function assertBoardAllowed(caller: Caller, boardId: string): void {
  if (caller.kind === 'keyed' && caller.boardIds && !caller.boardIds.includes(boardId)) {
    throw new ToolError(`this token is not allowed on board ${boardId}`)
  }
}
```

In `index.ts` the keyed caller spread already carries `boardIds` from `resolveApiKey`; drop `keyId` from the spread (`const { keyId: _ignored, ...rest } = keyed`) or destructure explicitly. In each of the five tools add `assertBoardAllowed(caller, ref.boardId)` on the line after `const ref = parseBoardRef(board)`.

- [ ] **Step 4: Run tests and typecheck**, then commit `🔒 feat(collab-server): restrict MCP tools to a token's board scope`.

---

### Task 10: Agents view and New token dialog

**Files:**
- Modify: `apps/web/src/dashboard/api.ts` (replace `createApiKey`, `revokeApiKey`; add `fetchApiKeys`, `ApiKeySummary`)
- Create: `apps/web/src/dashboard/agents-view.tsx`
- Create: `apps/web/src/dashboard/new-token-dialog.tsx`
- Modify: `apps/web/src/dashboard/dashboard-app.tsx` (`DashboardDeps` gains `fetchApiKeys`, `createApiKey`, `revokeApiKey`; render `AgentsView`)
- Modify: `apps/web/src/dashboard/dashboard.css`
- Modify: `apps/web/src/board/components/board-app.tsx` (wire `onConnectAgent` for signed-in users on hosted boards)
- Test: `apps/web/test/dashboard/agents-view.test.tsx`, `new-token-dialog.test.tsx` (new), `dashboard-app.test.tsx` (deps)

**Interfaces:**
- Consumes: Task 8 routes; `ShareDialog.onConnectAgent` from Task 5.
- Produces:
  - `api.ts`: `interface ApiKeySummary { id; name; boardIds: string[] | null; createdAt: string; lastUsedAt: string | null }`; `fetchApiKeys(): Promise<ApiKeySummary[]>`; `createApiKey(input: { name: string; boardIds: string[] | null }): Promise<{ id: string; key: string }>`; `revokeApiKey(id: string): Promise<void>`.
  - `AgentsView(props: { keys: ApiKeySummary[]; boards: DashboardBoard[]; onRevoke: (id) => void; onOpenNewToken: () => void; now?: number })`.
  - `NewTokenDialog(props: { open: boolean; boards: { id: string; name: string }[]; presetBoardId?: string; createApiKey; fetchApiKeys; onClose: () => void })` rendered as a `<dialog className="dialog new-token">`; after creation it polls `fetchApiKeys` every 3 s until the created id has `lastUsedAt`, then the chip reads `Connected` with a `--color-success` dot.

Paper values (nodes `1PT-0`, `1RD-0`, `1RT-0`, `1UL-0`, `1XI-0`, `1Z9-0`): header title `Agents` 28/600 with subline `Connect your AI agents to your boards through MCP.` 14px ink-secondary, `New token` `button-primary` padding-inline 14 with plus. Token list gap 12: card surface, border, radius-md, padding 14/16, gap 12: 36px icon square (agent-soft + `AgentIcon 20 agent` when `lastUsedAt` is set, otherwise surface-alt + key SVG `<circle cx="8" cy="16" r="3.5"/><path d="M10.5 13.5 19 5"/><path d="M15.5 8.5l3 3"/>` ink-secondary), name 14/500, meta line 12px ink-secondary: `All boards` or `N boards` · then either a 6px success dot + `Active 5 min ago` (write it as `Active ${relativeTime(lastUsedAt)}` with the `m ago` form expanded to `min ago` for this screen only) or `Never used`; `Revoke` `button-quiet` 12/500. Ghost `New token` 56px tall dashed with 16px plus. Footnote `Revoking a token disconnects its agent immediately.` 12px ink-secondary. Modal: 640 wide, padding 24, gap 20 (16 inside), title `New token` 20/600, 18px X. Steps: 24px numbered circle (surface-alt, border, 12/600) + column gap 12: step title 14/600. Step 1: input 36px border radius-md padding 12; radios `All boards` / `Only specific boards` (16px, accent when selected, 24px gap) with helper `All boards is the default. You can restrict this token to specific boards.`; when specific: bordered list 138px tall scrollable, rows 30px padding-inline 10 with 16px checkboxes (accent square, radius 4), then `N boards selected` 12/500 and `Your agent will only see the boards you check.` 12px. Step 2: title `Add tlwb to your MCP client`, sub `Paste this configuration into Claude Code, Claude Desktop, or any MCP client.`, code block surface-alt border radius-md padding 14/16, mono 12px/18px, with a 28px copy button top-right; the JSON is

```json
{
  "mcpServers": {
    "tlwb": {
      "type": "http",
      "url": "<origin>/mcp",
      "headers": {
        "Authorization": "Bearer <key>"
      }
    }
  }
}
```

Step 3: title `Test the connection`, sub `Ask your agent to read one of your boards. This chip flips the moment its first call arrives.`, chip 28px pill border with 6px dot + `Waiting for your agent...` 12/500 (dot ink-secondary), flipping to `Connected` (dot success). Footer: divider, right-aligned `Cancel` (`button-quiet`, 14/500) and `Done` (`button-primary`, padding-inline 14).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/test/dashboard/agents-view.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentsView } from '../../src/dashboard/agents-view'

const now = Date.parse('2026-09-23T12:00:00Z')
const keys = [
  { id: 'k1', name: 'Claude · laptop', boardIds: null, createdAt: '2026-09-01T00:00:00Z', lastUsedAt: '2026-09-23T11:55:00Z' },
  { id: 'k2', name: 'Claude Code · studio', boardIds: ['b1', 'b2'], createdAt: '2026-09-02T00:00:00Z', lastUsedAt: null },
]

describe('AgentsView', () => {
  it('lists tokens with scope and activity, and revokes one', () => {
    const onRevoke = vi.fn()
    render(<AgentsView keys={keys} boards={[]} now={now} onRevoke={onRevoke} onOpenNewToken={() => undefined} />)
    expect(screen.getByText('All boards')).toBeInTheDocument()
    expect(screen.getByText('Active 5 min ago')).toBeInTheDocument()
    expect(screen.getByText('2 boards')).toBeInTheDocument()
    expect(screen.getByText('Never used')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[1]!)
    expect(onRevoke).toHaveBeenCalledWith('k2')
  })

  it('opens the new token dialog from both buttons', () => {
    const open = vi.fn()
    render(<AgentsView keys={[]} boards={[]} onRevoke={() => undefined} onOpenNewToken={open} />)
    for (const button of screen.getAllByRole('button', { name: 'New token' })) fireEvent.click(button)
    expect(open).toHaveBeenCalledTimes(2)
  })
})
```

```tsx
// apps/web/test/dashboard/new-token-dialog.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewTokenDialog } from '../../src/dashboard/new-token-dialog'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open') }
})
afterEach(() => vi.useRealTimers())

describe('NewTokenDialog', () => {
  it('creates a scoped token, shows the snippet, and flips the chip on first use', async () => {
    const createApiKey = vi.fn(async () => ({ id: 'k9', key: 'tlwb_abc' }))
    const fetchApiKeys = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'k9', name: 'Claude · desktop', boardIds: ['b1'], createdAt: '', lastUsedAt: null }])
      .mockResolvedValue([{ id: 'k9', name: 'Claude · desktop', boardIds: ['b1'], createdAt: '', lastUsedAt: '2026-09-23T12:00:00Z' }])
    render(
      <NewTokenDialog open boards={[{ id: 'b1', name: 'payments architecture' }, { id: 'b2', name: 'sprint retro' }]} presetBoardId="b1" createApiKey={createApiKey} fetchApiKeys={fetchApiKeys} onClose={() => undefined} />,
    )
    expect(screen.getByRole('radio', { name: 'Only specific boards' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'payments architecture' })).toBeChecked()
    expect(screen.getByText('1 board selected')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Token name' }), { target: { value: 'Claude · desktop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    expect(createApiKey).toHaveBeenCalledWith({ name: 'Claude · desktop', boardIds: ['b1'] })
    expect(await screen.findByText(/Bearer tlwb_abc/)).toBeInTheDocument()
    expect(screen.getByText('Waiting for your agent...')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(6500)
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: API client**

```ts
export interface ApiKeySummary {
  id: string
  name: string
  boardIds: string[] | null
  createdAt: string
  lastUsedAt: string | null
}

export async function fetchApiKeys(fetchFn: typeof fetch = fetch): Promise<ApiKeySummary[]> {
  const response = await fetchFn('/api/me/api-keys')
  if (!response.ok) {
    throw new ServerError(response.status)
  }
  return ((await response.json()) as { keys: ApiKeySummary[] }).keys
}

export async function createApiKey(
  input: { name: string; boardIds: string[] | null },
  fetchFn: typeof fetch = fetch,
): Promise<{ id: string; key: string }> {
  const response = await fetchFn('/api/me/api-keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input.boardIds ? input : { name: input.name }),
  })
  if (response.status !== 201) {
    throw new ServerError(response.status)
  }
  return (await response.json()) as { id: string; key: string }
}

export async function revokeApiKey(id: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const response = await fetchFn(`/api/me/api-keys/${id}`, { method: 'DELETE' })
  if (response.status !== 204) {
    throw new ServerError(response.status)
  }
}
```

Update `api.test.ts` accordingly.

- [ ] **Step 4: AgentsView**

```tsx
// apps/web/src/dashboard/agents-view.tsx
import { AgentIcon } from '../board/components/agent-icon'
import type { ApiKeySummary, DashboardBoard } from './api'
import { relativeTime } from './relative-time'

const KeyIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="16" r="3.5" /><path d="M10.5 13.5 19 5" /><path d="M15.5 8.5l3 3" />
  </svg>
)

const Plus = (props: { size: number }) => (
  <svg width={props.size} height={props.size} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
)

function activity(lastUsedAt: string | null, now: number): string {
  if (!lastUsedAt) return 'Never used'
  return `Active ${relativeTime(lastUsedAt, now).replace(/^(\d+)m ago$/, '$1 min ago')}`
}

export function AgentsView(props: {
  keys: ApiKeySummary[]
  boards: DashboardBoard[]
  onRevoke: (id: string) => void
  onOpenNewToken: () => void
  now?: number
}) {
  const now = props.now ?? Date.now()
  return (
    <>
      <header className="main-header">
        <div>
          <h1>Agents</h1>
          <p className="main-subline">Connect your AI agents to your boards through MCP.</p>
        </div>
        <button type="button" className="button-primary" onClick={props.onOpenNewToken}><Plus size={16} />New token</button>
      </header>
      <ul className="token-list">
        {props.keys.map((key) => (
          <li key={key.id} className="token-card">
            <span className={`token-icon${key.lastUsedAt ? ' token-icon-agent' : ''}`}>
              {key.lastUsedAt ? <AgentIcon size={20} color="var(--color-agent)" /> : <KeyIcon />}
            </span>
            <div className="token-text">
              <div className="token-name">{key.name}</div>
              <div className="token-meta">
                <span>{key.boardIds ? `${key.boardIds.length} boards` : 'All boards'}</span>
                <span aria-hidden="true">·</span>
                {key.lastUsedAt ? <span className="dot dot-success" aria-hidden="true" /> : null}
                <span>{activity(key.lastUsedAt, now)}</span>
              </div>
            </div>
            <button type="button" className="button-quiet token-revoke" onClick={() => props.onRevoke(key.id)}>Revoke</button>
          </li>
        ))}
        <li>
          <button type="button" className="ghost-card token-ghost" onClick={props.onOpenNewToken}><Plus size={16} />New token</button>
        </li>
      </ul>
      <p className="caption">Revoking a token disconnects its agent immediately.</p>
    </>
  )
}
```

- [ ] **Step 5: NewTokenDialog**

```tsx
// apps/web/src/dashboard/new-token-dialog.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiKeySummary } from './api'

const POLL_MS = 3000

export function NewTokenDialog(props: {
  open: boolean
  boards: { id: string; name: string }[]
  presetBoardId?: string
  createApiKey: (input: { name: string; boardIds: string[] | null }) => Promise<{ id: string; key: string }>
  fetchApiKeys: () => Promise<ApiKeySummary[]>
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('Claude')
  const [scope, setScope] = useState<'all' | 'some'>(props.presetBoardId ? 'some' : 'all')
  const [checked, setChecked] = useState<Set<string>>(() => new Set(props.presetBoardId ? [props.presetBoardId] : []))
  const [created, setCreated] = useState<{ id: string; key: string } | null>(null)
  const [connected, setConnected] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (props.open && !dialog.open) dialog.showModal()
    if (!props.open && dialog.open) dialog.close()
  }, [props.open])

  useEffect(() => {
    if (!created || connected) return
    const timer = setInterval(() => {
      void props.fetchApiKeys()
        .then((keys) => {
          if (keys.find((key) => key.id === created.id)?.lastUsedAt) setConnected(true)
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [created, connected, props.fetchApiKeys])

  const snippet = useMemo(() => JSON.stringify({
    mcpServers: { tlwb: { type: 'http', url: `${location.origin}/mcp`, headers: { Authorization: `Bearer ${created?.key ?? ''}` } } },
  }, null, 2), [created])

  const create = async () => {
    setError(null)
    try {
      setCreated(await props.createApiKey({ name: name.trim(), boardIds: scope === 'some' ? [...checked] : null }))
    } catch {
      setError('Could not create the token, try again')
    }
  }

  const toggle = (id: string) => setChecked((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
    } catch {
      // The snippet stays selectable for a manual copy.
    }
  }

  const canCreate = name.trim().length > 0 && (scope === 'all' || checked.size > 0)

  return (
    <dialog ref={dialogRef} className="dialog new-token" onClose={props.onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">New token</h2>
        <button type="button" className="dialog-close" aria-label="Close" onClick={props.onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </header>

      <section className="step">
        <span className="step-number">1</span>
        <div className="step-body">
          <h3>Name your token</h3>
          <input aria-label="Token name" value={name} disabled={created !== null} onChange={(e) => setName(e.target.value)} />
          <div className="scope">
            <label><input type="radio" name="scope" aria-label="All boards" checked={scope === 'all'} disabled={created !== null} onChange={() => setScope('all')} />All boards</label>
            <label><input type="radio" name="scope" aria-label="Only specific boards" checked={scope === 'some'} disabled={created !== null} onChange={() => setScope('some')} />Only specific boards</label>
          </div>
          {scope === 'all' ? (
            <p className="caption">All boards is the default. You can restrict this token to specific boards.</p>
          ) : (
            <>
              <ul className="board-picker">
                {props.boards.map((board) => (
                  <li key={board.id}>
                    <label><input type="checkbox" aria-label={board.name} checked={checked.has(board.id)} disabled={created !== null} onChange={() => toggle(board.id)} />{board.name}</label>
                  </li>
                ))}
              </ul>
              <p className="caption caption-strong">{checked.size} {checked.size === 1 ? 'board' : 'boards'} selected</p>
              <p className="caption">Your agent will only see the boards you check.</p>
            </>
          )}
        </div>
      </section>

      <section className="step">
        <span className="step-number">2</span>
        <div className="step-body">
          <h3>Add tlwb to your MCP client</h3>
          <p className="step-sub">Paste this configuration into Claude Code, Claude Desktop, or any MCP client.</p>
          {created ? (
            <div className="snippet">
              <pre>{snippet}</pre>
              <button type="button" className="snippet-copy" aria-label={copied ? 'Copied' : 'Copy configuration'} onClick={() => void copy()}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              </button>
            </div>
          ) : (
            <button type="button" className="button-primary" disabled={!canCreate} onClick={() => void create()}>Create token</button>
          )}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </section>

      <section className="step">
        <span className="step-number">3</span>
        <div className="step-body">
          <h3>Test the connection</h3>
          <p className="step-sub">Ask your agent to read one of your boards. This chip flips the moment its first call arrives.</p>
          <span className={`chip${connected ? ' chip-connected' : ''}`}>
            <span className="dot" aria-hidden="true" />
            {connected ? 'Connected' : 'Waiting for your agent...'}
          </span>
        </div>
      </section>

      <footer className="dialog-footer">
        <hr className="divider" />
        <div className="dialog-actions">
          <button type="button" className="button-quiet" onClick={props.onClose}>Cancel</button>
          <button type="button" className="button-primary" onClick={props.onClose}>Done</button>
        </div>
      </footer>
    </dialog>
  )
}
```

- [ ] **Step 6: Styles** (append to `dashboard.css`)

```css
.token-list { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; }
.token-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.token-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-surface-alt);
  color: var(--color-ink-secondary);
}
.token-icon-agent { background: var(--color-agent-soft); }
.token-text { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.token-name { font-size: var(--text-sm); font-weight: var(--font-weight-medium); line-height: 18px; }
.token-meta { display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); line-height: 16px; color: var(--color-ink-secondary); }
.dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--color-ink-secondary); }
.dot-success { background: var(--color-success); }
.token-revoke { font-size: var(--text-xs); }
.token-ghost { width: 100%; height: 56px; flex-direction: row; gap: 8px; }

.new-token { display: flex; flex-direction: column; gap: 20px; width: min(640px, calc(100vw - 32px)); }
.new-token[open] { display: flex; }
.step { display: flex; align-items: flex-start; gap: 14px; }
.step-number {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface-alt);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}
.step-body { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.step-body h3 { margin: 0; font-size: var(--text-sm); font-weight: var(--font-weight-semibold); line-height: 20px; }
.step-sub { margin: 0; font-size: var(--text-sm); line-height: 20px; color: var(--color-ink-secondary); }
.step-body > input { height: 36px; padding-inline: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: var(--text-sm); }
.scope { display: flex; gap: 24px; }
.scope label { display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--color-ink-secondary); cursor: pointer; }
.scope label:has(input:checked) { color: var(--color-ink); font-weight: var(--font-weight-medium); }
.scope input, .board-picker input { width: 16px; height: 16px; margin: 0; accent-color: var(--color-accent); }
.board-picker {
  max-height: 138px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.board-picker label { display: flex; align-items: center; gap: 8px; height: 30px; padding-inline: 10px; font-size: var(--text-sm); cursor: pointer; }
.caption-strong { font-weight: var(--font-weight-medium); }
.snippet {
  position: relative;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-alt);
}
.snippet pre { margin: 0; font: var(--font-weight-regular) var(--text-xs) / 18px var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.snippet-copy {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-ink-secondary);
  cursor: pointer;
}
.chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding-inline: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-ink-secondary);
}
.chip-connected .dot { background: var(--color-success); }
.dialog-footer { display: flex; flex-direction: column; gap: 16px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.new-token .error { margin: 0; color: var(--color-danger); font-size: var(--text-xs); }
```

- [ ] **Step 7: Wire into the dashboard and the editor**

`dashboard-app.tsx`: state `apiKeys` loaded by `deps.fetchApiKeys()` when the view is `agents`; `newTokenOpen` boolean; render `<AgentsView keys={apiKeys} boards={boards} onRevoke={revoke} onOpenNewToken={() => setNewTokenOpen(true)} />` and `<NewTokenDialog open={newTokenOpen} boards={boards} createApiKey={deps.createApiKey} fetchApiKeys={deps.fetchApiKeys} onClose={() => { setNewTokenOpen(false); void refreshKeys() }} />`. `revoke` calls `deps.revokeApiKey(id)` then removes the key from state, toasting `Could not revoke the token, try again` on failure. Update `makeDeps` in the dashboard test (`fetchApiKeys: vi.fn(async () => [])`, `createApiKey: vi.fn(async () => ({ id: 'k', key: 'tlwb_x' }))`, `revokeApiKey: vi.fn(async () => undefined)`).

`board-app.tsx`: when `me` is set and the session role is not `local`, render `<NewTokenDialog open={agentDialogOpen} boards={[{ id: session.boardId, name }]} presetBoardId={session.boardId} createApiKey={createApiKey} fetchApiKeys={fetchApiKeys} onClose={() => setAgentDialogOpen(false)} />` (import the two functions from `../../dashboard/api`) and pass `onConnectAgent={() => { closeShare(); setAgentDialogOpen(true) }}` to `ShareDialog`; otherwise pass nothing, so the share dialog links to `/login`. Use whatever the board app already exposes for the board id and name (`session` snapshot meta).

- [ ] **Step 8: Run everything**

Run: `pnpm --filter @tlwb/web test && pnpm -r typecheck && pnpm biome check --write .`
Expected: PASS.

- [ ] **Step 9: Visual check** against `1PT-0`, `1UR-0`, `1Z8-0`, and `2EF-0` (from the editor's share dialog).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "✨ feat(web): add the agents page with named tokens and the connection guide"
```

---

### Task 11: Landing page

**Files:**
- Modify: `apps/web/index.html`, `apps/web/src/landing/landing.css`, `apps/web/src/landing/recents.ts`
- Test: `apps/web/test/landing/recents.test.ts` (existing; the `renderSession` assertion changes to the nav link), `apps/web/e2e/visual.spec.ts` (Task 12)

**Interfaces:**
- Consumes: tokens, `.button-primary`, `.button-secondary`, `.logotype` styles (the logotype here is static HTML using the same class and the `nav` / `footer` SVGs from Task 2's table).
- Produces: static HTML; `renderSession` keeps swapping `Sign in` for `Dashboard` on `#session-link`.

Paper values (nodes `12Z-0`, `139-0`, `13H-0`/`13I-0`/`13J-0`, `19B-0`, `1A5-0`, `1AD-0`, `1BW-0`): page surface, every section `padding-inline: 160px` on 1440 (use `padding-inline: clamp(16px, 11vw, 160px)`). Nav: padding-block 28, logotype nav size, links gap 36, 14/500 ink-secondary: `GitHub`, `Pricing` (`#pricing`), `Sign in`. Hero: padding-top 64, gap 24, centered; headline Caveat 76/80 600 max-width 870 `The little whiteboard for you, your team, and your agents.`; subline 16/26 ink-secondary max-width 600 `Sketch hand-drawn diagrams in seconds. Collaborate live. Let your agents draw with you through MCP.`; CTA group gap 10 padding-top 8: `Draw now` accent 48 tall padding-inline 32 16/500, caption `No account needed` 12px ink-secondary. Preview wrap: padding 56 top, 96 bottom; frame 1120 wide (max-width 100%), radius-lg, border, shadow-lg, overflow clip: browser bar 44 tall surface-alt border-bottom padding-inline 16 gap 16 with three 11px border dots (gap 7) and a URL pill (28 tall, surface, border, radius-full, padding-inline 16, lock 12px + `tlwb.app/b/payments-architecture` 12px ink-secondary), then the `editor-preview.png` image (Task 12 regenerates it at 1120x699). Proof: surface-alt, padding-block 88, gap 64, three columns gap 12 each: sketch SVG (bolt 72x64, shared board 96x64, agent drawing 96x64, paths verbatim from the Paper export quoted in this plan's research; copy them from `get_jsx(nodeId: "19B-0")`), title 20/600, body 14/22 ink-secondary max-width 300: `Instant` / `Open a link, draw, share. Nothing to install, no sign-up wall.`; `Collaborative` / `Live cursors, shared boards, edit together.`; `Your agents, via MCP` / `Your AI agents read and sketch on your boards like teammates.` Open source: ink background, padding-block 88, gap 16: `tlwb is open source` Caveat 48/52 600 white, one-liner 16/26 `#FFFFFFB8` max-width 560 `Self-host the whole thing: the engine, the client, and the MCP server are MIT-licensed.`, white button 44 tall padding-inline 24 gap 10 with the GitHub mark 18px and `View on GitHub` 14/500 ink, margin-top 8. Pricing (`id="pricing"`): padding-block 96, gap 48: `Simple pricing` Caveat 48/52, sub 16px ink-secondary `Free for everyone. Pro when you need more room.`; two cards 400 wide gap 32 (wrap at narrow widths), padding 32, gap 24, radius-lg, border; Free card has shadow-md: `Free` 16/600, `$0` 36/40 600 + `forever` 14 ink-secondary baseline; four rows gap 12, check 16px accent 2.2 + 14px text: `Draw without an account`, `Keep up to 10 boards`, `Live collaboration`, `MCP access`; `Draw now` accent 40 tall full width 14/500. Pro card: `Pro` 16/600 + `Coming soon` pill (accent-soft, accent 12/600, 22 tall, padding-inline 10); `For teams and heavy sketchers.` 14/22 ink-secondary; rows with ink-secondary checks: `Unlimited boards`, `Priority support`, `Early team features`; `Join the waiting list` `button-secondary` 40 tall full width, linking to `mailto:tlwb@jdevelop.io?subject=Pro%20waiting%20list`. Footer: border-top, padding-block 36, space-between: logotype footer size; right group gap 12: GitHub mark 15px + `GitHub` 14 ink-secondary, `·` border color, `Made by JDevelop`, then (deviation 5) `·` `Privacy` `·` `Terms`.

- [ ] **Step 1: Update the failing recents test** so `renderSession` targets the nav link (`#session-link` remains the id; assert `textContent` becomes `Dashboard` when signed in).

- [ ] **Step 2: Rewrite `index.html`** with the structure above (`<header class="nav">`, `<section class="hero">`, `<section class="preview-wrap">`, `<section class="proof">`, `<section class="open-source">`, `<section class="pricing" id="pricing">`, `<footer class="footer">`), the `#resume` container kept between the CTA caption and the preview (deviation 6), and the meta tags unchanged. Every visible string verbatim from the list above.

- [ ] **Step 3: Rewrite `landing.css`** from the values above using only tokens; `.resume ul` pills reuse `.pill` at 28px height. Below 900px the proof stacks, cards stack, headline drops to 48/52, and section padding to 16px.

- [ ] **Step 4: Run** `pnpm --filter @tlwb/web test -- recents` and `pnpm --filter @tlwb/web build`.
Expected: PASS, build succeeds.

- [ ] **Step 5: Visual check** at 1440 wide against `get_screenshot(nodeId: "12Y-0")` (scroll and compare each section).

- [ ] **Step 6: Commit**

```bash
git add apps/web/index.html apps/web/src/landing apps/web/test/landing
git commit -m "💄 style(web): rebuild the landing page on the Paper artboard"
```

---

### Task 12: Login restyle, preview capture, alias removal, visual review gate

**Files:**
- Modify: `apps/web/login.html`, `apps/web/src/login/login.css`
- Modify: `apps/web/scripts/capture-preview.mjs` (viewport 1120x699, output `public/editor-preview.png`)
- Modify: `apps/web/src/styles/tokens.css` (delete the legacy alias block), every remaining `var(--paper|--muted|--accent|--space-*|--radius)` under `apps/web/src` and `apps/web/*.html`
- Create: `apps/web/e2e/visual.spec.ts`
- Modify: `apps/web/README.md` or the repository `README.md` section on design if it mentions token names

- [ ] **Step 1: Login.** Replace the `.wordmark` anchor with the logotype markup (nav size); card 320 wide, padding 24, radius-lg, border, shadow-md; title 20/600; OAuth buttons `button-secondary` full width. Only tokens.

- [ ] **Step 2: Regenerate the preview.** Set the capture viewport to 1120x699 in `capture-preview.mjs`, draw the sample diagram it already draws, run `node apps/web/scripts/capture-preview.mjs` with the dev stack up, and check `public/editor-preview.png` shows the new chrome. Update `og:image:width/height` in `index.html` if the script changes the OG image size (keep the OG image 2400x1260 if the script produces both; otherwise leave the OG tags pointing at the same file with its actual dimensions).

- [ ] **Step 3: Remove the aliases.** Run

```bash
grep -rnE 'var\(--(paper|surface|border|ink|muted|accent|accent-soft|agent|danger|radius|shadow|space-[1-5])\)' apps/web/src apps/web/*.html
```

and replace each hit with its Paper name (`--paper`→`--color-surface-alt`, `--surface`→`--color-surface`, `--border`→`--color-border`, `--ink`→`--color-ink`, `--muted`→`--color-ink-secondary`, `--accent`→`--color-accent`, `--accent-soft`→`--color-accent-soft`, `--agent`→`--color-agent`, `--danger`→`--color-danger`, `--radius`→`--radius-md`, `--shadow`→`--shadow-md`, `--space-1..4`→`--spacing-4/8/16/24`, `--space-5`→`40px`). Then delete the alias block from `tokens.css` and add to `tokens.test.ts`:

```ts
  it('defines no legacy alias', () => {
    expect(css).not.toMatch(/--(paper|muted|space-1):/)
  })
```

- [ ] **Step 4: Visual gate.** Write `apps/web/e2e/visual.spec.ts`: for each of `/` (full page), `/b/<seeded board>` (1440x900), `/b/<seeded board>` with the share dialog open, `/dashboard`, `/dashboard/agents`, `/dashboard/agents` with the dialog open (signed in via `seedSession` + `addSessionCookie`), take `page.screenshot({ path: `test-results/visual/<name>.png` })` at viewport 1440x900 and `expect(page).toHaveScreenshot(...)` is NOT used (no committed baselines); the spec only produces the captures. Run `pnpm --filter @tlwb/web e2e -- visual`, then export the matching Paper artboards with `mcp__plugin_paper-desktop_paper__export` (PNG, scale 1) into the scratchpad and compare pairs side by side with the Read tool. Fix every visible difference in a single batch, re-run, and record the pairs that still differ (they must all be in "Documented deviations").

- [ ] **Step 5: Run everything**

Run: `pnpm -r test && pnpm -r typecheck && pnpm biome check --write . && pnpm --filter @tlwb/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "💄 style(web): finish the Paper conformity pass and drop the legacy token aliases"
```

---

## Self-review notes

- Spec coverage: Foundations (Task 1), Editor Default (3), Selection (4), Share modal (5), Connect agent (10 via the share dialog), Landing (11), Dashboard My boards and Over quota (6, with deviation 1), Agents MCP and both New token modals (10), Login (12, no artboard). Server support (8, 9).
- Names used across tasks: `Logotype`, `AgentIcon` (2 → 3, 5, 6, 10); `relativeTime` (6 → 10); `Sidebar`, `BoardsView`, `viewFor` (6); `ApiKeySummary`, `fetchApiKeys`, `createApiKey`, `revokeApiKey` (8 server, 10 client, same shapes); `assertBoardAllowed` (9); `ShareDialog.onConnectAgent` (5 → 10); `.button-primary`, `.button-secondary`, `.button-quiet`, `.pill`, `.pill-agent`, `.ghost-card`, `.dialog`, `.dialog-title`, `.dialog-close`, `.divider`, `.caption` (1, 5 → 6, 10, 11, 12).
- Placeholders: none. Paper SVG paths not inlined in this document (proof sketches) are named by node id with the exact tool call that returns them.
