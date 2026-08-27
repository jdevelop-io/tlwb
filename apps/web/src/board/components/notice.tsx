import type { ReactNode } from 'react'
import './notice.css'

export type NoticeKind = 'banner' | 'toast'

export function Notice(props: {
  kind: NoticeKind
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <output
      className={`notice notice-${props.kind}`}
      // An `<output>` gets no accessible name from its content, so a
      // screen reader would announce it with none; every caller passes
      // plain text, so that text doubles as the label.
      aria-label={
        typeof props.children === 'string' ? props.children : undefined
      }
    >
      {props.children}
      {props.onClose ? (
        <button type="button" onClick={props.onClose} aria-label="Dismiss">
          ×
        </button>
      ) : null}
    </output>
  )
}
