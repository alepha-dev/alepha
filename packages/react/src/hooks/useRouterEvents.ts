import { useEffect } from "react";
import type { RouterState } from "../providers/PageDescriptorProvider.ts";
import { useAlepha } from "./useAlepha.ts";

export const useRouterEvents = (
	opts: {
		onBegin?: (ev: { state: RouterState }) => void;
		onEnd?: (ev: { state: RouterState }) => void;
		onError?: (ev: { state: RouterState; error: Error }) => void;
	} = {},
	deps: any[] = [],
) => {
	const alepha = useAlepha();

	useEffect(() => {
		if (!alepha.isBrowser()) {
			return;
		}

		const subs: Function[] = [];
		const onBegin = opts.onBegin;
		const onEnd = opts.onEnd;
		const onError = opts.onError;

		if (onBegin) {
			subs.push(
				alepha.on("react:transition:begin", {
					callback: onBegin,
				}),
			);
		}

		if (onEnd) {
			subs.push(
				alepha.on("react:transition:end", {
					callback: onEnd,
				}),
			);
		}

		if (onError) {
			subs.push(
				alepha.on("react:transition:error", {
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
