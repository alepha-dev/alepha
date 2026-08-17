import { useStore } from "alepha/react";
import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import { sigilFeedbackPositionOf } from "../../shared/sigilFeedbackPosition.ts";
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
