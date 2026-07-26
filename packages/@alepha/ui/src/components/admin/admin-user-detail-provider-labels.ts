/**
 * Display names for identity providers.
 *
 * Shared between the security tab (which lists connections) and the
 * remove-connection confirmation in the page shell, so both name a provider
 * the same way.
 */
export const PROVIDER_LABELS: Record<string, string> = {
  credentials: "Password",
  google: "Google",
  apple: "Apple",
  github: "GitHub",
  microsoft: "Microsoft",
  facebook: "Facebook",
};
