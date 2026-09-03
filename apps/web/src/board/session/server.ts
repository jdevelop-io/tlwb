export interface HostedBoard {
  boardId: string
  editKey: string
  viewKey: string
}

export class ServerError extends Error {
  readonly status: number

  constructor(status: number, message = `server answered ${status}`) {
    super(message)
    this.status = status
  }
}

export async function createHostedBoard(
  fetchFn: typeof fetch = fetch,
): Promise<HostedBoard> {
  const response = await fetchFn('/api/boards', { method: 'POST' })
  if (response.status !== 201) {
    throw new ServerError(response.status)
  }
  const body = (await response.json()) as HostedBoard
  return { boardId: body.boardId, editKey: body.editKey, viewKey: body.viewKey }
}

export async function uploadAsset(
  boardId: string,
  hash: string,
  blob: Blob,
  editKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchFn(`/api/boards/${boardId}/assets/${hash}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${editKey}`,
      'content-type': blob.type,
    },
    body: blob,
  })
  if (response.status !== 200 && response.status !== 201) {
    throw new ServerError(response.status)
  }
}

export async function fetchAsset(
  boardId: string,
  hash: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<Blob | null> {
  const response = await fetchFn(`/api/boards/${boardId}/assets/${hash}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new ServerError(response.status)
  }
  return response.blob()
}

/**
 * Claims boards this browser holds edit keys for into the signed-in
 * account. A 401 (no session, or a deployment without accounts) reads
 * as "nothing adopted" rather than an error: the caller must not treat
 * a signed-out visitor as a failure.
 */
export async function requestAdoption(
  boards: { boardId: string; editKey: string }[],
  fetchFn: typeof fetch = fetch,
): Promise<{ adopted: string[]; skipped: string[] }> {
  const response = await fetchFn('/api/boards/adopt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boards }),
  })
  if (response.status === 401) {
    return { adopted: [], skipped: [] }
  }
  if (!response.ok) {
    throw new ServerError(response.status)
  }
  const body = (await response.json()) as {
    adopted: string[]
    skipped: string[]
  }
  return { adopted: body.adopted, skipped: body.skipped }
}

export function socketUrl(
  loc: { protocol: string; host: string } = location,
): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`
}
