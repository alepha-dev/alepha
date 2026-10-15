import {
  type PropsWithChildren,
  type ReactNode,
  useSyncExternalStore,
} from "react";

import { personalRenderedAtom } from "../atoms/personalRenderedAtom.ts";
import { useAlepha } from "../hooks/useAlepha.ts";

export interface PersonalProps {
  /**
   * What the shared page shows in place of the personal part: what a
   * cached copy holds, and what every visitor sees until hydration. Keep it
   * the size of the real thing, so the swap moves nothing.
   */
  fallback?: ReactNode;
}

/**
 * The personal part of a page that is otherwise the same for everyone: a
 * user menu, a greeting, a cart badge read from the session.
 *
 * Alepha caches a page for every visitor when its render reads nothing
 * personal (#E78). One user menu in the layout would otherwise make every
 * page personal; wrapped in `<Personal>`, it does not.
 *
 * - **On the server**, in a render that may be shared, `<Personal>` renders
 *   `fallback`: its children do not run, so what they read does not count
 *   against the page. In a page already personal (a `$secure` page, a page
 *   that read the user before reaching it), it renders its children, since
 *   that page is never shared anyway.
 * - **In the browser**, the hydration pass renders what the server rendered,
 *   so there is no mismatch, and the children take over on the next commit,
 *   from the visitor's state already in the page (the private hydration
 *   script). No request is made.
 *
 * Forgetting it costs speed, never data: the read tracker rules a page that
 * reads the user personal and does not cache it.
 *
 * @example
 * ```tsx
 * <Personal fallback={<SignInButton />}>
 *   <UserMenu />
 * </Personal>
 * ```
 */
const Personal = (props: PropsWithChildren<PersonalProps>) => {
  const alepha = useAlepha();
  // Read in the browser only, both snapshots: on the server this atom is
  // personal, and reading it would make the very page it guards personal.
  const read = () =>
    alepha.isBrowser() ? alepha.store.get(personalRenderedAtom) : false;
  const renderedOnServer = useSyncExternalStore(() => () => {}, read, read);
  // `false` for the server render and the hydration pass, then `true`.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (alepha.isBrowser()) {
    return hydrated || renderedOnServer ? props.children : props.fallback;
  }

  // Server. Only a render the page cache may share keeps the children out;
  // with no recorder (a prerender, a test render) the page can still reach
  // several visitors, so it keeps them out too.
  const recorder = alepha.store.recorder();
  if (recorder?.verdict() === "personal") {
    alepha.store.set(personalRenderedAtom, true);
    return props.children;
  }
  return props.fallback;
};

export default Personal;
