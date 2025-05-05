import { useContext, useEffect } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import type { RouterState } from "../services/ReactRouter.ts";

export const useRouterEvents = (
	opts: {
		onBegin?: () => void;
		onEnd?: (it: RouterState) => void;
		onError?: (it: Error) => void;
	} = {},
) => {
	const ctx = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	if (!ctx || !layer) {
		throw new Error("useRouter must be used within a RouterProvider");
	}

	useEffect(() => {
		const subs: Function[] = [];
		const onBegin = opts.onBegin;
		const onEnd = opts.onEnd;
		const onError = opts.onError;

		if (onBegin) {
			subs.push(ctx.router.on("begin", onBegin));
		}

		if (onEnd) {
			subs.push(ctx.router.on("end", onEnd));
		}

		if (onError) {
			subs.push(ctx.router.on("error", onError));
		}

		return () => {
			for (const sub of subs) {
				sub();
			}
		};
	}, []);
};
