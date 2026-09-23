import type { Editor, ToolType } from '@tlwb/engine'
import {
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  Image,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Type,
} from 'lucide-react'
import { Fragment } from 'react'
import { useEditorState } from '../hooks/use-editor-state'
import './toolbar.css'

const TOOLS: Array<{
  type: ToolType
  label: string
  key: string
  Icon: typeof Square
  divider?: true
}> = [
  { type: 'select', label: 'Select', key: '1', Icon: MousePointer2 },
  { type: 'hand', label: 'Hand', key: '2', Icon: Hand, divider: true },
  { type: 'rectangle', label: 'Rectangle', key: '3', Icon: Square },
  { type: 'ellipse', label: 'Ellipse', key: '4', Icon: Circle },
  { type: 'diamond', label: 'Diamond', key: '5', Icon: Diamond },
  { type: 'arrow', label: 'Arrow', key: '6', Icon: ArrowRight },
  { type: 'line', label: 'Line', key: '7', Icon: Minus },
  { type: 'draw', label: 'Draw', key: '8', Icon: Pencil },
  { type: 'text', label: 'Text', key: '9', Icon: Type },
  { type: 'image', label: 'Image', key: '0', Icon: Image, divider: true },
  { type: 'eraser', label: 'Eraser', key: 'E', Icon: Eraser },
]

export function Toolbar(props: { editor: Editor; onPickImage: () => void }) {
  const { activeTool, readOnly } = useEditorState(props.editor)
  if (readOnly) {
    return null
  }
  return (
    <fieldset className="toolbar" aria-label="Tools">
      {TOOLS.map(({ type, label, key, Icon, divider }) => (
        <Fragment key={type}>
          <label className="tool" title={`${label} (${key})`}>
            <input
              type="radio"
              name="tool"
              aria-label={`${label} (${key})`}
              checked={activeTool === type}
              onChange={() =>
                type === 'image'
                  ? props.onPickImage()
                  : props.editor.setActiveTool(type)
              }
            />
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
            <kbd>{key}</kbd>
          </label>
          {divider ? (
            <span className="toolbar-divider" aria-hidden="true" />
          ) : null}
        </Fragment>
      ))}
    </fieldset>
  )
}
