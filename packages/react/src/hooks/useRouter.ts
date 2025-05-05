import { useContext, useMemo } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import { ReactBrowserProvider } from "../providers/ReactBrowserProvider.ts";
import { RouterHookApi } from "./RouterHookApi.ts";

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
		[layer],
	);
};
