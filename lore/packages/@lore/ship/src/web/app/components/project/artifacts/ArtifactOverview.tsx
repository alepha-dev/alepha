import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import ArtifactCopies from "./ArtifactCopies.tsx";
import ArtifactNeeds from "./ArtifactNeeds.tsx";

export interface ArtifactOverviewProps {
  detail: ArtifactDetail;
  variant: ArtifactResource;
}

/**
 * Where this build runs and what it asks for. The app's other builds have a
 * tab of their own (#Q4265).
 */
const ArtifactOverview = (props: ArtifactOverviewProps) => (
  <div className="flex flex-col gap-4 p-4">
    <ArtifactCopies detail={props.detail} variant={props.variant} />
    <ArtifactNeeds variant={props.variant} />
  </div>
);

export default ArtifactOverview;
