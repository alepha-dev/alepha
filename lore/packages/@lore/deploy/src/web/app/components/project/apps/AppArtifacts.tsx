import { useStore } from "alepha/react";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
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
 * `lore artifacts push` from CI, not through the sigil's telemetry, so
 * an instance with no sigil at all still has a build history to show.
 */
const AppArtifacts = () => {
  const [instance] = useStore(currentInstanceAtom);

  if (!instance) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/*
        Keyed on the APP, not the instance: `artifacts.app` is a plain string
        and a build is pushed once for an app, not once per deployed copy.
        Every instance of `club` therefore shows the same list, which is the
        model the entity argues for and the reason promotion is expressible at
        all.
      */}
      <AppArtifactsList app={instance.app} />
    </div>
  );
};

export default AppArtifacts;
