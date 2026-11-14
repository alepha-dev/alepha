import { Card, CardContent, CardHeader, CardTitle, TimeAgo } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { ArtifactGroup } from "../../../../../api/schemas/artifactGroupSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import { artifactBuildRows, artifactVariantKey } from "./artifactView.ts";
import { useArtifactSize } from "./useArtifactSize.ts";

export interface ArtifactBuildsProps {
  app: string;
  tag: string;
  variant: ArtifactResource;
  builds: ArtifactGroup[];
}

/**
 * The app's other builds of this runtime and format, each sized against the
 * one before it.
 *
 * ⚠️ `latest` has one row and no past: its earlier bytes are gone, so a delta
 * compares tags that still exist.
 */
const ArtifactBuilds = (props: ArtifactBuildsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const size = useArtifactSize();

  if (!project) {
    return null;
  }
  const rows = artifactBuildRows(props.builds, props.variant);

  return (
    <Card data-testid="artifact-builds">
      <CardHeader>
        <CardTitle className="text-base">
          {tr("artifact.builds.title", { args: [props.app] })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y text-sm">
        {rows.map((row) => (
          <div
            key={row.tag}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 py-2"
          >
            {row.tag === props.tag ? (
              <span className="truncate font-mono text-xs font-medium">
                {tr("artifact.builds.this", { args: [row.tag] })}
              </span>
            ) : (
              <Link
                href={router.path("projectArtifact", {
                  params: {
                    projectSlug: project.slug,
                    app: props.app,
                    artifactTag: row.tag,
                  },
                  query: { variant: artifactVariantKey(props.variant) },
                })}
                className="truncate font-mono text-xs"
              >
                {row.tag}
              </Link>
            )}
            <span className="text-muted-foreground text-xs tabular-nums">
              {row.size === undefined ? "N/A" : size(row.size)}
            </span>
            <span className="text-muted-foreground w-16 text-right text-xs tabular-nums">
              {row.delta === undefined ? "" : size(row.delta, { signed: true })}
            </span>
            <TimeAgo
              value={row.pushedAt}
              className="text-muted-foreground text-xs"
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default ArtifactBuilds;
