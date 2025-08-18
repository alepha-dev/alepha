import { useState } from "react";
import type { AnchorProps } from "../providers/ReactPageProvider.ts";
import { useRouter } from "./useRouter.ts";
import { useRouterEvents } from "./useRouterEvents.ts";

export const useActive = (href: string): UseActiveHook => {
	const router = useRouter();
	const [isPending, setPending] = useState(false);
	const [current, setCurrent] = useState(router.state.url.pathname);

	// TODO: loose [default] or strict
	// TODO: startWith: true (e.g. /p/1 should match /p/1/2)
	const isActive =
		current === href || current === `${href}/` || `${current}/` === href;

	useRouterEvents(
		{
			onEnd: ({ state }) => {
				setCurrent(state.url.pathname);
			},
		},
		[href],
	);

	return {
		isPending,
		isActive,
		anchorProps: {
			href: router.base(href),
			onClick: async (ev?: any) => {
				ev?.stopPropagation();
				ev?.preventDefault();
				if (isActive) return;
				if (isPending) return;

				setPending(true);
				try {
					await router.go(href);
				} finally {
					setPending(false);
				}
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
