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
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEditorState } from '../hooks/use-editor-state'
import './context-panel.css'
import { FILL_COLORS, STROKE_COLORS } from '../session/palette'

const WIDTHS = [1, 2, 4]
const WIDTH_SAMPLE_HEIGHT: Record<number, string> = {
  1: '1.5px',
  2: '2.5px',
  4: '4px',
}
const STYLES: StrokeStyle[] = ['solid', 'dashed']
const SKETCHINESS = [0, 1, 2]
const FONT_SIZES = [16, 20, 28]
const FONT_SIZE_LABELS: Record<number, string> = { 16: 'S', 20: 'M', 28: 'L' }
const ALIGNS: Array<{ value: TextAlign; Icon: typeof AlignLeft }> = [
  { value: 'left', Icon: AlignLeft },
  { value: 'center', Icon: AlignCenter },
  { value: 'right', Icon: AlignRight },
]
const DEFAULT_TEXT_ALIGN: TextAlign = 'left'

function BringToFrontIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="7.5"
        y="2.5"
        width="6"
        height="6"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeDasharray="2 1.5"
      />
      <rect
        x="2.5"
        y="7.5"
        width="6"
        height="6"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SendToBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.5"
        y="7.5"
        width="6"
        height="6"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeDasharray="2 1.5"
      />
      <rect
        x="7.5"
        y="2.5"
        width="6"
        height="6"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Choice<T extends string | number | null>(props: {
  group: string
  kind: 'swatch' | 'segment'
  label: (value: T) => string
  values: readonly T[]
  current: T | undefined
  onPick: (value: T) => void
  render?: (value: T) => ReactNode
}) {
  return (
    <fieldset className="section" data-kind={props.kind}>
      <legend className="section-label">{props.group}</legend>
      <div className="section-row">
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
      </div>
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
  const current = {
    strokeColor: first?.strokeColor ?? STROKE_COLORS[0],
    fillColor: first ? first.fillColor : FILL_COLORS[0],
    strokeWidth: first?.strokeWidth ?? WIDTHS[1],
    strokeStyle: first?.strokeStyle ?? STYLES[0],
    sketchiness: first?.sketchiness ?? SKETCHINESS[1],
    fontSize: first?.type === 'text' ? first.fontSize : FONT_SIZES[1],
    textAlign: first?.type === 'text' ? first.textAlign : DEFAULT_TEXT_ALIGN,
  }
  const strokeSwatch = (color: string) => (
    <span className="swatch" style={{ background: color }} />
  )
  const fillSwatch = (color: string | null) => (
    <span
      className="swatch swatch-fill"
      style={color === null ? undefined : { background: color }}
      data-none={color === null ? '' : undefined}
    />
  )
  const widthSample = (value: number) => (
    <span
      className="width-sample"
      style={{ height: WIDTH_SAMPLE_HEIGHT[value] }}
    />
  )
  const styleSample = (value: StrokeStyle) => (
    <svg width="24" height="4" viewBox="0 0 24 4" aria-hidden="true">
      <path
        d="M1 2h22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={value === 'dashed' ? '4 4' : undefined}
      />
    </svg>
  )

  return (
    <aside className="context-panel" aria-label="Properties">
      <Choice
        group="Stroke"
        kind="swatch"
        label={(value) => `Stroke ${value}`}
        values={STROKE_COLORS}
        current={current.strokeColor}
        onPick={(strokeColor) => patch({ strokeColor })}
        render={strokeSwatch}
      />
      <Choice
        group="Fill"
        kind="swatch"
        label={(value) => `Fill ${value ?? 'none'}`}
        values={FILL_COLORS}
        current={current.fillColor}
        onPick={(fillColor) => patch({ fillColor })}
        render={fillSwatch}
      />
      <Choice
        group="Width"
        kind="segment"
        label={(value) => `Stroke width ${value}`}
        values={WIDTHS}
        current={current.strokeWidth}
        onPick={(strokeWidth) => patch({ strokeWidth })}
        render={widthSample}
      />
      <Choice
        group="Style"
        kind="segment"
        label={(value) => `Stroke style ${value}`}
        values={STYLES}
        current={current.strokeStyle}
        onPick={(strokeStyle) => patch({ strokeStyle })}
        render={styleSample}
      />
      <label className="section">
        <span className="section-label">Sketchiness</span>
        <input
          type="range"
          className="slider"
          aria-label="Sketchiness"
          min={0}
          max={2}
          step={1}
          value={current.sketchiness}
          onChange={(event) =>
            patch({ sketchiness: Number(event.target.value) })
          }
        />
      </label>
      {showsText ? (
        <>
          <Choice
            group="Font size"
            kind="segment"
            label={(value) => `Font size ${value}`}
            values={FONT_SIZES}
            current={current.fontSize}
            onPick={(fontSize) => patch({ fontSize })}
            render={(value) => FONT_SIZE_LABELS[value]}
          />
          <Choice
            group="Align"
            kind="segment"
            label={(value) => `Align ${value}`}
            values={ALIGNS.map((item) => item.value)}
            current={current.textAlign}
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
        <fieldset className="section" aria-label="Order">
          <legend className="section-label">Order</legend>
          <div className="z-order">
            <button
              type="button"
              aria-label="Bring to front"
              onClick={() => editor.execute({ kind: 'bring-to-front' })}
            >
              <BringToFrontIcon />
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
              <SendToBackIcon />
            </button>
          </div>
        </fieldset>
      ) : null}
    </aside>
  )
}
