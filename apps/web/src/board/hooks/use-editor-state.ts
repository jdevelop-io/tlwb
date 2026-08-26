import type { Editor, EditorState } from '@tlwb/engine'
import { useSyncExternalStore } from 'react'

export function useEditorState(editor: Editor): EditorState {
  return useSyncExternalStore(editor.subscribe, editor.getState)
}
