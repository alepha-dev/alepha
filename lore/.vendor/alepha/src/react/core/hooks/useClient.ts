import {
  type ClientScope,
  type HttpVirtualClient,
  LinkProvider,
  type RemoteVirtualClient,
} from "alepha/server/links";
import { useMemo } from "react";

import { useInject } from "./useInject.ts";

// Overloads rather than a conditional return type: callers write
// `useClient<Controller>()` with the controller given explicitly, and
// TypeScript has no partial type-argument inference, so a scope type
// parameter would fall back to its default instead of being inferred.
export interface UseClient {
  <T extends object>(
    scope: ClientScope & { hostname: string },
  ): RemoteVirtualClient<T>;
  <T extends object>(scope?: ClientScope): HttpVirtualClient<T>;
}

/**
 * Hook to get a virtual client for the specified scope.
 *
 * It's the React-hook version of `$client()`, from `AlephaServerLinks` module.
 *
 * A `hostname` on the scope reaches a remote Alepha app instead of this one,
 * resolving against that app's own registry. Such a client offers actions
 * only: a remote `$sse` would leave as a plain fetch, which answers with a
 * response rather than a stream, so it is not offered.
 */
export const useClient: UseClient = <T extends object>(
  scope?: ClientScope,
): HttpVirtualClient<T> => {
  const linkProvider = useInject(LinkProvider);

  return useMemo(() => {
    return linkProvider.client<T>(scope);
  }, [scope]);
};
