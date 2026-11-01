import { ErrorBoundary, useAlepha } from "alepha/react";
import { memo } from "react";

import { useRouterState } from "../hooks/useRouterState.ts";
import ErrorViewer from "./ErrorViewer.tsx";

export interface OverlayViewProps {
  index: number;
}

/**
 * Renders the committed state's overlay in the slot it would have held as a
 * full page, beside the view that is there.
 *
 * Under the overlay's parents, because their layouts hold what it needs: a
 * root view has no dialog provider, no tooltip provider, no shell context.
 * Beside the view rather than in place of it, so the background stays mounted.
 */
const OverlayView = (props: OverlayViewProps) => {
  const state = useRouterState();
  const alepha = useAlepha();
  const overlay = state.overlay;

  if (overlay?.layers.length !== props.index + 1) {
    return null;
  }

  return (
    <ErrorBoundary
      fallback={(error: Error) => <ErrorViewer error={error} alepha={alepha} />}
      resetKeys={[overlay.url.pathname]}
    >
      {overlay.layers[props.index].element}
    </ErrorBoundary>
  );
};

export default memo(OverlayView);
