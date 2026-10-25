import { useInject } from "alepha/react";
import { type ReactNode, useEffect } from "react";

import {
  ReactBootHealth,
  type ReactBootOutcome,
} from "../services/ReactBootHealth.ts";

export interface BootMarkerProps {
  outcome: ReactBootOutcome;
  children?: ReactNode;
}

/**
 * Reports the boot outcome from inside the committed screen.
 *
 * Wraps the deepest layer of the first screen, so it commits only when that
 * layer does: a page that throws is replaced by its error boundary, marker
 * and all, and a page that suspends holds the marker back with it. An effect,
 * because an effect runs only after React has put the tree on the screen.
 *
 * ⚠️ A wrapper, never a sibling. The server renders the layer alone, and
 * `useId` derives its ids from the shape of the tree: a `[layer, marker]` pair
 * made the layer the first of two children in the browser only, so every id
 * under it differed from the server's and hydration warned on each `id` and
 * `htmlFor`. A single child that calls no `useId` leaves them where they were.
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

  return props.children;
};

export default BootMarker;
