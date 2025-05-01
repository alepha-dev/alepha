import { useContext, useEffect, useState } from "react";
import { RouterContext } from "../contexts/RouterContext";
import { RouterLayerContext } from "../contexts/RouterLayerContext";
import type { RouterState } from "../services/Router";

export const useRouterState = (): RouterState => {
	const ctx = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	if (!ctx || !layer) {
		throw new Error("useRouter must be used within a RouterProvider");
	}

	const [state, setState] = useState(ctx.state);
	useEffect(
		() =>
			ctx.router.on("end", (it) => {
				setState({ ...it });
			}),
		[],
	);

	return state;
};
