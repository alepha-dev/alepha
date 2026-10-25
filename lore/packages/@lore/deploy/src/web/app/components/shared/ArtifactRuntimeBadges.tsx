import { Badge } from "@alepha/ui";
import { Cloud, Container, Server } from "lucide-react";

export interface ArtifactRuntimeBadgesProps {
  /**
   * Every runtime slice the variant carries, in declared order: `["node",
   * "workerd"]` for a two-slice archive, `[runtime]` for an image.
   */
  runtimes: string[];
  /**
   * `archive` or `image`. An image reads `node image`, so a node tarball and a
   * node image of one tag never look like two identical badges.
   */
  format?: string;
}

/**
 * The runtimes one artifact variant carries, one badge each, in declared order.
 *
 * ⚠️ A runtime is named by its runtime (#Q2463): `workerd`, never
 * `cloudflare`. The owner reversed the old label on 2026-09-22. `cloudflare`
 * is an estate TYPE, which is infrastructure, and it keeps its name there.
 *
 * One component for the project Artifacts table, an app's Artifacts tab and a
 * release's Artifacts tab, so a runtime is drawn the same way everywhere.
 */
const ArtifactRuntimeBadges = (props: ArtifactRuntimeBadgesProps) => {
  const image = props.format === "image";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {props.runtimes.map((runtime) => (
        <Badge key={runtime} variant="tint" className="gap-1">
          {image ? (
            <Container className="size-3 shrink-0" aria-hidden />
          ) : runtime === "workerd" ? (
            <Cloud className="size-3 shrink-0" aria-hidden />
          ) : (
            <Server className="size-3 shrink-0" aria-hidden />
          )}
          {image ? `${runtime} image` : runtime}
        </Badge>
      ))}
    </span>
  );
};

export default ArtifactRuntimeBadges;
