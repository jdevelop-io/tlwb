/**
 * The OAuth return target, taken from the fully attacker-controlled
 * `from` query parameter. Only a same-document path is accepted, so
 * this can never send a signed-in visitor's session off-site through
 * Better Auth's `callbackURL`, a protection that must not rest solely
 * on `trustedOrigins` (unset whenever `CORS_ORIGIN` is `*`). A leading
 * `//` is rejected too: a browser resolves `//evil.example` as
 * protocol-relative, an absolute URL wearing a path's clothes.
 */
export function resolveCallbackURL(raw: string | null): string {
  if (raw?.startsWith('/') && !raw.startsWith('//')) {
    return raw
  }
  return '/dashboard'
}
