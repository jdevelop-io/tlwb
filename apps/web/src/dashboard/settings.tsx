import { useEffect, useState } from 'react'
import type {
  createApiKey as defaultCreateApiKey,
  fetchUsage as defaultFetchUsage,
  openPortal as defaultOpenPortal,
  revokeApiKey as defaultRevokeApiKey,
} from './api'

export interface SettingsDeps {
  fetchUsage: typeof defaultFetchUsage
  createApiKey: typeof defaultCreateApiKey
  revokeApiKey: typeof defaultRevokeApiKey
  openPortal: typeof defaultOpenPortal
  deleteUser: () => Promise<unknown>
  navigate: (path: string) => void
}

export function Settings(props: {
  user: { name: string; email: string; plan: 'free' | 'pro' }
  billing: boolean
  deps: SettingsDeps
  onSignOut: () => void
}) {
  const { user, billing, deps } = props
  const [usage, setUsage] = useState<{
    month: string
    count: number
    limit: number
  } | null>(null)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    deps
      .fetchUsage()
      .then((result) => {
        if (!cancelled) {
          setUsage(result)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [deps])

  const generateKey = async (): Promise<void> => {
    setCopied(false)
    try {
      setApiKey(await deps.createApiKey())
    } catch {
      // The user can retry from the same button.
    }
  }

  const revokeKey = async (): Promise<void> => {
    setError(null)
    try {
      await deps.revokeApiKey()
      setApiKey(null)
    } catch {
      // The key is still live server-side: it must stay visible rather
      // than let the user believe a failed revocation actually worked,
      // a security-relevant distinction on this path.
      setError('Could not revoke the key, try again')
    }
  }

  const copyKey = async (): Promise<void> => {
    if (!apiKey || !navigator.clipboard) {
      return
    }
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
    } catch {
      // The key stays visible in the code block for a manual copy.
    }
  }

  const manageBilling = async (): Promise<void> => {
    setError(null)
    try {
      const url = await deps.openPortal()
      location.assign(url)
    } catch {
      setError('Could not open billing, try again')
    }
  }

  const deleteAccount = async (): Promise<void> => {
    if (
      !confirm(`Delete the account for ${user.email}? This cannot be undone.`)
    ) {
      return
    }
    if (
      !confirm('This will permanently delete every board you own. Continue?')
    ) {
      return
    }
    setError(null)
    try {
      await deps.deleteUser()
      deps.navigate('/')
    } catch {
      setError('Could not delete the account, try again')
    }
  }

  return (
    <section className="settings">
      <h2>Settings</h2>
      <button
        type="button"
        className="button-secondary"
        onClick={props.onSignOut}
      >
        Sign out
      </button>
      <p className="settings-plan">
        {user.plan === 'pro' ? 'Pro plan' : 'Free plan'}
        {billing && user.plan === 'pro' ? (
          <button type="button" onClick={() => void manageBilling()}>
            Manage billing
          </button>
        ) : null}
      </p>
      {error ? <p className="settings-error">{error}</p> : null}

      <div className="settings-api-key">
        <h3>MCP API key</h3>
        <div className="settings-api-key-actions">
          <button type="button" onClick={() => void generateKey()}>
            Generate key
          </button>
          <button type="button" onClick={() => void revokeKey()}>
            Revoke
          </button>
        </div>
        {apiKey ? (
          <div className="settings-api-key-reveal">
            <code>{apiKey}</code>
            <button type="button" onClick={() => void copyKey()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <p className="settings-warning">
              This key is shown once. Copy it now, it will not be shown again.
            </p>
          </div>
        ) : null}
        {usage ? (
          <p className="settings-usage">
            {usage.count} / {usage.limit} calls this month
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className="settings-delete-account"
        onClick={() => void deleteAccount()}
      >
        Delete account
      </button>
    </section>
  )
}
