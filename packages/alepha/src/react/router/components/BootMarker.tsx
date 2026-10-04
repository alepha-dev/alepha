import { useInject } from "alepha/react";
import { useEffect } from "react";

import {
  ReactBootHealth,
  type ReactBootOutcome,
} from "../services/ReactBootHealth.ts";

export interface BootMarkerProps {
  outcome: ReactBootOutcome;
}

/**
 * Reports the boot outcome from inside the committed screen.
 *
 * Placed beside the deepest layer of the first screen, so it commits only when
 * that layer does: a page that throws is replaced by its error boundary, marker
 * and all, and a page that suspends holds the marker back with it. An effect,
 * because an effect runs only after React has put the tree on the screen.
 *
 * ⚠️ A page that renders its own `<Suspense>` fallback has committed, and
 * counts: the page is on the screen and owns its loading state. What never
 * counts is the router's: it renders no fallback of its own, so a first
 * screen that suspends outside any boundary holds the marker back.
 */
const BootMarker = (props: BootMarkerProps) => {
  const health = useInject(ReactBootHealth);

  useEffect(() => {
    health.report(props.outcome);
  }, []);

  return null;
};

export default BootMarker;
