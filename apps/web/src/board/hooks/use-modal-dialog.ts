import { type RefObject, useEffect, useRef } from 'react'

/**
 * Drives a native `<dialog>` from a boolean, and hands back the ref to
 * put on it. The effect owns the element: rendering the `open`
 * attribute instead opens a non-modal dialog, and, because React
 * commits attributes before effects run, leaves `dialog.open` already
 * true so `showModal()` never fires. Only `showModal()` gives the
 * backdrop, the focus trap, and dismissal on Escape.
 */
export function useModalDialog(
  open: boolean,
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    // A test environment without the modal API leaves the element alone.
    if (!dialog || typeof dialog.showModal !== 'function') {
      return
    }
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) {
      return
    }
    // The editor listens for keys on the window and preventDefaults the
    // ones it consumes, Escape included, which cancels the browser's own
    // dismissal of a modal before it happens. Keys pressed inside a
    // dialog are the dialog's business and stop here.
    const swallow = (event: KeyboardEvent): void => event.stopPropagation()
    dialog.addEventListener('keydown', swallow)
    return () => dialog.removeEventListener('keydown', swallow)
  }, [])

  return ref
}
