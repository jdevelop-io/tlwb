import { CircleHelp } from 'lucide-react'
import { useRef } from 'react'

const SHORTCUTS: Array<[string, string]> = [
  ['1 to 0, E', 'Tools'],
  ['Space + drag, wheel', 'Pan and zoom'],
  ['Cmd/Ctrl + Z, Shift + Cmd/Ctrl + Z', 'Undo, redo'],
  ['Cmd/Ctrl + A, D, G, Shift + G', 'Select all, duplicate, group, ungroup'],
  ['Delete, arrows', 'Delete, nudge'],
  ['Double-click', 'Edit text or label a shape'],
]

export function HelpButton() {
  const ref = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button
        type="button"
        className="help-button"
        aria-label="Help"
        onClick={() => {
          if (typeof ref.current?.showModal === 'function') {
            ref.current.showModal()
          }
        }}
      >
        <CircleHelp size={18} />
      </button>
      <dialog ref={ref} className="share-dialog">
        <h2>Shortcuts</h2>
        <dl>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="close"
          onClick={() => {
            if (typeof ref.current?.close === 'function') {
              ref.current.close()
            }
          }}
        >
          Close
        </button>
      </dialog>
    </>
  )
}
