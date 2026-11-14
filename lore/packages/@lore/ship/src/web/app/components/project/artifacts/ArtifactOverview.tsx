import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import type { ArtifactGroup } from "../../../../../api/schemas/artifactGroupSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import ArtifactBuilds from "./ArtifactBuilds.tsx";
import ArtifactCopies from "./ArtifactCopies.tsx";
import ArtifactNeeds from "./ArtifactNeeds.tsx";

export interface ArtifactOverviewProps {
  detail: ArtifactDetail;
  variant: ArtifactResource;
  builds: ArtifactGroup[];
}

/**
 * Where this build runs, what it asks for, and what sits beside it.
 */
const ArtifactOverview = (props: ArtifactOverviewProps) => (
  <div className="flex flex-col gap-4 p-4">
    <ArtifactCopies detail={props.detail} variant={props.variant} />
    <ArtifactNeeds variant={props.variant} />
    <ArtifactBuilds
      app={props.detail.app}
      tag={props.detail.tag}
      variant={props.variant}
      builds={props.builds}
    />
  </div>
);

export default ArtifactOverview;
