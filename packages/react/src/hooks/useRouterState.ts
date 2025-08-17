import { AlephaError } from "@alepha/core";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";
import { useStore } from "./useStore.ts";

export const useRouterState = (): ReactRouterState => {
	const [state] = useStore("react.router.state");
	if (!state) {
		throw new AlephaError("Missing react router state");
	}
	return state;
};
