import type {
  BoardStore,
  Editor,
  ElementProps,
  StrokeStyle,
  TextAlign,
} from '@tlwb/engine'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEditorState } from '../hooks/use-editor-state'
import { FILL_COLORS, STROKE_COLORS } from '../session/palette'
import './context-panel.css'

const WIDTHS = [1, 2, 4]
const STYLES: StrokeStyle[] = ['solid', 'dashed']
const SKETCHINESS = [0, 1, 2]
const FONT_SIZES = [16, 20, 28, 36]
const ALIGNS: Array<{ value: TextAlign; Icon: typeof AlignLeft }> = [
  { value: 'left', Icon: AlignLeft },
  { value: 'center', Icon: AlignCenter },
  { value: 'right', Icon: AlignRight },
]

function Choice<T extends string | number | null>(props: {
  group: string
  label: (value: T) => string
  values: readonly T[]
  current: T | undefined
  onPick: (value: T) => void
  render?: (value: T) => ReactNode
}) {
  return (
    <fieldset className="choice">
      <legend>{props.group}</legend>
      {props.values.map((value) => (
        <label key={String(value)} className="choice-item">
          <input
            type="radio"
            name={props.group}
            aria-label={props.label(value)}
            checked={props.current === value}
            onChange={() => props.onPick(value)}
          />
          {props.render ? props.render(value) : String(value)}
        </label>
      ))}
    </fieldset>
  )
}

export function ContextPanel(props: { editor: Editor; store: BoardStore }) {
  const { editor, store } = props
  const { activeTool, selectedIds, readOnly } = useEditorState(editor)
  const selected = selectedIds.flatMap((id) => {
    const element = store.getElement(id)
    return element ? [element] : []
  })
  const passiveTool =
    activeTool === 'select' || activeTool === 'hand' || activeTool === 'eraser'
  if (readOnly || (selected.length === 0 && passiveTool)) {
    return null
  }
  const first = selected[0]
  const patch = (patchProps: ElementProps): void => {
    if (selected.length > 0) {
      editor.updateSelection(patchProps)
    } else {
      editor.setDefaults(patchProps)
    }
  }
  const showsText = first ? first.type === 'text' : activeTool === 'text'
  const swatch = (color: string | null) => (
    <span
      className="swatch"
      style={{ background: color ?? 'transparent' }}
      data-none={color === null ? '' : undefined}
    />
  )

  return (
    <aside className="context-panel" aria-label="Properties">
      <Choice
        group="Stroke"
        label={(value) => `Stroke ${value}`}
        values={STROKE_COLORS}
        current={first?.strokeColor}
        onPick={(strokeColor) => patch({ strokeColor })}
        render={swatch}
      />
      <Choice
        group="Fill"
        label={(value) => `Fill ${value ?? 'none'}`}
        values={FILL_COLORS}
        current={first ? first.fillColor : undefined}
        onPick={(fillColor) => patch({ fillColor })}
        render={swatch}
      />
      <Choice
        group="Width"
        label={(value) => `Stroke width ${value}`}
        values={WIDTHS}
        current={first?.strokeWidth}
        onPick={(strokeWidth) => patch({ strokeWidth })}
      />
      <Choice
        group="Style"
        label={(value) => `Stroke style ${value}`}
        values={STYLES}
        current={first?.strokeStyle}
        onPick={(strokeStyle) => patch({ strokeStyle })}
      />
      <Choice
        group="Sketchiness"
        label={(value) => `Sketchiness ${value}`}
        values={SKETCHINESS}
        current={first?.sketchiness}
        onPick={(sketchiness) => patch({ sketchiness })}
      />
      {showsText ? (
        <>
          <Choice
            group="Font size"
            label={(value) => `Font size ${value}`}
            values={FONT_SIZES}
            current={first?.type === 'text' ? first.fontSize : undefined}
            onPick={(fontSize) => patch({ fontSize })}
          />
          <Choice
            group="Align"
            label={(value) => `Align ${value}`}
            values={ALIGNS.map((item) => item.value)}
            current={first?.type === 'text' ? first.textAlign : undefined}
            onPick={(textAlign) => patch({ textAlign })}
            render={(value) => {
              const Icon =
                ALIGNS.find((item) => item.value === value)?.Icon ?? AlignLeft
              return <Icon size={16} aria-hidden="true" />
            }}
          />
        </>
      ) : null}
      {selected.length > 0 ? (
        <fieldset className="z-order" aria-label="Order">
          <button
            type="button"
            aria-label="Bring to front"
            onClick={() => editor.execute({ kind: 'bring-to-front' })}
          >
            <ArrowUpToLine size={16} />
          </button>
          <button
            type="button"
            aria-label="Bring forward"
            onClick={() => editor.execute({ kind: 'bring-forward' })}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            aria-label="Send backward"
            onClick={() => editor.execute({ kind: 'send-backward' })}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            aria-label="Send to back"
            onClick={() => editor.execute({ kind: 'send-to-back' })}
          >
            <ArrowDownToLine size={16} />
          </button>
        </fieldset>
      ) : null}
    </aside>
  )
}
