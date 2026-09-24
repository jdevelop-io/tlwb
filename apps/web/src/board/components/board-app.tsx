import type { Editor, PendingImage } from '@tlwb/engine'
import { createEditor } from '@tlwb/engine'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useCloseCode } from '../hooks/use-close-code'
import { usePeers } from '../hooks/use-peers'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import { type Identity, saveIdentity } from '../session/identity'
import { FONTS } from '../session/palette'
import { ServerError } from '../session/server'
import '../board.css'
import { ContextPanel } from './context-panel'
import { HelpButton } from './help-button'
import { Notice } from './notice'
import { OverflowMenu } from './overflow-menu'
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

/**
 * What a deployment with accounts adds to the editor. Absent, the
 * editor is the anonymous one: the wordmark goes home, the menu holds
 * recents only, and the share dialog hands the agent the MCP endpoint.
 */
export interface AccountProps {
  /** Where the wordmark links. */
  homeHref: string
  /** Extra entries rendered at the end of the board menu. */
  menuItems?: ReactNode
  /** Share dialog, "Connect an agent". */
  onConnectAgent?: () => void
}

export function BoardApp(props: {
  session: BoardSession
  identity: Identity
  account?: AccountProps
}) {
  const { session, account } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<PendingImage | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [identity, setIdentity] = useState(props.identity)
  const [shareOpen, setShareOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const snapshot = useSession(session)
  const peers = usePeers(session)
  const { linkDead, editRefused } = useCloseCode(session, setToast)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const created = createEditor({
      container,
      store: session.store,
      fonts: FONTS,
      background: 'transparent',
      readOnly: session.getSnapshot().role === 'view',
      resolveImage: (hash) => session.images.resolve(hash),
      resolveImageUrl: (hash) => session.images.resolveUrl(hash),
      getPendingImage: () => {
        const pending = pendingRef.current
        pendingRef.current = null
        return pending
      },
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
    if (!toast) {
      return
    }
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file || !editor) return
    try {
      pendingRef.current = await session.images.stage(file)
      editor.setActiveTool('image')
    } catch (error) {
      const status = error instanceof ServerError ? error.status : null
      setToast(
        status === 415
          ? 'This image type is not accepted'
          : status === 413
            ? 'This image is too large'
            : 'Could not upload the image',
      )
    }
  }

  const rename = (next: Identity): void => {
    saveIdentity(next)
    setIdentity(next)
    session.setIdentity(next)
  }

  return (
    <div className="board">
      <div ref={containerRef} className="board-canvas" />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        hidden
        onChange={(event) => {
          void onFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {editor ? (
        <EditorContext.Provider value={{ editor, session }}>
          <TopBar session={session} account={account} />
          <Toolbar
            editor={editor}
            onPickImage={() => fileRef.current?.click()}
          />
          <ContextPanel editor={editor} store={session.store} />
          <ZoomControls editor={editor} />
          <PresenceStack
            session={session}
            identity={identity}
            onRename={rename}
            onShare={() => setShareOpen(true)}
            menu={
              snapshot.role === 'view' ? null : (
                <OverflowMenu session={session} editor={editor} />
              )
            }
          />
          <ShareDialog
            session={session}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            onConnectAgent={
              snapshot.role !== 'local' && account?.onConnectAgent
                ? () => {
                    setShareOpen(false)
                    account.onConnectAgent?.()
                  }
                : undefined
            }
          />
          <HelpButton />
          {editingId ? (
            <TextEditor
              editor={editor}
              store={session.store}
              id={editingId}
              onDone={() => setEditingId(null)}
            />
          ) : null}
          {snapshot.role === 'view' ? (
            <Notice kind="banner">
              {editRefused
                ? 'Your change was not saved: this link is view only'
                : 'View only'}
            </Notice>
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
