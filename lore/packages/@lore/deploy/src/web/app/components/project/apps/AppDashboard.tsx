import { useStore } from "alepha/react";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import AppDashboardCapabilities from "./AppDashboardCapabilities.tsx";
import AppDashboardIdentity from "./AppDashboardIdentity.tsx";
import AppDashboardNextSteps from "./AppDashboardNextSteps.tsx";

/**
 * The app's front page: what this thing is, and what it is doing.
 *
 * **It opens instantly, and that is a property rather than a happy accident.**
 * It used to render unique visitors, total views and an error-group count from
 * an insights payload, which meant the front page of an app cost ten aggregate
 * queries against Analytics Engine to show three counters. Those tiles live on
 * Analytics now, where a range control exists to explain them; nothing here
 * issues an analytics query at all, and everything it renders came with the
 * route's own instance lookup.
 *
 * Two blocks. Identity answers "what is this and is it alive". Capabilities
 * puts what the app SAYS it sends beside what this sink ACCEPTS, which is the
 * comparison neither page could make before: a disagreement was invisible in
 * both directions, and it is the failure mode that wastes the most time.
 *
 * Deliberately roomy. Artifacts landed here with epic #18 and moved to their
 * own tab (feedback #2065): a build list is a table, and a table at the bottom
 * of the front page was neither glanceable nor wide. The current deployment
 * and a run log still want this page once the rest of the deploy chain lands.
 */
const AppDashboard = () => {
  const [instance] = useStore(currentInstanceAtom);

  if (!instance) {
    return null;
  }

  // An instance with nothing unlocked gets next steps rather than a card grid
  // with holes in it: both cards below read a sigil, so without one the
  // Capabilities card has nothing to render and the identity card's token and
  // last-report rows are blank. It is also the normal state right after
  // creation, and where you land - the first impression of the whole feature.
  const bare = !instance.sigil && !instance.url && !instance.estateId;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {bare ? (
          <AppDashboardNextSteps />
        ) : (
          <>
            <AppDashboardIdentity instance={instance} />
            {/*
              Capabilities are the sigil's, so the card only exists once one
              has been minted.
            */}
            {instance.sigil && (
              <AppDashboardCapabilities sigil={instance.sigil} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AppDashboard;
