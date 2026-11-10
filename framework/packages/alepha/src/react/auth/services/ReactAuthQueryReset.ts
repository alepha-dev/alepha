import { $hook, $inject, Alepha } from "alepha";
import { QueryCache } from "alepha/react";
import { currentUserAtom } from "alepha/security";

/**
 * Empties the query cache when the signed-in user changes inside the page.
 *
 * On the web a sign-out is a full navigation, which drops the cache with the
 * page. Where the user changes without one (a native shell signing out in
 * place, a cookie sign-in, a switch of account), the cache would otherwise
 * keep the previous user's reads in memory and on screen.
 *
 * - **The user becomes nobody** (a sign-out): every entry is dropped, and no
 *   mounted query refetches because of it. The page is being left, and each
 *   protected read would answer 401.
 * - **The user becomes somebody else** (a sign-in, a switch): every entry is
 *   dropped, and the mounted queries re-run under the new identity.
 *
 * There is no "public" mark: the whole cache goes. Browser only, and only
 * once the app is ready, so the user restored by hydration or by the boot's
 * session check counts as the first one, not as a change.
 */
export class ReactAuthQueryReset {
  protected readonly alepha = $inject(Alepha);
  protected readonly queryCache = $inject(QueryCache);

  protected readonly onUserChange = $hook({
    on: "state:mutated",
    handler: ({ key, value, prevValue }) => {
      if (
        key !== currentUserAtom.key ||
        !this.alepha.isBrowser() ||
        !this.alepha.isReady()
      ) {
        return;
      }
      const before = this.userId(prevValue);
      const after = this.userId(value);
      if (before === after) {
        return;
      }
      this.queryCache.clear({ refetch: after !== undefined });
    },
  });

  protected userId(user: unknown): string | undefined {
    if (!user || typeof user !== "object") {
      return undefined;
    }
    const id = (user as { id?: unknown }).id;
    return typeof id === "string" || typeof id === "number"
      ? String(id)
      : undefined;
  }
}
