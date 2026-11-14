import { Badge, Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { ArtifactDetail } from "../../../../../api/schemas/artifactDetailSchema.ts";
import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import { artifactCopyState } from "./artifactView.ts";

export interface ArtifactCopiesProps {
  detail: ArtifactDetail;
  variant: ArtifactResource;
}

/**
 * Every copy of the app, and how each stands against these bytes.
 *
 * Every copy rather than those running this build: "not running this" is an
 * answer too, and the copy's own line says what it runs instead.
 */
const ArtifactCopies = (props: ArtifactCopiesProps) => {
  const { detail, variant } = props;
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  return (
    <Card data-testid="artifact-copies">
      <CardHeader>
        <CardTitle className="text-base">
          {tr("artifact.copies.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y text-sm">
        {detail.copies.length === 0 && (
          <p className="text-muted-foreground">{tr("artifact.copies.empty")}</p>
        )}
        {detail.copies.map((copy) => {
          const state = artifactCopyState(copy, variant, detail.deployments);
          return (
            <div
              key={copy.id}
              data-testid={`artifact-copy-${copy.env}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
            >
              <Link
                href={router.path("app", {
                  params: {
                    projectSlug: project.slug,
                    app: detail.app,
                    env: copy.env,
                  },
                })}
                className="font-medium"
              >
                {detail.app} / {copy.env}
              </Link>
              {state === "running" && (
                <Badge variant="tint">{tr("artifact.copies.running")}</Badge>
              )}
              {state === "superseded" && (
                <Badge variant="outline">
                  {tr("artifact.copies.superseded")}
                </Badge>
              )}
              <span className="text-muted-foreground ml-auto flex flex-wrap items-center gap-x-3 text-xs">
                {copy.host && <span>{copy.host.label ?? copy.host.slug}</span>}
                {copy.deployed ? (
                  <span title={copy.deployed.sha256}>
                    {tr("artifact.copies.on", {
                      args: [
                        copy.deployed.tag,
                        l(copy.deployed.at, { date: "ll" }),
                      ],
                    })}
                  </span>
                ) : (
                  <span>{tr("artifact.copies.never")}</span>
                )}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default ArtifactCopies;
