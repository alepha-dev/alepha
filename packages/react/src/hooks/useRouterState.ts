import { useContext, useState } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import type { RouterState } from "../providers/PageDescriptorProvider.ts";
import { useRouterEvents } from "./useRouterEvents.ts";

export const useRouterState = (): RouterState => {
	const router = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	if (!router || !layer) {
		throw new Error(
			"useRouterState must be used within a RouterContext.Provider",
		);
	}

	const [state, setState] = useState(router.state);

	useRouterEvents({
		onEnd: ({ state }) => setState({ ...state }),
	});

	return state;
};
