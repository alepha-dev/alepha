import { useStore } from "alepha/react";

import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import AppArtifactsList from "./AppArtifactsList.tsx";

/**
 * The Artifacts tab: what CI has built for this app.
 *
 * A tab of its own rather than a card at the bottom of the Dashboard (feedback
 * #2065). A build list is a table, and a table wants the width a tab body
 * gives it; at the foot of the front page it was neither glanceable nor wide.
 * The content is `AppArtifactsList`, unchanged from the card, so the empty
 * state and the per-tag rows read exactly as they did.
 *
 * Nothing here is gated on beacon. Artifacts arrive through
 * `alepha lore artifacts push` from CI, not through the sigil's telemetry, so
 * an app that collects nothing still has a build history to show.
 */
const AppArtifacts = () => {
  const [sigil] = useStore(currentSigilAtom);

  if (!sigil) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <AppArtifactsList sigil={sigil} />
    </div>
  );
};

export default AppArtifacts;
