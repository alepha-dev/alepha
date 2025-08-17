import { useEffect } from "react";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";
import { useAlepha } from "./useAlepha.ts";

/**
 * Subscribe to various router events.
 */
export const useRouterEvents = (
	opts: {
		onBegin?: (ev: { state: ReactRouterState }) => void;
		onEnd?: (ev: { state: ReactRouterState }) => void;
		onError?: (ev: { state: ReactRouterState; error: Error }) => void;
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
