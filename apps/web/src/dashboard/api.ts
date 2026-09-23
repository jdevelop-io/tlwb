import { ServerError } from '../board/session/server'

export interface DashboardBoard {
  id: string
  name: string
  updatedAt: string
  shared: boolean
  agent: boolean
}

export interface MeResponse {
  user: {
    name: string
    email: string
    image: string | null
    plan: 'free' | 'pro'
  }
  billing: boolean
}

/** null on 401: signed out, or a deployment without accounts. */
export async function fetchMe(
  fetchFn: typeof fetch = fetch,
): Promise<MeResponse | null> {
  const response = await fetchFn('/api/me')
  if (response.status === 401) {
    return null
  }
  if (!response.ok) {
    throw new ServerError(response.status)
  }
  return (await response.json()) as MeResponse
}

export async function fetchBoards(
  fetchFn: typeof fetch = fetch,
): Promise<{ boards: DashboardBoard[]; cap: number | null }> {
  const response = await fetchFn('/api/me/boards')
  if (!response.ok) {
    throw new ServerError(response.status)
  }
  return (await response.json()) as {
    boards: DashboardBoard[]
    cap: number | null
  }
}

export async function deleteBoard(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchFn(`/api/boards/${id}`, { method: 'DELETE' })
  if (response.status !== 204) {
    throw new ServerError(response.status)
  }
}

export async function createApiKey(
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchFn('/api/me/api-key', { method: 'POST' })
  if (response.status !== 201) {
    throw new ServerError(response.status)
  }
  const body = (await response.json()) as { key: string }
  return body.key
}

export async function revokeApiKey(
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchFn('/api/me/api-key', { method: 'DELETE' })
  if (response.status !== 204) {
    throw new ServerError(response.status)
  }
}

export async function startCheckout(
  interval: 'month' | 'year',
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchFn('/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interval }),
  })
  if (!response.ok) {
    throw new ServerError(response.status)
  }
  const body = (await response.json()) as { url: string }
  return body.url
}

export async function openPortal(
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchFn('/api/billing/portal', { method: 'POST' })
  if (!response.ok) {
    throw new ServerError(response.status)
  }
  const body = (await response.json()) as { url: string }
  return body.url
}
