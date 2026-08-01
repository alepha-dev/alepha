import { useStore } from "alepha/react";
import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import { sigilAnyGlobMatch } from "../../shared/sigilGlobMatch.ts";
import { useCurrentPath } from "../useCurrentPath.ts";
import { usePetitionUrl } from "../usePetitionUrl.ts";
import { SigilFeedbackButton } from "./SigilFeedbackButton.tsx";

/**
 * Root Sigil component.
 *
 * Renders the floating feedback button — but only when the sink hands out a
 * petition URL (via {@link usePetitionUrl}) and the current pathname isn't
 * excluded. The exclusion list comes from {@link sigilClientAtom}, the
 * SSR-hydrated public config, so there is no runtime fetch. The path check
 * re-evaluates on SPA navigation via {@link useCurrentPath}.
 *
 * This is the batteries-included default: a host app that would rather render
 * its own link can skip this component entirely and call
 * {@link usePetitionUrl} directly.
 */
export const SigilRoot = () => {
  const petitionUrl = usePetitionUrl();
  const [config] = useStore(sigilClientAtom);
  const path = useCurrentPath();

  if (!petitionUrl) {
    return null;
  }

  if (sigilAnyGlobMatch(path, config.excludedPaths)) {
    return null;
  }

  return <SigilFeedbackButton petitionUrl={petitionUrl} />;
};
