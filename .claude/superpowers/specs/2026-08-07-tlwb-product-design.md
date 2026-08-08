# tlwb (The Little WhiteBoard): product and UI design

Date: 2026-08-07
Status: complete; Paper artboards delivered and approved on 2026-08-08
Deliverable of this phase: this specification plus Paper artboards

## 1. Concept and positioning

tlwb is a modern, freemium, instant virtual whiteboard: open a link, sketch
diagrams with a hand-drawn feel, collaborate in real time, and let your AI
agents read and edit your boards through MCP.

- Primary audience: developers and tech teams (architecture diagrams,
  technical sketches, team brainstorms). Distribution through developer
  word-of-mouth and open source.
- Differentiator: no single killer feature; the value is the combination of
  instant access, real-time collaboration, and first-class agent
  integration. The agent angle is the most distinctive of the three and is
  made visible in the product.
- Product structure: board-first. A board is a URL; creating one is the
  zero-friction action of the landing page. Accounts and the dashboard are
  a convenience layer on top, not a prerequisite.

## 2. Distribution model

"Adapted Excalidraw" open-core split:

- Open source (MIT, published under JDevelop): the whiteboard engine
  (canvas, hand-drawn rendering, packaged as a reusable library), the
  client application, and the MCP server.
- Proprietary SaaS: hosted infrastructure, meaning accounts, cloud
  persistence, hosted real-time collaboration, freemium limits and
  billing.
- Enterprise: a paid self-hosted edition of the full server (collaboration,
  SSO, support). Post-v1 in delivery, but part of the positioning from the
  start.

Accepted risk: a third party could reimplement a server on top of the MIT
client. Acceptable at this project's scale; adoption matters more.

## 3. Freemium and retention

- No account required to draw. Anonymous boards are local-first: stored in
  the browser (IndexedDB), kept indefinitely on the user's machine, zero
  server cost.
- A board is persisted server-side as soon as it is shared or used
  collaboratively. Server-side boards are kept indefinitely as well: board
  data is tiny vector JSON, and purging would break shared links for
  negligible savings. Abuse (spam, storage misuse) may be purged manually;
  no automatic expiry.
- Free account: keeps a limited number of boards (indicative cap: 10) and
  includes MCP access with a fair-use call quota (anti-abuse, not a
  barrier).
- Paid plan: unlimited boards; team features come later. Billing can start
  rudimentary (waiting list acceptable at launch).
- Signing up "adopts" the browser's anonymous boards into the account.

## 4. v1 scope

In scope:

- Full editor: shapes, arrows, free drawing, text, images, hand-drawn
  rendering.
- Real-time collaboration: shared cursors, presence, live edits.
- Sharing by link: read-only or edit.
- MCP server: the agent appears as a badged collaborator.
- Accounts with simple free limits.

Out of scope for v1: teams and workspaces, comments, full billing, mobile
applications, agent audit log, dark mode artboards (tokens plan for dark
mode; design ships light-only in this phase), built-in agent chat (see
section 6).

Follow-up specifications, in order: canvas engine plus real-time
collaboration (including the build-versus-reuse decision, for example
tldraw SDK or Excalidraw internals), MCP server, accounts and freemium,
enterprise self-hosted edition.

## 5. Screen-by-screen design

### 5.1 Board editor (core screen)

Full-screen canvas with minimal floating chrome:

- Top center toolbar: select, hand (pan), rectangle, ellipse, diamond,
  arrow, line, free draw, text, image, eraser. Numbered keyboard
  shortcuts.
- Left contextual panel, visible only when a tool or selection requires
  it: stroke color, fill, stroke width, stroke style (solid, dashed),
  sketchiness level, text size, alignment, z-order.
- Top left: tlwb logo (back to dashboard or landing), inline-editable
  board name, discreet save indicator.
- Top right: avatar stack of present collaborators (humans and agents,
  agents carry a distinctive badge), primary Share button, overflow menu
  (export PNG/SVG, duplicate, delete).
- Bottom left: zoom controls (minus, percentage, plus), undo/redo. Bottom
  right: help and shortcuts.
- Remote cursors: colored cursor with a name label; the agent gets the
  same treatment plus its badge. Agent edits stream live like a human's.
- Share modal: copyable link, read-only/edit toggle, and an Agent block
  linking to the MCP connection flow for this board.

### 5.2 Landing page

- One-sentence promise: the instant little whiteboard, for you, your team,
  and your agents.
- Single primary CTA "Draw now" creating a board without an account.
- Animated preview or capture of the editor showing an agent drawing.
- Three proof blocks: Instant / Collaborative / Your agents via MCP.
- Open source block: GitHub link, self-hosting mention.
- Simple pricing: Free versus Pro.
- Discreet sign-in at top right; sober footer.

### 5.3 Dashboard (my boards)

- Card grid: board thumbnail, name, last-modified date, badges for
  "shared" and "agent connected".
- Prominent "New board" button.
- Free-plan gauge (for example "7/10 boards") with a discreet upgrade
  link.
- Adoption banner when anonymous browser boards can be attached to the
  account.
- Minimal sidebar: Boards, Agents (MCP), Settings.

### 5.4 Agents / MCP connection

Two panes:

- Left: list of tokens/connected agents with name, scope (which boards),
  last activity, revocation.
- Right: step-by-step connection guide: generate a token, ready-to-copy
  configuration snippet for Claude Code, Claude Desktop, or any MCP
  client, and a connection test that confirms the agent's first call.
- Default token scope: all boards of the account, restrictable per board.

## 6. Agent UX and MCP surface

### Connection model

- Tokens are generated from the Agents page or from a board's Share
  modal. A token identifies the account and carries a scope (all boards
  or a restricted list).
- The MCP server is remote (streamable HTTP, hosted by the SaaS); the
  configuration snippet pastes as-is into any MCP client. Self-hosted
  deployments run the same server at a different URL.

### The agent inside a board

- On a token's first action on a board, the agent joins the avatar stack
  with the token's given name (for example "Claude") and the agent badge.
- Agent mutations flow through the same real-time pipeline as human
  edits; everyone sees them live, and the agent's cursor moves to what it
  edits.
- Undo/redo treats agent actions like any other collaborator's.

### MCP tool surface (v1, deliberately compact)

- `list_boards`: boards accessible to the token.
- `create_board`: new board, returns its URL.
- `read_board`: structured content (shapes, texts, connections) with an
  optional image export so the agent can "see" the board.
- `add_elements` / `update_elements` / `delete_elements`: batch mutations
  of elements (shapes, arrows, text, groups) with explicit positioning.
- `get_board_screenshot`: PNG render for visual verification.

Not in v1: comment tools, autonomous cursor choreography beyond
follow-the-edit, account management tools.

### Communicating with agents

No built-in chat in v1. The user converses with their agent in their own
client (Claude Code, Claude Desktop); on the board, notes and text
addressed to the agent are readable through MCP and the agent answers by
drawing or writing. Rationale: MCP is pull-based, tlwb cannot push into
the agent's session, and a built-in copilot would require tlwb-hosted
inference. A built-in copilot is a v2 premium track.

### Limits and error UX

- Free MCP quota exceeded: explicit MCP error with an upgrade link.
- Revoked token or insufficient scope: clear error naming the board.
- Real-time connection lost: discreet "reconnecting" banner; local edits
  continue and resynchronize.

## 7. Visual direction and design tokens

Principle: the chrome recedes, drawn content is the star. The "little"
personality lives in details (handwritten logo, sketched empty states,
warm microcopy), not in scribbled buttons.

### Palette

- Chrome: white surfaces `#FFFFFF`, warm light gray `#F7F7F5` (paper
  feel), borders `#E5E4E0`, ink text `#1A1A1A`, secondary text `#6B6B6B`.
- Brand accent: marker coral/orange around `#FF6B4A` for CTAs, presence,
  logo. Warm, distinct from Excalidraw violet and tldraw blue.
- Agent identity: a soft violet reserved for agents (avatar, cursor,
  badge) so humans and agents are distinguishable at a glance.
- Canvas drawing palette: black ink plus six marker-style colors (red,
  orange, green, blue, violet, yellow) with pastel fill variants.

### Typography

- UI: a neutral, readable sans-serif (Inter or the closest family
  available in Paper), body 14 px, scale 12/14/16/20/28/40.
- Handwritten: a handwriting family (Caveat/Virgil style) reserved for the
  logo, landing headlines, and default canvas text. Actual families are
  confirmed against Paper's available fonts before freezing.

### Shape and materials

- 8 px spacing grid (4 px half-step).
- Radii: 8 px default, 10 to 12 px for modals.
- Soft, low shadows for floating panels; no hard borders on the canvas.
- Thin-line icons (Lucide style).
- Optional very subtle dotted canvas background.
- Dark mode is planned in the tokens but not designed in this phase.

## 8. Paper file organization (deliverable)

Paper file "tlwb", one page per area:

1. Foundations: a tokens board (palette, type scale, spacing, radii,
   shadows, icons) referenced by every artboard.
2. Editor: 1440x900 desktop artboard, full screen with a realistic sample
   diagram (technical architecture, to speak to the audience), human and
   agent presence. Variants: Share modal open; contextual panel visible
   with an active selection.
3. Landing: 1440-wide artboard, fit-content height, full page from hero to
   footer.
4. Dashboard: 1440x900 artboard with board grid, free-plan gauge, adoption
   banner.
5. Agents / MCP: 1440x900 artboard with token list and connection guide
   including the configuration snippet.

Mobile is not designed in this phase: the v1 editor is desktop-first, and
the landing goes responsive at implementation time while its Paper design
stays desktop.
