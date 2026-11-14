import { Badge, Card, CardContent, CardHeader, CardTitle } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Fragment, type ReactNode } from "react";

import type { ArtifactResource } from "../../../../../api/schemas/artifactResourceSchema.ts";
import {
  artifactImagePlatforms,
  artifactManifestSummary,
} from "./artifactView.ts";

export interface ArtifactNeedsProps {
  variant: ArtifactResource;
}

/**
 * What the build's own document says it needs.
 *
 * ⚠️ `manifest` means two things, told apart by `format`: an archive's
 * `dist/manifest.json` and an image's OCI index. Absent is unknown, never
 * "needs nothing", and the card says so.
 */
const ArtifactNeeds = (props: ArtifactNeedsProps) => {
  const { variant } = props;
  const { tr } = useI18n<I18n, "en">();

  const rows: Array<[label: string, value: ReactNode]> = [];
  if (variant.manifest && variant.format === "image") {
    const platforms = artifactImagePlatforms(variant.manifest);
    if (platforms.length) {
      rows.push([
        tr("artifact.needs.platforms"),
        <code key="platforms" className="font-mono text-xs">
          {platforms.map((it) => it.platform).join(", ")}
        </code>,
      ]);
    }
  } else if (variant.manifest) {
    const summary = artifactManifestSummary(variant.manifest);
    const list = (label: string, values: string[]) => {
      if (values.length) {
        rows.push([
          label,
          <code key={label} className="font-mono text-xs">
            {values.join(", ")}
          </code>,
        ]);
      }
    };
    if (summary.resources.length) {
      rows.push([
        tr("artifact.needs.resources"),
        <span key="resources" className="flex flex-wrap gap-1.5">
          {summary.resources.map((it) => (
            <Badge
              key={it.name}
              variant={it.on ? "secondary" : "outline"}
              className={it.on ? undefined : "text-muted-foreground"}
            >
              {it.name}
            </Badge>
          ))}
        </span>,
      ]);
    }
    list(
      tr("artifact.needs.slices"),
      summary.slices.map((slice) =>
        [slice.runtime, slice.version, slice.entry].filter(Boolean).join(" "),
      ),
    );
    list(tr("artifact.needs.crons"), summary.crons);
    list(tr("artifact.needs.secrets"), summary.secrets);
    list(tr("artifact.needs.variables"), summary.variables);
    list(tr("artifact.needs.websockets"), summary.websocketPaths);
  }

  return (
    <Card data-testid="artifact-needs">
      <CardHeader>
        <CardTitle className="text-base">
          {tr("artifact.needs.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
        {rows.length === 0 && (
          <p className="text-muted-foreground sm:col-span-2">
            {tr("artifact.needs.unknown")}
          </p>
        )}
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <span className="text-muted-foreground">{label}</span>
            {value}
          </Fragment>
        ))}
      </CardContent>
    </Card>
  );
};

export default ArtifactNeeds;
