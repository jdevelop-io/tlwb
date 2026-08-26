import type { Editor } from '@tlwb/engine'
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { download, duplicateBoard, removeBoard } from '../session/board-actions'
import type { BoardSession } from '../session/board-session'
import './overflow-menu.css'

export function OverflowMenu(props: { session: BoardSession; editor: Editor }) {
  const { session, editor } = props
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const name = () => session.store.getMeta().name || 'board'

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const run = (action: () => Promise<void> | void) => async () => {
    setOpen(false)
    await action()
  }

  return (
    <div className="overflow">
      <button
        ref={buttonRef}
        type="button"
        aria-label="More"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open ? (
        <menu>
          <li>
            <button
              type="button"
              onClick={run(async () => {
                const blob = await editor.exportPng({
                  background: '#FFFFFF',
                  scale: 2,
                })
                download(blob, `${name()}.png`)
              })}
            >
              Export PNG
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={run(() => {
                const svg = editor.exportSvg({ background: '#FFFFFF' })
                download(
                  new Blob([svg], { type: 'image/svg+xml' }),
                  `${name()}.svg`,
                )
              })}
            >
              Export SVG
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={run(async () => {
                const id = await duplicateBoard(session)
                location.assign(`/b/${id}`)
              })}
            >
              Duplicate
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={run(async () => {
                if (!confirm(`Remove "${name()}" from this browser?`)) {
                  return
                }
                await removeBoard(session)
                location.assign('/')
              })}
            >
              Remove from this browser
            </button>
          </li>
        </menu>
      ) : null}
    </div>
  )
}
