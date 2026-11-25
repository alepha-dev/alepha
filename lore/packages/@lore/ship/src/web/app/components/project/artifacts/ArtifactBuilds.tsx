import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TimeAgo,
} from "@alepha/ui";
import { CommitLink, currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { ArtifactGroup } from "../../../../../api/schemas/artifactGroupSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import {
  type ArtifactBuildRow,
  type ArtifactNameChange,
  artifactBuildRows,
  artifactChangeNames,
  artifactHref,
  artifactSignedCount,
  artifactVariantKey,
} from "./artifactView.ts";
import { useArtifactSize } from "./useArtifactSize.ts";

export interface ArtifactBuildsProps {
  app: string;
  tag: string;
  variant: ArtifactResource;
  builds: ArtifactGroup[];
}

const GRID =
  "grid grid-cols-[minmax(8rem,1fr)_5rem_5.5rem_5.5rem_minmax(0,1.5fr)_5rem_4rem_8rem] items-center gap-4";

/**
 * The app's other builds of this runtime and format, each set against the one
 * before it: its size, the variables and secrets it reads, and the resources,
 * runtimes and crons that changed (#Q4265).
 *
 * ⚠️ `latest` has one row and no past: its earlier bytes are gone, so a delta
 * compares tags that still exist.
 *
 * ⚠️ A count with nothing beside it is unchanged; an empty cell is unknown (an
 * image, or a build pushed before manifests were stored), never zero.
 */
const ArtifactBuilds = (props: ArtifactBuildsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const size = useArtifactSize();

  if (!project) {
    return null;
  }
  const rows = artifactBuildRows(props.builds, props.variant);

  const count = (
    row: ArtifactBuildRow,
    kind: "variables" | "secrets",
    testId: string,
  ) => {
    const names = row.declares?.[kind];
    const change = row.changes?.[kind];
    const moved = change ? artifactSignedCount(change) : "";
    return (
      <span
        className="text-xs tabular-nums"
        data-testid={testId}
        title={change ? artifactChangeNames(change) || undefined : undefined}
      >
        {names?.length}
        {moved && (
          <span className="text-muted-foreground ms-1.5">({moved})</span>
        )}
      </span>
    );
  };

  const named = (change: ArtifactNameChange | undefined) =>
    change
      ? [
          ...change.added.map((it) => `+${it}`),
          ...change.removed.map((it) => `-${it}`),
        ]
      : [];

  const changes = (row: ArtifactBuildRow): string[] => {
    const crons = row.changes?.crons;
    const moved = crons ? artifactSignedCount(crons) : "";
    return [
      ...named(row.changes?.resources),
      ...(row.changes?.runtimes
        ? [
            tr("artifact.builds.runtimes", {
              args: [row.changes.runtimes.join(", ")],
            }),
          ]
        : []),
      ...(moved ? [tr("artifact.builds.crons", { args: [moved] })] : []),
    ];
  };

  return (
    <Card data-testid="artifact-builds">
      <CardHeader>
        <CardTitle className="text-base">
          {tr("artifact.builds.title", { args: [props.app] })}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto text-sm">
        <div className="flex min-w-[52rem] flex-col divide-y">
          <div className={`${GRID} text-muted-foreground pb-2 text-xs`}>
            <span>{tr("artifact.builds.col.build")}</span>
            <span>{tr("artifact.builds.col.commit")}</span>
            <span>{tr("artifact.builds.col.variables")}</span>
            <span>{tr("artifact.builds.col.secrets")}</span>
            <span>{tr("artifact.builds.col.changes")}</span>
            <span className="text-right">{tr("artifact.builds.col.size")}</span>
            <span />
            <span>{tr("artifact.builds.col.pushed")}</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.tag}
              className={`${GRID} py-2`}
              data-testid={`artifact-build-${row.tag}`}
            >
              {row.tag === props.tag ? (
                <span className="truncate font-mono text-xs font-medium">
                  {tr("artifact.builds.this", { args: [row.tag] })}
                </span>
              ) : (
                <Link
                  href={artifactHref(project.slug, {
                    app: props.app,
                    tag: row.tag,
                    variant: artifactVariantKey(props.variant),
                  })}
                  className="truncate font-mono text-xs"
                >
                  {row.tag}
                </Link>
              )}
              <span className="text-muted-foreground text-xs">
                {row.commitSha && <CommitLink sha={row.commitSha} />}
              </span>
              {count(row, "variables", `artifact-build-variables-${row.tag}`)}
              {count(row, "secrets", `artifact-build-secrets-${row.tag}`)}
              <span
                className="flex flex-wrap gap-1.5"
                data-testid={`artifact-build-changes-${row.tag}`}
              >
                {changes(row).map((it) => (
                  <Badge key={it} variant="secondary">
                    {it}
                  </Badge>
                ))}
              </span>
              <span className="text-muted-foreground text-right text-xs tabular-nums">
                {row.size === undefined ? "N/A" : size(row.size)}
              </span>
              <span className="text-muted-foreground text-right text-xs tabular-nums">
                {row.delta === undefined
                  ? ""
                  : size(row.delta, { signed: true })}
              </span>
              <TimeAgo
                value={row.pushedAt}
                className="text-muted-foreground text-xs whitespace-nowrap"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default ArtifactBuilds;
