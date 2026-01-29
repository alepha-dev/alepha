import { AlephaError } from "alepha";
import { useStore } from "alepha/react";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";

export const useRouterState = (): ReactRouterState => {
  const [state] = useStore("alepha.react.router.state");
  if (!state) {
    throw new AlephaError("Missing react router state");
  }
  return state;
};
