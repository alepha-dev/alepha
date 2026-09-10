/**
 * The server-rendered pages of `alepha/api/oauth` a sign-in may return to.
 *
 * Both send a signed-out visitor to the login page with `?redirect_uri=`, and
 * neither is reachable by the SPA push `AuthLogin` makes after sign-in, which
 * is why the login loader and `/oauth/continue` exist. They share this list so
 * the two cannot disagree about it: the device page (#Q2217) was the second
 * entry, and the bridge accepting only the first dropped every device approval
 * on the home page.
 */
export const OAUTH_RETURN_PATHS = ["/oauth/authorize", "/oauth/device"];

/**
 * Whether `to` is one of those pages, on this origin.
 *
 * The exact path, or the path and a query - never a prefix match, and never
 * anything that parses to another origin. This is what closes the bridge's
 * open-redirect surface.
 */
export const isOAuthReturnTarget = (to: unknown): to is string =>
  typeof to === "string" &&
  OAUTH_RETURN_PATHS.some((path) => to === path || to.startsWith(`${path}?`));
