/**
 * Display names for identity providers.
 *
 * Shared between the security tab (which lists connections) and the
 * remove-connection confirmation in the page shell, so both name a provider
 * the same way.
 */
export const PROVIDER_LABELS: Record<string, string> = {
  credentials: "Password",
  // Not a way to sign in, but it is stored as an identity row, so it shows
  // up in the same lists. Naming it here is what lets an administrator
  // recognise (and clear) the second factor of a locked-out user.
  totp: "Authenticator app",
  google: "Google",
  apple: "Apple",
  github: "GitHub",
  microsoft: "Microsoft",
  facebook: "Facebook",
};
