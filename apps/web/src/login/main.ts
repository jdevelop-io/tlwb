import { authClient } from '../auth/client'
import { resolveCallbackURL } from './callback-url'
import './login.css'

const callbackURL = resolveCallbackURL(
  new URLSearchParams(location.search).get('from'),
)

// The OAuth return lands on /dashboard, which runs adoption on load.
document.getElementById('github')?.addEventListener('click', () => {
  void authClient.signIn.social({ provider: 'github', callbackURL })
})
document.getElementById('google')?.addEventListener('click', () => {
  void authClient.signIn.social({ provider: 'google', callbackURL })
})
