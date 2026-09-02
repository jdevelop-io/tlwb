import { createHmac } from 'node:crypto'

/**
 * Builds a `Cookie` header value Better Auth 1.7.2 accepts as a signed
 * `better-auth.session_token` cookie.
 *
 * Verified empirically against `auth.api.getSession`: the signature is
 * a standard (padded) base64 HMAC-SHA256 of the token, not base64url
 * as `better-call`'s `getSignedCookie` (which Better Auth's session
 * route calls) requires the signature to be exactly 44 characters and
 * end in `=`, a shape only padded base64 of a 32-byte digest has.
 */
export function sessionCookie(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
}
