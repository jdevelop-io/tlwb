import type { Editor } from '@tlwb/engine'
import { createEditor } from '@tlwb/engine'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { usePeers } from '../hooks/use-peers'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import { type Identity, saveIdentity } from '../session/identity'
import { FONTS } from '../session/palette'
import '../board.css'
import { ContextPanel } from './context-panel'
import { Notice } from './notice'
import { PresenceStack } from './presence-stack'
import { ShareDialog } from './share-dialog'
import { TextEditor } from './text-editor'
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [identity, setIdentity] = useState(props.identity)
  const [shareOpen, setShareOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [linkDead, setLinkDead] = useState(false)
  const snapshot = useSession(session)
  const peers = usePeers(session)

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
      onTextEditRequest: (id) => setEditingId(id),
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

  useEffect(() => {
    editor?.setPresence(peers)
  }, [editor, peers])

  useEffect(() => {
    const code = snapshot.closeCode
    if (code === 4401 || code === 4404) {
      session.forgetKeys()
      setLinkDead(true)
    } else if (code === 4403) {
      session.becomeViewer()
    } else if (code === 4409 || code === 4422 || code === 4429) {
      setToast('Change refused by the server')
    }
    // Consumed once: clearing it here makes an identical repeat a real
    // transition next time, so the effect fires again instead of the
    // code lingering unchanged.
    if (code !== null) {
      session.acknowledgeClose()
    }
  }, [session, snapshot.closeCode])

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const rename = (next: Identity): void => {
    saveIdentity(next)
    setIdentity(next)
    session.setIdentity(next)
  }

  return (
    <div className="board">
      <div ref={containerRef} className="board-canvas" />
      {editor ? (
        <EditorContext.Provider value={{ editor, session }}>
          <TopBar session={session} />
          <Toolbar editor={editor} onPickImage={() => undefined} />
          <ContextPanel editor={editor} store={session.store} />
          <ZoomControls editor={editor} />
          <PresenceStack
            session={session}
            identity={identity}
            onRename={rename}
            onShare={() => setShareOpen(true)}
            menu={null}
          />
          <ShareDialog
            session={session}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
          />
          {editingId ? (
            <TextEditor
              editor={editor}
              store={session.store}
              id={editingId}
              onDone={() => setEditingId(null)}
            />
          ) : null}
          {snapshot.role === 'view' ? (
            <Notice kind="banner">View only</Notice>
          ) : null}
          {snapshot.storage === 'memory' ? (
            <Notice kind="banner">This browser is not saving this board</Notice>
          ) : null}
          {linkDead ? (
            <Notice kind="banner">This link is no longer valid</Notice>
          ) : null}
          {toast ? (
            <Notice kind="toast" onClose={() => setToast(null)}>
              {toast}
            </Notice>
          ) : null}
        </EditorContext.Provider>
      ) : null}
    </div>
  )
}
