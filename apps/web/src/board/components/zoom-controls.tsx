import type { Editor } from '@tlwb/engine'
import { Minus, Plus, Redo2, Undo2 } from 'lucide-react'
import { useEditorState } from '../hooks/use-editor-state'
import './zoom-controls.css'

export function ZoomControls(props: { editor: Editor }) {
  const { camera, canUndo, canRedo, readOnly } = useEditorState(props.editor)
  const { editor } = props
  return (
    <div className="zoom-controls">
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => editor.zoomTo(camera.zoom / 1.2)}
      >
        <Minus size={16} />
      </button>
      <button
        type="button"
        aria-label="Reset zoom"
        onClick={() => editor.zoomTo(1)}
      >
        {Math.round(camera.zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => editor.zoomTo(camera.zoom * 1.2)}
      >
        <Plus size={16} />
      </button>
      {readOnly ? null : (
        <>
          <span className="divider" />
          <button
            type="button"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => editor.undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => editor.redo()}
          >
            <Redo2 size={16} />
          </button>
        </>
      )}
    </div>
  )
}
