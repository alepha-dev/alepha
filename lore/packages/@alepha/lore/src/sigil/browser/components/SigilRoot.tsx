import { useStore } from "alepha/react";

import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import {
  SIGIL_FEEDBACK_HIDDEN,
  sigilFeedbackPositionOf,
} from "../../shared/sigilFeedbackPosition.ts";
import { sigilAnyGlobMatch } from "../../shared/sigilGlobMatch.ts";
import { useCurrentPath } from "../useCurrentPath.ts";
import { useFeedbackUrl } from "../useFeedbackUrl.ts";
import { SigilFeedbackButton } from "./SigilFeedbackButton.tsx";

/**
 * Root Sigil component.
 *
 * Renders the floating feedback button — but only when the sink hands out a
 * feedback URL (via {@link useFeedbackUrl}) and the current pathname isn't
 * excluded. The exclusion list comes from {@link sigilClientAtom}, the
 * SSR-hydrated public config, so there is no runtime fetch. The path check
 * re-evaluates on SPA navigation via {@link useCurrentPath}.
 *
 * This is the batteries-included default: a host app that would rather render
 * its own link can skip this component entirely and call
 * {@link useFeedbackUrl} directly.
 */
export const SigilRoot = () => {
  const feedbackUrl = useFeedbackUrl();
  const [config] = useStore(sigilClientAtom);
  const path = useCurrentPath();

  if (!feedbackUrl) {
    return null;
  }

  // The one position that is not a position. `sigilFeedbackPositionOf` cannot
  // express it - it narrows to a corner and falls back to the default, so
  // asking it about "hidden" answers "bottom-right" - which is exactly how this
  // shipped: the config accepted the value, the docs described it as the way to
  // keep the URL without the control, and the button rendered anyway.
  if (config.feedbackButton === SIGIL_FEEDBACK_HIDDEN) {
    return null;
  }

  if (sigilAnyGlobMatch(path, config.feedbackButtonExcludedPaths)) {
    return null;
  }

  return (
    <SigilFeedbackButton
      feedbackUrl={feedbackUrl}
      position={sigilFeedbackPositionOf(config.feedbackButton)}
    />
  );
};
