import { useContext, useMemo, useState } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import type { AnchorProps } from "../providers/PageDescriptorProvider.ts";
import type { HrefLike } from "./RouterHookApi.ts";
import { useRouter } from "./useRouter.ts";
import { useRouterEvents } from "./useRouterEvents.ts";

export const useActive = (path?: HrefLike): UseActiveHook => {
	const router = useRouter();
	const ctx = useContext(RouterContext);
	const layer = useContext(RouterLayerContext);
	if (!ctx || !layer) {
		throw new Error("useRouter must be used within a RouterProvider");
	}

	const [current, setCurrent] = useState(ctx.state.pathname);
	const href = useMemo(
		() => router.createHref(path ?? "", layer),
		[path, layer],
	);

	const [isPending, setPending] = useState(false);

	// TODO: loose [default] or strict
	// TODO: startWith: true (e.g. /p/1 should match /p/1/2)
	const isActive =
		current === href || current === `${href}/` || `${current}/` === href;

	useRouterEvents(
		{
			onEnd: ({ state }) => {
				path ? setCurrent(state.pathname) : undefined;
			},
		},
		[path],
	);

	return {
		isPending,
		isActive,
		anchorProps: {
			href,
			onClick: (ev?: any) => {
				ev?.stopPropagation();
				ev?.preventDefault();
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
