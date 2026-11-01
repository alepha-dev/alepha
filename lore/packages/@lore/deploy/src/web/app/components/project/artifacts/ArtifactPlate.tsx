import { Button, Segmented, TimeAgo } from "@alepha/ui";
import {
  CommitLink,
  currentProjectAtom,
  type I18n,
  useKindReferences,
} from "@lore/core/web";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Download } from "lucide-react";

import type { ArtifactController } from "../../../../../api/controllers/ArtifactController.ts";
import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import type { ArtifactGroup } from "../../../../../api/schemas/artifactGroupSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import ArtifactPullCommand from "../../shared/ArtifactPullCommand.tsx";
import ArtifactDeployMenu from "./ArtifactDeployMenu.tsx";
import ArtifactStat from "./ArtifactStat.tsx";
import {
  artifactBuildRows,
  artifactCopyState,
  artifactManifestSummary,
  artifactVariantKey,
} from "./artifactView.ts";
import { useArtifactSize } from "./useArtifactSize.ts";

export interface ArtifactPlateProps {
  detail: ArtifactDetail;
  variant: ArtifactResource;
  builds: ArtifactGroup[];
  onVariant: (key: string) => void;
}

/**
 * The band above the tabs: the build's name, where it came from, what can be
 * done with it, and the four numbers true on every tab.
 *
 * Everything here describes the VARIANT shown, except the title and the
 * commit, which the tag owns.
 */
const ArtifactPlate = (props: ArtifactPlateProps) => {
  const { detail, variant } = props;
  const { tr } = useI18n<I18n, "en">();
  const artifactApi = useClient<ArtifactController>();
  const [project] = useStore(currentProjectAtom);
  const size = useArtifactSize();

  // Tag equality, which is the whole join, and a link only where the release
  // exists: an artifact tagged with something no release names is normal.
  const releases = useKindReferences("release", {
    kind: "artifacts",
    projectId: project?.id ?? 0,
    projectSlug: project?.slug ?? "",
  });
  const release = releases.refs.find((it) => it.tag === detail.tag);
  const releaseHref = release ? releases.href(release) : undefined;

  if (!project) {
    return null;
  }

  const running = detail.copies.filter(
    (copy) =>
      artifactCopyState(copy, variant, detail.deployments) === "running",
  ).length;
  const succeeded = detail.deployments.filter(
    (run) => run.status === "succeeded",
  ).length;
  const delta = artifactBuildRows(props.builds, variant).find(
    (row) => row.tag === detail.tag,
  )?.delta;
  const summary =
    variant.format === "archive" && variant.manifest
      ? artifactManifestSummary(variant.manifest)
      : undefined;

  return (
    <div
      data-testid="artifact-plate"
      className="flex flex-col gap-4 px-6 pt-6 pb-4"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* The pair, split like an app's plate: the app muted and the tag at
              full strength, the half a reader is looking for. */}
          <h1 className="text-xl font-semibold">
            <span className="text-muted-foreground font-normal">
              {detail.app} /{" "}
            </span>
            {detail.tag}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {releaseHref && (
              <>
                <Link href={releaseHref} data-testid="artifact-release">
                  {tr("artifact.meta.release", { args: [detail.tag] })}
                </Link>
                <span aria-hidden>·</span>
              </>
            )}
            {detail.commitSha && (
              <>
                <CommitLink
                  sha={detail.commitSha}
                  repositoryUrl={project.repositoryUrl}
                />
                <span aria-hidden>·</span>
              </>
            )}
            <TimeAgo value={variant.updatedAt} />
            <span aria-hidden>·</span>
            <code className="font-mono" title={variant.sha256}>
              {variant.sha256.slice(0, 12)}
            </code>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {variant.format === "image" && variant.reference && (
            <ArtifactPullCommand reference={variant.reference} />
          )}
          {variant.format === "archive" &&
            artifactApi.downloadArtifact.can() && (
              <Button
                variant="outlined"
                render={
                  // A plain anchor: same-origin navigation carries the session
                  // cookie and streams the response past React.
                  <a
                    href={`/api/projects/${project.id}/artifacts/${variant.id}/download`}
                    download
                  />
                }
              >
                <Download className="size-4" aria-hidden />
                {tr("common.download")}
              </Button>
            )}
          <ArtifactDeployMenu detail={detail} variant={variant} />
        </div>
      </div>

      {detail.variants.length > 1 && (
        <Segmented
          size="sm"
          value={artifactVariantKey(variant)}
          onChange={props.onVariant}
          options={detail.variants.map((it) => ({
            value: artifactVariantKey(it),
            label: `${it.format} · ${it.runtimes.join(", ")}`,
          }))}
        />
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <ArtifactStat
          label={tr("artifact.stat.size")}
          value={variant.size === undefined ? "N/A" : size(variant.size)}
          hint={delta === undefined ? undefined : size(delta, { signed: true })}
        />
        <ArtifactStat
          label={tr("artifact.stat.running")}
          value={String(running)}
          hint={tr("artifact.stat.runningHint", {
            args: [String(detail.copies.length)],
          })}
        />
        <ArtifactStat
          label={tr("artifact.stat.deploys")}
          value={String(detail.deployments.length)}
          hint={tr("artifact.stat.deploysHint", { args: [String(succeeded)] })}
        />
        {/* Unknown rather than zero: a build pushed before manifests were
            stored did not declare nothing. */}
        <ArtifactStat
          label={tr("artifact.stat.secrets")}
          value={summary ? String(summary.secrets.length) : "N/A"}
          hint={
            summary
              ? tr("artifact.stat.secretsHint", {
                  args: [
                    String(summary.variables.length),
                    String(summary.crons.length),
                  ],
                })
              : undefined
          }
        />
      </div>
    </div>
  );
};

export default ArtifactPlate;
