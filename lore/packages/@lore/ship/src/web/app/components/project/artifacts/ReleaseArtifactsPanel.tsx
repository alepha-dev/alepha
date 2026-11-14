import type { ResourceTabSubject } from "@lore/core/web";

import ReleaseArtifactsTab from "./ReleaseArtifactsTab.tsx";
import { useReleaseArtifacts } from "./useReleaseArtifacts.ts";

export interface ReleaseArtifactsPanelProps {
  subject: ResourceTabSubject;
}

/**
 * The release page's Artifacts tab, registered by `DeployShell` (#E75,
 * #Q2624). It reads the same query the page counted with, so opening it
 * sends nothing new.
 */
const ReleaseArtifactsPanel = (props: ReleaseArtifactsPanelProps) => {
  const { artifacts, loading } = useReleaseArtifacts(props.subject);

  return (
    <ReleaseArtifactsTab
      tag={props.subject.tag ?? String(props.subject.number)}
      artifacts={artifacts}
      loading={loading}
    />
  );
};

export default ReleaseArtifactsPanel;
