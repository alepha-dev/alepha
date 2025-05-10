import { useContext, useEffect } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import type { RouterState } from "../providers/PageDescriptorProvider.ts";

export const useRouterEvents = (
	opts: {
		onBegin?: (ev: { state: RouterState }) => void;
		onEnd?: (ev: { state: RouterState }) => void;
		onError?: (ev: { state: RouterState; error: Error }) => void;
	} = {},
	deps: any[] = [],
) => {
	const ctx = useContext(RouterContext);
	if (!ctx) {
		throw new Error("useRouter must be used within a RouterProvider");
	}

	useEffect(() => {
		if (!ctx.alepha.isBrowser()) {
			return;
		}

		const subs: Function[] = [];
		const onBegin = opts.onBegin;
		const onEnd = opts.onEnd;
		const onError = opts.onError;

		if (onBegin) {
			subs.push(
				ctx.alepha.on("react:transition:begin", {
					callback: onBegin,
				}),
			);
		}

		if (onEnd) {
			subs.push(
				ctx.alepha.on("react:transition:end", {
					callback: onEnd,
				}),
			);
		}

		if (onError) {
			subs.push(
				ctx.alepha.on("react:transition:error", {
					callback: onError,
				}),
			);
		}

		return () => {
			for (const sub of subs) {
				sub();
			}
		};
	}, deps);
};
