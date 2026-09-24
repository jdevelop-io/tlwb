import { useState } from 'react'
import { useModalDialog } from '../hooks/use-modal-dialog'

const MOD =
  typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl'

/** Each row: what it does, then the keys pressed together. */
const SECTIONS: Array<[string, Array<[string, string[]]>]> = [
  [
    'Tools',
    [
      ['Pick a tool', ['1', '…', '0']],
      ['Eraser', ['E']],
    ],
  ],
  [
    'Canvas',
    [
      ['Pan', ['Space', 'Drag']],
      ['Scroll', ['Wheel']],
      ['Zoom', [MOD, 'Wheel']],
      ['Edit text or label a shape', ['Double-click']],
    ],
  ],
  [
    'Edit',
    [
      ['Undo', [MOD, 'Z']],
      ['Redo', ['Shift', MOD, 'Z']],
      ['Select all', [MOD, 'A']],
      ['Duplicate', [MOD, 'D']],
      ['Group', [MOD, 'G']],
      ['Ungroup', ['Shift', MOD, 'G']],
      ['Bring forward', [MOD, ']']],
      ['Send backward', [MOD, '[']],
      ['Nudge', ['←', '↑', '↓', '→']],
      ['Delete', ['Delete']],
    ],
  ],
]

export function HelpButton() {
  const [open, setOpen] = useState(false)
  const ref = useModalDialog(open)

  return (
    <>
      <button
        type="button"
        className="help-button"
        aria-label="Help"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      <dialog
        ref={ref}
        className="dialog shortcuts-dialog"
        onClose={() => setOpen(false)}
      >
        <header className="dialog-header">
          <h2 className="dialog-title">Shortcuts</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        {SECTIONS.map(([title, rows]) => (
          <section key={title} className="shortcuts-section">
            <h3 className="shortcuts-heading">{title}</h3>
            <dl>
              {rows.map(([what, keys]) => (
                <div key={what} className="shortcuts-row">
                  <dt>{what}</dt>
                  <dd>
                    {keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </dialog>
    </>
  )
}
