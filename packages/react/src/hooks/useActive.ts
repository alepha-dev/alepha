import { useState } from "react";
import type { AnchorProps } from "../providers/ReactPageProvider.ts";
import { useRouter } from "./useRouter.ts";
import { useRouterState } from "./useRouterState.ts";

export interface UseActiveOptions {
	href: string;
	startWith?: boolean;
}

export const useActive = (args: string | UseActiveOptions): UseActiveHook => {
	const router = useRouter();
	const [isPending, setPending] = useState(false);
	const state = useRouterState();
	const current = state.url.pathname;

	const options: UseActiveOptions =
		typeof args === "string" ? { href: args } : { ...args, href: args.href };
	const href = options.href;

	let isActive =
		current === href || current === `${href}/` || `${current}/` === href;

	if (options.startWith && !isActive) {
		isActive = current.startsWith(href);
	}

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
