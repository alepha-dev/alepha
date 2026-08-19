import { AlephaError } from "alepha";
import { useStore } from "alepha/react";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";

/**
 * Subscribes to the router's live state - the matched route, its params and
 * query, and the pending-transition flag. Re-renders on every navigation.
 * Throws outside a router context.
 */
export const useRouterState = (): ReactRouterState => {
  const [state] = useStore("alepha.react.router.state");
  if (!state) {
    throw new AlephaError("Missing react router state");
  }
  return state;
};
