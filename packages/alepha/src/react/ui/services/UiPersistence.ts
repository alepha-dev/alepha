import { $cookie } from "alepha/server/cookies";
import { uiAtom } from "../atoms/uiAtom.ts";

/**
 * Binds the {@link uiAtom} to an `alepha-ui` cookie.
 *
 * Reading flow: on app boot the cookie is parsed and pushed into the atom
 * (via the `key` option on `$cookie`). Writing flow: every time the atom
 * mutates, the cookie is rewritten — which means a single `useStore(uiAtom)`
 * call is enough to persist UI preferences across reloads.
 *
 * Persists for 365 days; SameSite=lax so it travels on top-level navigation
 * but not on cross-origin requests.
 */
export class UiPersistence {
  ui = $cookie({
    name: "alepha-ui",
    key: uiAtom.key,
    schema: uiAtom.schema,
    ttl: [365, "days"],
    sameSite: "lax",
  });
}
