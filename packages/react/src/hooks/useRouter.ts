import { useContext, useMemo } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import { PageDescriptorProvider } from "../providers/PageDescriptorProvider.ts";
import { ReactBrowserProvider } from "../providers/ReactBrowserProvider.ts";
import { RouterHookApi } from "./RouterHookApi.ts";

export const useRouter = (): RouterHookApi => {
	const ctx = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	if (!ctx || !layer) {
		throw new Error("useRouter must be used within a RouterProvider");
	}

	const pages = useMemo(() => {
		return ctx.alepha.inject(PageDescriptorProvider).getPages();
	}, []);

	return useMemo(
		() =>
			new RouterHookApi(
				pages,
				ctx.context,
				ctx.state,
				layer,
				ctx.alepha.isBrowser()
					? ctx.alepha.inject(ReactBrowserProvider)
					: undefined,
			),
		[layer],
	);
};
