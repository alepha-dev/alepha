import { useContext, useMemo } from "react";
import { RouterContext } from "../contexts/RouterContext";
import { RouterLayerContext } from "../contexts/RouterLayerContext";
import { ReactBrowserProvider } from "../providers/ReactBrowserProvider";
import { RouterHookApi } from "./RouterHookApi";

/**
 *
 */
export const useRouter = (): RouterHookApi => {
	const ctx = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	if (!ctx || !layer) {
		throw new Error("useRouter must be used within a RouterProvider");
	}

	return useMemo(
		() =>
			new RouterHookApi(
				ctx.state,
				layer,
				ctx.alepha.isBrowser()
					? ctx.alepha.get(ReactBrowserProvider)
					: undefined,
			),
		[ctx.router, layer],
	);
};
