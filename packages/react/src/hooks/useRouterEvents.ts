import type { Hooks } from "@alepha/core";
import { useEffect } from "react";
import { useAlepha } from "./useAlepha.ts";

type Hook<T extends keyof Hooks> =
	| ((ev: Hooks[T]) => void)
	| {
			priority?: "first" | "last";
			callback: (ev: Hooks[T]) => void;
	  };

/**
 * Subscribe to various router events.
 */
export const useRouterEvents = (
	opts: {
		onBegin?: Hook<"react:transition:begin">;
		onError?: Hook<"react:transition:error">;
		onEnd?: Hook<"react:transition:end">;
		onSuccess?: Hook<"react:transition:success">;
	} = {},
	deps: any[] = [],
) => {
	const alepha = useAlepha();

	useEffect(() => {
		if (!alepha.isBrowser()) {
			return;
		}

		const cb = <T extends keyof Hooks>(callback: Hook<T>) => {
			if (typeof callback === "function") {
				return { callback };
			}
			return callback;
		};

		const subs: Function[] = [];
		const onBegin = opts.onBegin;
		const onEnd = opts.onEnd;
		const onError = opts.onError;
		const onSuccess = opts.onSuccess;

		if (onBegin) {
			subs.push(alepha.events.on("react:transition:begin", cb(onBegin)));
		}

		if (onEnd) {
			subs.push(alepha.events.on("react:transition:end", cb(onEnd)));
		}

		if (onError) {
			subs.push(alepha.events.on("react:transition:error", cb(onError)));
		}

		if (onSuccess) {
			subs.push(alepha.events.on("react:transition:success", cb(onSuccess)));
		}

		return () => {
			for (const sub of subs) {
				sub();
			}
		};
	}, deps);
};
