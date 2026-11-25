import { AccountPage } from "@alepha/ui/account";
import { useInject, useStore } from "alepha/react";

import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import { HostConsoleRegistry } from "../../registries/HostConsoleRegistry.ts";
import BayJobTools from "./BayJobTools.tsx";

/**
 * A host's Agent tab (#Q4414): what running agent jobs on the machine needs,
 * out of Settings. Core's tools of the jobs user, then every panel a module
 * registered (`@lore/prompts`'s Agent host switch), each told whether the
 * viewer may change the host, as the server computed it.
 */
const BayAgent = () => {
  const [host] = useStore(currentHostAtom);
  const panels = useInject(HostConsoleRegistry).agentPanels();
  if (!host) return null;
  const canUpdate = host.can.includes("host:update");
  return (
    <AccountPage variant="form" className="gap-4">
      <BayJobTools />
      {panels.map((panel) => (
        <panel.Component key={panel.key} canUpdate={canUpdate} />
      ))}
    </AccountPage>
  );
};

export default BayAgent;
