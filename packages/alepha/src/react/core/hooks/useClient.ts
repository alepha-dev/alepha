import {
  type ClientScope,
  type HttpVirtualClient,
  LinkProvider,
} from "alepha/server/links";
import { useMemo } from "react";

import { useInject } from "./useInject.ts";

/**
 * Hook to get a virtual client for the specified scope.
 *
 * It's the React-hook version of `$client()`, from `AlephaServerLinks` module.
 */
export const useClient = <T extends object>(
  scope?: ClientScope,
): HttpVirtualClient<T> => {
  const linkProvider = useInject(LinkProvider);

  return useMemo(() => {
    return linkProvider.client<T>(scope);
  }, [scope]);
};
