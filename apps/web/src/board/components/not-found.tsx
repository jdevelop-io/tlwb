export function NotFound() {
  return (
    <main className="not-found">
      <h1>Board not found or incomplete link</h1>
      <p>
        This browser holds no copy of this board, and the link carries no key to
        fetch it. Ask for the link again, or start fresh.
      </p>
      <a className="button" href="/b/new">
        New board
      </a>
    </main>
  )
}
