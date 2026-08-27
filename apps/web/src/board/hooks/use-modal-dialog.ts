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
  return ref
}
