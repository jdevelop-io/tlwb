import type { Editor } from '@tlwb/engine'
import { useEditorState } from '../hooks/use-editor-state'
import './zoom-controls.css'

export function ZoomControls(props: { editor: Editor }) {
  const { camera, canUndo, canRedo, readOnly } = useEditorState(props.editor)
  const { editor } = props
  return (
    <div className="zoom-controls">
      <div className="cluster zoom-cluster">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => editor.zoomTo(camera.zoom / 1.2)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="zoom-level"
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
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 12h14M12 5v14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {readOnly ? null : (
        <div className="cluster history-cluster">
          <button
            type="button"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => editor.undo()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => editor.redo()}
          >
            <svg
              className="mirror"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
