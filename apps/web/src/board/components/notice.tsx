import type { ReactNode } from 'react'
import './notice.css'

export type NoticeKind = 'banner' | 'toast'

export function Notice(props: {
  kind: NoticeKind
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <output className={`notice notice-${props.kind}`}>
      {props.children}
      {props.onClose ? (
        <button type="button" onClick={props.onClose} aria-label="Dismiss">
          ×
        </button>
      ) : null}
    </output>
  )
}
