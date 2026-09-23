import type { Editor } from '@tlwb/engine'
import { useEffect, useRef, useState } from 'react'
import { download, duplicateBoard, removeBoard } from '../session/board-actions'
import type { BoardSession } from '../session/board-session'
import { BOARD_BACKGROUND } from '../session/palette'
import { Notice } from './notice'
import './overflow-menu.css'

const TOAST_DURATION_MS = 4000

export function OverflowMenu(props: { session: BoardSession; editor: Editor }) {
  const { session, editor } = props
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
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

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const run =
    (action: () => Promise<void> | void, errorMessage: string) => async () => {
      setOpen(false)
      try {
        await action()
      } catch {
        setToast(errorMessage)
      }
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
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <menu>
          <li>
            <button
              type="button"
              onClick={run(async () => {
                const blob = await editor.exportPng({
                  background: BOARD_BACKGROUND,
                  scale: 2,
                })
                download(blob, `${name()}.png`)
              }, 'Could not export the board')}
            >
              Export PNG
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={run(() => {
                const svg = editor.exportSvg({ background: BOARD_BACKGROUND })
                download(
                  new Blob([svg], { type: 'image/svg+xml' }),
                  `${name()}.svg`,
                )
              }, 'Could not export the board')}
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
              }, 'Could not duplicate the board')}
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
              }, 'Could not remove the board')}
            >
              Remove from this browser
            </button>
          </li>
        </menu>
      ) : null}
      {toast ? (
        <Notice kind="toast" onClose={() => setToast(null)}>
          {toast}
        </Notice>
      ) : null}
    </div>
  )
}
