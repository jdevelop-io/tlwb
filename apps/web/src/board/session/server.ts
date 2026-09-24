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

export function socketUrl(
  loc: { protocol: string; host: string } = location,
): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`
}
