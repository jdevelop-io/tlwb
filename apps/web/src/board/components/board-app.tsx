import type { Editor } from '@tlwb/engine'
import { createEditor } from '@tlwb/engine'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import type { Identity } from '../session/identity'
import { FONTS } from '../session/palette'
import '../board.css'
import { ContextPanel } from './context-panel'
import { Notice } from './notice'
import { Toolbar } from './toolbar'
import { TopBar } from './top-bar'
import { ZoomControls } from './zoom-controls'

export interface EditorContextValue {
  editor: Editor
  session: BoardSession
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext)
  if (!value) {
    throw new Error('useEditor outside of BoardApp')
  }
  return value
}

export function BoardApp(props: { session: BoardSession; identity: Identity }) {
  const { session } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const snapshot = useSession(session)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const created = createEditor({
      container,
      store: session.store,
      fonts: FONTS,
      background: '#FFFFFF',
      readOnly: session.getSnapshot().role === 'view',
      resolveImage: (hash) => session.images.resolve(hash),
      resolveImageUrl: (hash) => session.images.resolveUrl(hash),
      onCursorMove: (point) => session.presence().setCursor(point),
    })
    setEditor(created)
    return () => {
      created.destroy()
      setEditor(null)
    }
  }, [session])

  // The image cache and the presence notify through the session; both
  // need a repaint the renderer cannot know about.
  useEffect(() => {
    if (!editor) {
      return
    }
    editor.setCamera(editor.getState().camera)
    editor.setReadOnly(snapshot.role === 'view')
  }, [editor, snapshot])

  useEffect(() => {
    if (!editor) {
      return
    }
    return editor.subscribe(() => {
      session.presence().setSelection(editor.getState().selectedIds)
    })
  }, [editor, session])

  return (
    <div className="board">
      <div ref={containerRef} className="board-canvas" />
      {editor ? (
        <EditorContext.Provider value={{ editor, session }}>
          <TopBar session={session} />
          <Toolbar editor={editor} onPickImage={() => undefined} />
          <ContextPanel editor={editor} store={session.store} />
          <ZoomControls editor={editor} />
          {snapshot.role === 'view' ? (
            <Notice kind="banner">View only</Notice>
          ) : null}
          {snapshot.storage === 'memory' ? (
            <Notice kind="banner">This browser is not saving this board</Notice>
          ) : null}
        </EditorContext.Provider>
      ) : null}
    </div>
  )
}
