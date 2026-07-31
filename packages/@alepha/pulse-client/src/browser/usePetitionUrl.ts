import { useStore } from "alepha/react";
import { pulseClientAtom } from "../shared/pulseClientAtom.ts";

/**
 * Where a user goes to file a petition, or `undefined` when the sink offers
 * none.
 *
 * Headless on purpose. This package used to mount a floating button and a
 * screenshot dialog into every host app's React tree — which meant a telemetry
 * package owned a piece of UI it then had to style, translate, make accessible
 * and keep out of the way of the app's own layout, all for one link.
 *
 * The app renders it wherever it belongs:
 *
 * ```tsx
 * const petition = usePetitionUrl();
 * return petition ? <a href={petition}>Signaler un problème</a> : null;
 * ```
 *
 * Returns `undefined` rather than a fallback URL: a link to a petition form
 * that does not exist is worse than no link.
 */
export const usePetitionUrl = (): string | undefined => {
  const [config] = useStore(pulseClientAtom);
  return config.petitionUrl || undefined;
};
