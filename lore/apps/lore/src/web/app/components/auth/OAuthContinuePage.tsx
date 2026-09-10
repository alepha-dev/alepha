import { useRouter } from "alepha/react/router";
import { useEffect } from "react";

import { isOAuthReturnTarget } from "./oauthReturnTarget.ts";

/**
 * Transient bridge page for the OAuth 2.1 authorization flow.
 *
 * The Alepha OAuth `authorize` endpoint and its device approval page send
 * unauthenticated users to the login page; after sign-in `AuthLogin`
 * SPA-pushes to the `?r=` target. A server-rendered route like
 * `/oauth/authorize` cannot be reached by an SPA push, so the login flow
 * points `?r=` here instead. This page performs a hard navigation back into
 * the server route, which now sees the freshly-set session cookie.
 *
 * `to` is validated to be one of those server routes (`isOAuthReturnTarget`)
 * — anything else falls back to the home page, closing the open-redirect
 * surface.
 *
 * ⚠️ `to` is read from the ROUTER's state, never from `window.location`. A
 * push renders the new page before it writes history, so on arrival from the
 * login form this effect ran while the address bar still held the login
 * page's query: no `to`, and every sign-in went home. Invisible until #Q2217,
 * because the login loader's bridge had never once sent anybody here.
 */
const OAuthContinuePage = () => {
  const router = useRouter();

  useEffect(() => {
    const to = router.query.to;
    window.location.replace(isOAuthReturnTarget(to) ? to : "/");
  }, []);

  return null;
};

export default OAuthContinuePage;
