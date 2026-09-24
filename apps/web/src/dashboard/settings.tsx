import { useState } from 'react'
import type {
  openPortal as defaultOpenPortal,
  startCheckout as defaultStartCheckout,
} from './api'

export interface SettingsDeps {
  startCheckout: typeof defaultStartCheckout
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
  const [error, setError] = useState<string | null>(null)

  const go = async (
    action: () => Promise<string>,
    failure: string,
  ): Promise<void> => {
    setError(null)
    try {
      location.assign(await action())
    } catch {
      setError(failure)
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
    <>
      <header className="main-header">
        <h1>Settings</h1>
      </header>
      {error ? <p className="error">{error}</p> : null}
      <section className="settings-card">
        <h2>Account</h2>
        <p className="settings-line">{user.name}</p>
        <p className="caption">{user.email}</p>
        <button
          type="button"
          className="button-secondary"
          onClick={props.onSignOut}
        >
          Sign out
        </button>
      </section>
      <section className="settings-card">
        <h2>Plan</h2>
        <p className="settings-line">
          {user.plan === 'pro' ? 'Pro plan' : 'Free plan'}
        </p>
        {billing && user.plan === 'free' ? (
          <div className="settings-actions">
            <button
              type="button"
              className="button-primary"
              onClick={() =>
                void go(
                  () => deps.startCheckout('month'),
                  'Could not start checkout, try again',
                )
              }
            >
              Upgrade monthly
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() =>
                void go(
                  () => deps.startCheckout('year'),
                  'Could not start checkout, try again',
                )
              }
            >
              Upgrade yearly
            </button>
          </div>
        ) : null}
        {billing && user.plan === 'pro' ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              void go(deps.openPortal, 'Could not open billing, try again')
            }
          >
            Manage billing
          </button>
        ) : null}
      </section>
      <section className="settings-card">
        <h2>Danger zone</h2>
        <button
          type="button"
          className="button-secondary button-danger"
          onClick={() => void deleteAccount()}
        >
          Delete account
        </button>
      </section>
    </>
  )
}
