// Regenerates public/editor-preview.png, the hero image and Open Graph
// card of the landing. Drives the real editor through its tools so the
// capture stays faithful to what a visitor gets.
//
//   pnpm --filter @tlwb/web dev      # in another terminal
//   node apps/web/scripts/capture-preview.mjs
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = fileURLToPath(
  new URL('../public/editor-preview.png', import.meta.url),
)

// Matches the hero preview frame's displayed size (apps/web/index.html).
const VIEWPORT = { width: 1120, height: 699 }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: VIEWPORT })
await page.goto(`${BASE_URL}/b/new`)
await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
// Tool shortcuts only reach a focused canvas.
await page.mouse.click(600, 150)

async function drag(tool, from, to) {
  await page.keyboard.press(tool)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

async function label(at, text) {
  await page.keyboard.press('1')
  await page.mouse.dblclick(at.x, at.y)
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}

async function box(x, y, w, h, text) {
  await drag('3', { x, y }, { x: x + w, y: y + h })
  await label({ x: x + w / 2, y: y + h / 2 }, text)
}

async function arrow(from, to) {
  await drag('6', from, to)
}

// Scene: two humans and an agent converging on one board. The left
// 280px stay clear: the context panel (stroke, fill, width, ...) sits
// there whenever a drawing tool is active, wide enough to swallow a
// click meant for the canvas underneath.
await box(300, 250, 180, 90, 'You')
await box(580, 220, 220, 150, 'The board')
await box(900, 250, 190, 90, 'Claude Code')
await drag('4', { x: 590, y: 480 }, { x: 790, y: 570 })
await label({ x: 690, y: 525 }, 'Your team')

await arrow({ x: 485, y: 295 }, { x: 575, y: 295 })
await arrow({ x: 895, y: 295 }, { x: 805, y: 295 })
await arrow({ x: 690, y: 475 }, { x: 690, y: 375 })

await label({ x: 850, y: 265 }, 'MCP')
await label({ x: 530, y: 265 }, 'a link')

// Freehand underline under the board.
await page.keyboard.press('8')
await page.mouse.move(590, 395)
await page.mouse.down()
for (let x = 590; x <= 790; x += 10) {
  await page.mouse.move(x, 395 + Math.sin(x / 14) * 2, { steps: 2 })
}
await page.mouse.up()

// Colours and fake collaborators go through the automation handle the
// end-to-end tests use; nothing here is reachable from a normal visit.
await page.evaluate(() => {
  const { session } = window.tlwb
  const fills = {
    You: '#ffe1d9',
    'Claude Code': '#ece9fd',
    'The board': '#ffffff',
  }
  const elements = session.store.listElements()
  const changes = []
  for (const element of elements) {
    if (element.type !== 'text' || !element.containerId) continue
    const fill = fills[element.text]
    if (fill)
      changes.push({
        kind: 'update',
        id: element.containerId,
        props: { fillColor: fill },
      })
    if (element.text === 'Your team')
      changes.push({
        kind: 'update',
        id: element.containerId,
        props: { fillColor: '#f7f7f5' },
      })
  }
  const scribble = elements.find((element) => element.type === 'draw')
  if (scribble)
    changes.push({
      kind: 'update',
      id: scribble.id,
      props: { strokeColor: '#ff6b4a', strokeWidth: 1 },
    })
  session.store.applyChanges(changes)
  session.store.setMeta({ name: 'How agents join' })

  const presence = session.presence()
  const peers = [
    {
      id: 'agent',
      name: 'Claude',
      color: '#8b7cf6',
      cursor: { x: 765, y: 310 },
      selectedIds: [],
      isAgent: true,
    },
    {
      id: 'ana',
      name: 'Ana',
      color: '#2b8a3e',
      cursor: { x: 635, y: 530 },
      selectedIds: [],
      isAgent: false,
    },
  ]
  presence.getPeers = () => peers
})

// Deselect and nudge the pointer so the overlay repaints with the peers.
await page.keyboard.press('1')
await page.keyboard.press('Escape')
await page.mouse.click(1010, 650)
await page.mouse.move(1040, 660)
await page.waitForTimeout(300)

await page.screenshot({ path: OUT })
await browser.close()
console.log(`wrote ${OUT}`)
