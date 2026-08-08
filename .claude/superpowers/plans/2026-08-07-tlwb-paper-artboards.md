# tlwb Paper Artboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the validated product design of tlwb as Paper artboards (foundations, board editor plus variants, landing page, dashboard, agents/MCP page), iterating with the user until each artboard is approved.

**Architecture:** Design work happens in the Paper desktop app through the Paper MCP server. Each task designs one page of the Paper file, driven by the `impeccable-paper:impeccable-paper` skill for craft, and ends with a user review gate: screenshot presented, feedback applied, repeat until the user approves. The specification at `.claude/superpowers/specs/2026-08-07-tlwb-product-design.md` is the brief and wins over taste.

**Tech Stack:** Paper MCP tools (`mcp__plugin_paper-desktop_paper__*`), `impeccable-paper:impeccable-paper` skill, no code and no git commits in this plan (the Paper file lives outside the repository).

## Global Constraints

Copied from the specification; every task implicitly includes them.

- Visual principle: chrome recedes, drawn content is the star. Personality lives in details (handwritten logo, sketched empty states, warm microcopy), never in scribbled buttons.
- Chrome palette: surfaces `#FFFFFF`, warm light gray `#F7F7F5`, borders `#E5E4E0`, ink text `#1A1A1A`, secondary text `#6B6B6B`.
- Brand accent: marker coral `#FF6B4A` (CTAs, presence, logo).
- Agent identity color: soft violet, reserved exclusively for agents (avatar ring, cursor, badge). Exact value fixed in Task 1 and reused verbatim afterwards.
- Canvas drawing palette: black ink plus six marker colors (red, orange, green, blue, violet, yellow) with pastel fill variants. Exact values fixed in Task 1.
- Typography: neutral sans-serif for UI (Inter or closest family available in Paper), body 14px, scale 12/14/16/20/28/40. Handwriting family (Caveat/Virgil style, from Paper's available fonts) reserved for the logo, landing headlines, and canvas text.
- Shape: 8px spacing grid (4px half-step), radii 8px (10 to 12px for modals), soft low shadows on floating panels, thin-line icons (Lucide style).
- Light mode only in this phase.
- All product copy in English.
- Artboard sizes: 1440x900 for editor, dashboard, and agents screens; landing is 1440 wide with fit-content height.
- Paper session protocol (each working session): call `get_guide({ topic: "paper-mcp-instructions" })` once before other Paper tools, `get_basic_info` before designing, `get_font_family_info` before first typographic styling, roughly one visual group per `write_html` call, `get_screenshot` to verify after meaningful changes, `finish_working_on_nodes` when done.
- Craft protocol: invoke the `impeccable-paper:impeccable-paper` skill before canvas work in every task and follow its workflow (bounded verification passes, not endless loops).
- User review gate: every task ends by exporting a screenshot of the artboard(s), presenting it to the user (conversation with the user is in French), applying feedback, and repeating until explicit approval. A task is complete only after user approval.
- Never delete or overwrite a previously approved artboard; variants and reworks go on new or duplicated artboards.

---

### Task 1: Paper file, design tokens, and Foundations page

**Files:**
- Paper: create file `tlwb`, page `Foundations`, artboard `Foundations / Tokens`

**Interfaces:**
- Consumes: specification section 7 (visual direction).
- Produces: the Paper file `tlwb`; design tokens registered in the file via `set_tokens` (colors: `surface`, `surface-alt`, `border`, `ink`, `ink-secondary`, `accent`, `agent`, plus the six canvas marker colors and their pastel fills; type scale; spacing; radii); the chosen UI font family and handwriting font family names; a reference artboard displaying them. All later tasks reuse these exact token values and font names.

- [x] **Step 1: Invoke the `impeccable-paper:impeccable-paper` skill** (mode: shape). Follow its setup: `get_basic_info` to confirm Paper Desktop is reachable (if not, ask the user to open Paper Desktop and retry once), then `get_guide({ topic: "paper-mcp-instructions" })`.

- [x] **Step 2: Create the file and page.** `create_file` named `tlwb`, then a page named `Foundations` with one artboard `Foundations / Tokens` (1440 wide, fit-content height).

- [x] **Step 3: Resolve fonts.** `get_font_family_info`: pick the UI sans-serif (Inter if available, otherwise closest neutral) and the handwriting family (Caveat/Virgil style). Record both choices on the artboard.

- [x] **Step 4: Fix exact color values.** Choose the agent soft violet and the six marker colors plus pastel fills, harmonized with `#FF6B4A` and the chrome palette. Register everything with `set_tokens`.

- [x] **Step 5: Build the tokens artboard.** Sections: color swatches with names and hex values (chrome, accent, agent, canvas palette), type scale specimens (12 to 40px in both families), spacing scale bar (4/8/16/24/32/48), radius and shadow samples on card examples, a small icon-style sample row. Include the tlwb logotype: the word `tlwb` in the handwriting family, ink color, with a coral underline stroke.

- [x] **Step 6: Verify.** Bounded screenshot pass per the impeccable-paper skill; fix findings in one batch; `finish_working_on_nodes`.

- [x] **Step 7: User review gate.** Present the screenshot, iterate on feedback until approval.

---

### Task 2: Board editor artboard

**Files:**
- Paper: page `Editor`, artboard `Editor / Default` (1440x900)

**Interfaces:**
- Consumes: tokens and fonts from Task 1; specification sections 5.1 and 6.
- Produces: the approved editor layout, including the sample diagram, toolbar, and presence stack that Tasks 3 and 5 reuse (Task 3 duplicates this artboard; Task 5 reuses the sample diagram as thumbnail material).

- [x] **Step 1: Invoke `impeccable-paper:impeccable-paper`** (mode: craft) and run the Paper session protocol (guide if new session, `get_basic_info`, `get_tokens`).

- [x] **Step 2: Canvas base.** Full-bleed `#FFFFFF` canvas with the optional subtle dotted background, covered by a realistic hand-drawn sample diagram: a small technical architecture (for example client, API gateway, two services, a database, a queue) drawn as sketchy rectangles, ellipses, and arrows in the canvas palette, labels in the handwriting font. One sticky-note style text addressed to the agent (for example "Claude: add the cache layer here") to show the board-as-channel idea.

- [x] **Step 3: Chrome, group by group** (one `write_html` per group):
  - Top center floating toolbar: select, hand, rectangle, ellipse, diamond, arrow, line, draw, text, image, eraser; numbered shortcut hints; active tool highlighted in coral.
  - Top left: tlwb logotype (small), board name `payments architecture` inline-editable style, discreet "Saved" indicator.
  - Top right: avatar stack with three humans and one agent (name `Claude`, violet ring and a small bot badge), primary coral `Share` button, overflow menu icon.
  - Bottom left: zoom cluster (minus, `100%`, plus) and undo/redo. Bottom right: help icon.
  - Remote cursors on canvas: two human cursors with name labels in their presence colors, one violet agent cursor labeled `Claude` with badge, placed near the sticky note as if reading it.

- [x] **Step 4: Verify.** Bounded screenshot pass, batch fixes, `finish_working_on_nodes`.

- [x] **Step 5: User review gate.** Present, iterate until approval.

---

### Task 3: Editor variants (Share modal, contextual panel)

**Files:**
- Paper: page `Editor`, artboards `Editor / Share modal` and `Editor / Selection` (1440x900 each), duplicated from `Editor / Default`

**Interfaces:**
- Consumes: approved `Editor / Default` artboard from Task 2; specification sections 5.1 and 6.
- Produces: the Share modal design (reused conceptually by Task 6's per-board scope) and the contextual style panel design.

- [x] **Step 1: Invoke `impeccable-paper:impeccable-paper`** (mode: craft) and run the Paper session protocol.

- [x] **Step 2: Duplicate** `Editor / Default` twice with `duplicate_nodes`; rename to `Editor / Share modal` and `Editor / Selection` with `rename_nodes`.

- [x] **Step 3: Share modal variant.** Centered modal (radius 10 to 12px, soft shadow, dim overlay): title `Share this board`, copyable link field with `Copy link` button, access toggle (`Can view` / `Can edit`), divider, then an `Agent` block: short line `Let your agent work on this board`, secondary button `Connect an agent` pointing to the Agents page.

- [x] **Step 4: Selection variant.** On the base artboard, mark one diagram shape as selected (selection outline and handles in coral). Left contextual panel visible: stroke color swatches, fill swatches (pastels), stroke width (three steps), stroke style (solid, dashed), sketchiness slider (three levels), text size, z-order buttons. Panel uses 8px grid, labels 12px.

- [x] **Step 5: Verify.** Bounded screenshot pass on both artboards, batch fixes, `finish_working_on_nodes`.

- [x] **Step 6: User review gate.** Present both, iterate until approval.

---

### Task 4: Landing page artboard

**Files:**
- Paper: page `Landing`, artboard `Landing / Desktop` (1440 wide, fit-content height)

**Interfaces:**
- Consumes: tokens and logotype from Task 1; editor visual from Task 2 as the hero preview reference.
- Produces: the approved landing page design.

- [x] **Step 1: Invoke `impeccable-paper:impeccable-paper`** (mode: craft, Persuade surface) and run the Paper session protocol.

- [x] **Step 2: Hero.** Nav: logotype left; `GitHub`, `Pricing`, `Sign in` right, all quiet. Headline in the handwriting family: `The little whiteboard for you, your team, and your agents.` Subline (UI font, secondary ink): `Sketch hand-drawn diagrams in seconds. Collaborate live. Let your agents draw with you through MCP.` Primary coral CTA `Draw now`, caption under it: `No account needed`. Below: a framed preview of the editor (reuse the Task 2 composition, simplified) showing the agent cursor drawing.

- [x] **Step 3: Proof blocks.** Three columns on `#F7F7F5`: `Instant` (Open a link, draw, share. Nothing to install, no sign-up wall), `Collaborative` (Live cursors, shared boards, edit together), `Your agents, via MCP` (Your AI agents read and sketch on your boards like teammates). Each with a small sketched illustration.

- [x] **Step 4: Open source block.** Dark-on-light band: `tlwb is open source` with a GitHub button and a one-liner about self-hosting (MIT engine, client, and MCP server).

- [x] **Step 5: Pricing.** Two cards: `Free` (Draw without an account; keep up to 10 boards; live collaboration; MCP access) and `Pro` (Unlimited boards; priority support; early team features) with a `Coming soon` waiting-list note on Pro. Footer: logotype, GitHub, `Made by JDevelop`.

- [x] **Step 6: Verify.** Bounded screenshot pass, batch fixes, switch artboard to fit-content if anything clips, `finish_working_on_nodes`.

- [x] **Step 7: User review gate.** Present, iterate until approval.

---

### Task 5: Dashboard artboard

**Files:**
- Paper: page `Dashboard`, artboard `Dashboard / My boards` (1440x900)

**Interfaces:**
- Consumes: tokens from Task 1; sample diagram from Task 2 for thumbnails.
- Produces: the approved dashboard design; its sidebar (Boards, Agents, Settings) is reused by Task 6.

- [x] **Step 1: Invoke `impeccable-paper:impeccable-paper`** (mode: craft, Operate surface) and run the Paper session protocol.

- [x] **Step 2: Frame.** Minimal left sidebar: logotype, then `Boards` (active), `Agents`, `Settings`; bottom: user avatar and plan line `Free · 7/10 boards` with a quiet `Upgrade` link. Main header: title `My boards`, primary coral button `New board`.

- [x] **Step 3: Adoption banner.** Dismissible band under the header: `3 boards live in this browser only. Attach them to your account to keep them everywhere.` with button `Attach boards`.

- [x] **Step 4: Board grid.** Cards (radius 8px, border `#E5E4E0`, thumbnail, name, `Edited 2h ago` style timestamps). Include variety: the `payments architecture` board with a `Shared` badge and an agent badge (violet dot plus `Claude`), a couple of plain boards, one empty-state style card sketch. Thumbnails are simplified hand-drawn sketches, not gray placeholders.

- [x] **Step 5: Verify.** Bounded screenshot pass, batch fixes, `finish_working_on_nodes`.

- [x] **Step 6: User review gate.** Present, iterate until approval.

---

### Task 6: Agents / MCP page artboard

**Files:**
- Paper: page `Agents`, artboard `Agents / MCP` (1440x900)

**Interfaces:**
- Consumes: tokens from Task 1; sidebar frame from Task 5.
- Produces: the approved agents page design; completes the artboard set.

- [x] **Step 1: Invoke `impeccable-paper:impeccable-paper`** (mode: craft, Operate surface) and run the Paper session protocol.

- [x] **Step 2: Frame.** Same sidebar as Task 5 with `Agents` active. Header: title `Agents`, subline `Connect your AI agents to your boards through MCP.`

- [x] **Step 3: Left pane, connected agents.** List of token cards: name (for example `Claude · laptop`), scope line (`All boards` or `2 boards`), last activity (`Active 5 min ago` with a green dot, or `Never used`), quiet `Revoke` action. One card shows the violet agent identity. Top of pane: button `New token`.

- [x] **Step 4: Right pane, connection guide.** Numbered steps: 1. `Create a token` (short explanation, default scope all boards, restrictable per board); 2. `Add tlwb to your MCP client` with a copyable configuration snippet in a code block (realistic JSON for a streamable HTTP MCP server URL with the token); 3. `Test the connection` with a status chip that flips when the agent makes its first call (`Waiting for your agent...` state shown).

- [x] **Step 5: Verify.** Bounded screenshot pass, batch fixes, `finish_working_on_nodes`.

- [x] **Step 6: User review gate.** Present, iterate until approval.

---

### Task 7: Cross-screen consistency pass and final approval

**Files:**
- Paper: all pages of file `tlwb`

**Interfaces:**
- Consumes: all approved artboards from Tasks 1 to 6.
- Produces: the finished, consistent artboard set; final user sign-off closing the design phase.

- [x] **Step 1: Invoke `impeccable-paper:impeccable-paper`** (mode: audit) and run the Paper session protocol.

- [x] **Step 2: Audit.** Batched screenshots of every artboard. Check against the Global Constraints: token usage (no stray hex values off-palette), consistent logotype, consistent agent violet across editor, dashboard, and agents page, consistent sidebar between dashboard and agents, spacing grid, radii, typography scale, English copy tone.

- [x] **Step 3: Fix in one batch.** Apply corrections via `update_styles` / `set_text_content` where possible rather than rewriting HTML; `finish_working_on_nodes`.

- [x] **Step 4: Final user review gate.** Present the full set (all screenshots), iterate until the user declares the design phase complete.

- [x] **Step 5: Record the outcome.** Note in the conversation which artboards are approved and list any follow-ups the user deferred (these feed the next specifications: canvas engine and real-time collaboration, MCP server, accounts and freemium).
