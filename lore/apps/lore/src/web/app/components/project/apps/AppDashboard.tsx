import { useStore } from "alepha/react";

import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import AppDashboardCapabilities from "./AppDashboardCapabilities.tsx";
import AppDashboardIdentity from "./AppDashboardIdentity.tsx";

/**
 * The app's front page: what this thing is, and what it is doing.
 *
 * **It opens instantly, and that is a property rather than a happy accident.**
 * It used to render unique visitors, total views and an error-group count from
 * an insights payload, which meant the front page of an app cost ten aggregate
 * queries against Analytics Engine to show three counters. Those tiles live on
 * Analytics now, where a range control exists to explain them; nothing here
 * issues an analytics query at all, and everything it renders came with the
 * route's own sigil lookup.
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
  const [sigil] = useStore(currentSigilAtom);

  if (!sigil) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AppDashboardIdentity sigil={sigil} />
        <AppDashboardCapabilities sigil={sigil} />
      </div>
    </div>
  );
};

export default AppDashboard;
