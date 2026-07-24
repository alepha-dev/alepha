import { useState } from "react";
import type { AnchorProps } from "../providers/ReactPageProvider.ts";
import { useRouter } from "./useRouter.ts";
import { useRouterState } from "./useRouterState.ts";

export interface UseActiveOptions {
  href: string;
  startWith?: boolean;
}

/**
 * Hook to determine if a given route is active and to provide anchor props for navigation.
 * This hook refreshes on router state changes.
 */
export const useActive = (args: string | UseActiveOptions): UseActiveHook => {
  useRouterState();

  const router = useRouter();
  const [isPending, setPending] = useState(false);

  const options: UseActiveOptions =
    typeof args === "string" ? { href: args } : { ...args, href: args.href };
  const href = options.href;
  const isActive = router.isActive(href, options);

  return {
    isPending,
    isActive,
    anchorProps: {
      href: router.base(href),
      onClick: async (ev?: any) => {
        if (!router.shouldHandleAnchorClick(ev)) {
          // Modified/aux click — the browser handles it (new tab, etc.).
          return;
        }
        ev?.stopPropagation();
        ev?.preventDefault();
        if (isActive) return;
        if (isPending) return;

        setPending(true);
        try {
          await router.push(href);
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
}
