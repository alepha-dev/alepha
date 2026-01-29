import {
  type ClientScope,
  type HttpVirtualClient,
  LinkProvider,
} from "alepha/server/links";
import { useInject } from "./useInject.ts";

/**
 * Hook to get a virtual client for the specified scope.
 *
 * It's the React-hook version of `$client()`, from `AlephaServerLinks` module.
 */
export const useClient = <T extends object>(
  scope?: ClientScope,
): HttpVirtualClient<T> => {
  return useInject(LinkProvider).client<T>(scope);
};
