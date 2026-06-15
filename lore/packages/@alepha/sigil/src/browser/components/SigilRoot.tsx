import { sigilAnyGlobMatch } from "../../shared/sigilGlobMatch.ts";
import { useCurrentPath } from "../useCurrentPath.ts";
import { useSigilExcludedPaths } from "../useSigilExcludedPaths.ts";
import { SigilFeedbackButton } from "./SigilFeedbackButton.tsx";

/**
 * Root Sigil component.
 *
 * Renders the floating feedback button. Drop this anywhere in the React
 * tree (e.g., in your app shell) to enable in-app feedback for your users.
 * The button opens the first-party Lore petition page in a popup via the
 * same-origin `/sigil/request` proxy.
 *
 * The button is suppressed on host pages whose pathname matches one of the
 * sigil's `excludedPaths` globs (fetched once from `/api/sigil/config`). The
 * match is re-evaluated on SPA navigation, so the button appears/disappears
 * as the visitor moves between pages.
 */
export const SigilRoot = () => {
  const excludedPaths = useSigilExcludedPaths();
  const path = useCurrentPath();

  if (excludedPaths.length > 0 && sigilAnyGlobMatch(path, excludedPaths)) {
    return null;
  }

  return <SigilFeedbackButton />;
};
