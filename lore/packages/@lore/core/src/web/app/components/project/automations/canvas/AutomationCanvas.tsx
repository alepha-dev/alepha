import { useClient, useQuery, useStore } from "alepha/react";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";

import type { AutomationChannelController } from "../../../../../../api/controllers/AutomationChannelController.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import { useAutomationOptionLabels } from "../useAutomationOptions.ts";
import type { AutomationCanvasInnerProps } from "./AutomationCanvasInner.client.tsx";
import type { AutomationCanvasNames } from "./AutomationCanvasMap.ts";
import AutomationNodePanel from "./AutomationNodePanel.tsx";

export type AutomationCanvasProps = Omit<
  AutomationCanvasInnerProps,
  "names" | "selected" | "onSelect"
>;

/**
 * React Flow is browser-only and heavy: imported through `lazy()` from a
 * `.client` module, it is a chunk of its own that only the automation pages
 * load, and the server bundle never evaluates it (#Q3810).
 */
const loadInner = () => import("./AutomationCanvasInner.client.tsx");

const Inner = lazy(loadInner);

const emptySubscribe = () => () => {};

/**
 * An automation's graph on a read-only canvas (#Q3810): its sources,
 * reads, conditions and actions, and on a run's page what each one did.
 * Clicking a node opens its full configuration in a side panel.
 *
 * A placeholder of the canvas's own size holds its place until hydration
 * and while the chunk loads, so the page does not jump.
 */
const AutomationCanvas = (props: AutomationCanvasProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationChannelController>();
  const [selected, setSelected] = useState<string>();
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const ids = (key: string, type: string) =>
    props.graph.nodes
      .filter((node) => node.kind === "action" && node.type === type)
      .map((node) => node.config[key])
      .filter((value): value is string => typeof value === "string");
  const members = useAutomationOptionLabels(
    "member",
    ids("recipient", "notify"),
  );
  const folios = useAutomationOptionLabels(
    "folio",
    ids("folio", "appendFolio"),
  );
  const channels = useQuery(
    {
      key: ["automation-channels", project?.id ?? 0],
      enabled: !!project,
      handler: ({ signal }) =>
        api.listAutomationChannels(
          { params: { projectId: project!.id } },
          { request: { signal } },
        ),
      // A name is a nicety: without one a chip shows the channel's id.
      onError: () => {},
    },
    [project?.id],
  );
  const names: AutomationCanvasNames = {
    members: Object.fromEntries(members),
    folios: Object.fromEntries(folios),
    channels: Object.fromEntries(
      (channels.data?.items ?? []).map((item) => [item.id, item.name]),
    ),
  };
  const placeholder = (
    <div
      className="bg-muted/20 h-80 w-full rounded-lg border sm:h-[28rem]"
      data-testid="automation-canvas-placeholder"
    />
  );
  const node = props.graph.nodes.find((it) => it.id === selected);
  return (
    <>
      {isClient ? (
        <Suspense fallback={placeholder}>
          <Inner
            {...props}
            names={names}
            selected={selected}
            onSelect={setSelected}
          />
        </Suspense>
      ) : (
        placeholder
      )}
      <AutomationNodePanel
        node={node}
        source={props.sources?.find((it) => it.node === selected)}
        names={names}
        onClose={() => setSelected(undefined)}
      />
    </>
  );
};

export default AutomationCanvas;
