import type { ReactRouterOverlay } from "../providers/ReactPageProvider.ts";
import { useRouter } from "./useRouter.ts";
import { useRouterState } from "./useRouterState.ts";

/**
 * The overlay on screen, and the way out of it.
 *
 * `close` goes back through history, so Forward reopens the overlay and the
 * page behind it is neither remounted nor scrolled.
 *
 * @example
 * ```tsx
 * const { close } = useOverlay();
 * return <Sheet open onOpenChange={(open) => !open && close()} />;
 * ```
 */
export const useOverlay = (): UseOverlayReturn => {
  const state = useRouterState();
  const router = useRouter();

  return {
    overlay: state.overlay,
    close: () => {
      void router.back();
    },
  };
};

export interface UseOverlayReturn {
  /**
   * The overlay on screen, absent when the page renders as a full page.
   */
  overlay?: ReactRouterOverlay;
  close: () => void;
}
