import type { BoardStore, Editor, ElementId } from '@tlwb/engine'
import { LINE_HEIGHT, measureText } from '@tlwb/engine'
import { useEffect, useRef, useState } from 'react'
import { useEditorState } from '../hooks/use-editor-state'
import { FONTS } from '../session/palette'
import './text-editor.css'

let sharedContext: CanvasRenderingContext2D | null = null

/** One offscreen context sizes the textarea like the renderer paints. */
function measuringContext(): CanvasRenderingContext2D | null {
  if (!sharedContext) {
    sharedContext = document.createElement('canvas').getContext('2d')
  }
  return sharedContext
}

export function TextEditor(props: {
  editor: Editor
  store: BoardStore
  id: ElementId
  onDone: () => void
}) {
  const { editor, store, id, onDone } = props
  const element = store.getElement(id)
  const [text, setText] = useState(element?.type === 'text' ? element.text : '')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const committed = useRef(false)
  // Re-rendered on every editor change so the box follows the camera and
  // notices a remote delete of the element under edit (which prunes it
  // from the selection, changing the editor state).
  useEditorState(editor)

  useEffect(() => {
    areaRef.current?.focus()
    areaRef.current?.select()
  }, [])

  if (element?.type !== 'text') {
    return null
  }
  const rect = editor.getElementScreenRect(id)
  if (!rect) {
    return null
  }
  const spec = {
    text: text || ' ',
    fontSize: element.fontSize,
    fontFamily: element.fontFamily,
  }
  const ctx = measuringContext()
  const measured = ctx
    ? measureText(spec, FONTS, ctx)
    : { width: rect.width, height: rect.height }
  const zoom = editor.getState().camera.zoom

  const commit = (): void => {
    if (committed.current) {
      return
    }
    committed.current = true
    editor.commitText(id, text)
    onDone()
  }

  return (
    <textarea
      ref={areaRef}
      className="text-editor"
      aria-label="Text"
      value={text}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${Math.max(measured.width * zoom + 8, rect.width)}px`,
        height: `${Math.max(measured.height * zoom, rect.height)}px`,
        fontFamily: FONTS[element.fontFamily],
        fontSize: `${element.fontSize * zoom}px`,
        lineHeight: String(LINE_HEIGHT),
        textAlign: element.textAlign,
        color: element.strokeColor,
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}
