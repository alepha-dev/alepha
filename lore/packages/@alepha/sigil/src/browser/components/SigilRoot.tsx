import { useStore } from "alepha/react";
import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import { sigilAnyGlobMatch } from "../../shared/sigilGlobMatch.ts";
import { useCurrentPath } from "../useCurrentPath.ts";
import { SigilFeedbackButton } from "./SigilFeedbackButton.tsx";

/**
 * Root Sigil component.
 *
 * Renders the floating feedback button — but only when the `petition` feature
 * is enabled and the current pathname isn't excluded. Both come from
 * {@link sigilClientAtom}, the SSR-hydrated public config (features +
 * excludedPaths), so there is no runtime fetch. The path check re-evaluates on
 * SPA navigation via {@link useCurrentPath}.
 */
export const SigilRoot = () => {
  const [config] = useStore(sigilClientAtom);
  const path = useCurrentPath();

  if (!config.features.includes("petition")) {
    return null;
  }

  if (
    config.excludedPaths.length > 0 &&
    sigilAnyGlobMatch(path, config.excludedPaths)
  ) {
    return null;
  }

  return <SigilFeedbackButton />;
};
