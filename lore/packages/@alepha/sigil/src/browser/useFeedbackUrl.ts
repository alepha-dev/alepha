import { useStore } from "alepha/react";

import { sigilClientAtom } from "../shared/sigilClientAtom.ts";

/**
 * Where a user goes to file feedback, or `undefined` when the sink offers
 * none.
 *
 * Headless on purpose. This package used to mount a floating button and a
 * screenshot dialog into every host app's React tree — which meant a reporting
 * package owned a piece of UI it then had to style, translate, make accessible
 * and keep out of the way of the app's own layout, all for one link.
 *
 * The app renders it wherever it belongs:
 *
 * ```tsx
 * const feedback = useFeedbackUrl();
 * return feedback ? <a href={feedback}>Signaler un problème</a> : null;
 * ```
 *
 * Returns `undefined` rather than a fallback URL: a link to a feedback form
 * that does not exist is worse than no link.
 */
export const useFeedbackUrl = (): string | undefined => {
  const [config] = useStore(sigilClientAtom);
  return config.feedbackUrl || undefined;
};
