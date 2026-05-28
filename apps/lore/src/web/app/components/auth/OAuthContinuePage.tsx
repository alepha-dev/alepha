import { useEffect } from "react";

/**
 * Transient bridge page for the OAuth 2.1 authorization flow.
 *
 * The Alepha OAuth `authorize` endpoint sends unauthenticated users to the
 * login page; after sign-in `AuthLogin` SPA-pushes to the `?r=` target. A
 * server-rendered route like `/oauth/authorize` cannot be reached by an SPA
 * push, so the login flow points `?r=` here instead. This page performs a
 * hard navigation back into the authorize endpoint, which now sees the
 * freshly-set session cookie and renders the consent screen.
 *
 * `to` is validated to be an internal `/oauth/authorize` path — anything
 * else falls back to the home page, closing the open-redirect surface.
 */
const OAuthContinuePage = () => {
  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get("to");
    window.location.replace(to?.startsWith("/oauth/authorize") ? to : "/");
  }, []);

  return null;
};

export default OAuthContinuePage;
