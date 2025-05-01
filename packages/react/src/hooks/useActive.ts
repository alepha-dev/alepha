import { useContext, useEffect, useMemo, useState } from "react";
import { RouterContext } from "../contexts/RouterContext";
import { RouterLayerContext } from "../contexts/RouterLayerContext";
import type { AnchorProps } from "../services/Router";
import type { HrefLike } from "./RouterHookApi";
import { useRouter } from "./useRouter";

export const useActive = (path: HrefLike): UseActiveHook => {
	const router = useRouter();
	const ctx = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	if (!ctx || !layer) {
		throw new Error("useRouter must be used within a RouterProvider");
	}

	let name: string | undefined;
	if (typeof path === "object" && path.options.name) {
		name = path.options.name;
	}

	const [current, setCurrent] = useState(ctx.state.pathname);
	const href = useMemo(() => router.createHref(path, layer), [path, layer]);
	const [isPending, setPending] = useState(false);
	const isActive = current === href;

	useEffect(
		() => ctx.router.on("end", ({ pathname }) => setCurrent(pathname)),
		[],
	);

	return {
		name,
		isPending,
		isActive,
		anchorProps: {
			href,
			onClick: (ev: any) => {
				ev.stopPropagation();
				ev.preventDefault();
				if (isActive) return;
				if (isPending) return;

				setPending(true);
				router.go(href).then(() => {
					setPending(false);
				});
			},
		},
	};
};

export interface UseActiveHook {
	isActive: boolean;
	anchorProps: AnchorProps;
	isPending: boolean;
	name?: string;
}
