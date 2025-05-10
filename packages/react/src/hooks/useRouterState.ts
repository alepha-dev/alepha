import { useContext, useState } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import type { RouterState } from "../providers/PageDescriptorProvider.ts";
import { useRouterEvents } from "./useRouterEvents.ts";

export const useRouterState = (): RouterState => {
	const ctx = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	if (!ctx || !layer) {
		throw new Error("useRouter must be used within a RouterProvider");
	}

	const [state, setState] = useState(ctx.state);

	useRouterEvents({
		onEnd: ({ state }) => setState({ ...state }),
	});

	return state;
};
