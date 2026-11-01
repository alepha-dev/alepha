import { Badge } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import { artifactHref, artifactVariantKey } from "../artifacts/artifactView.ts";

export interface AppDashboardRunningProps {
  instance: AppInstanceResource;
}

/**
 * The build this copy runs, linked to its page.
 *
 * Two grid cells of the Identity card, so a fragment. The digest is printed
 * because the tag alone cannot say which bytes run here: `latest` moves.
 *
 * ⚠️ A deleted build is plain text. The snapshot still says what ran, and a
 * link would land on a page saying the tag does not exist.
 */
const AppDashboardRunning = (props: AppDashboardRunningProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const { instance } = props;
  const { deployed } = instance;

  if (!deployed || !project) {
    return null;
  }

  const located = deployed.runtime && deployed.format;

  return (
    <>
      <span className="text-muted-foreground">
        {tr("app.dashboard.running")}
      </span>
      <span
        data-testid="app-running"
        className="flex flex-wrap items-center gap-2"
      >
        {deployed.state === "gone" ? (
          <span className="font-mono text-xs">{deployed.tag}</span>
        ) : (
          <Link
            href={artifactHref(project.slug, {
              app: instance.app,
              tag: deployed.tag,
              variant: located
                ? artifactVariantKey({
                    runtime: deployed.runtime as string,
                    format: deployed.format as string,
                  })
                : undefined,
            })}
            className="font-mono text-xs"
          >
            {deployed.tag}
          </Link>
        )}
        <code
          className="text-muted-foreground font-mono text-xs"
          title={deployed.sha256}
        >
          {deployed.sha256.slice(0, 12)}
        </code>
        <span className="text-muted-foreground text-xs">
          {tr("app.dashboard.running.at", {
            args: [l(deployed.at, { date: "lll" })],
          })}
        </span>
        {deployed.state === "moved" && (
          <Badge variant="outline" className="text-amber-600">
            {tr("app.dashboard.running.moved", { args: [deployed.tag] })}
          </Badge>
        )}
        {deployed.state === "gone" && (
          <Badge variant="outline" className="text-muted-foreground">
            {tr("app.dashboard.running.gone")}
          </Badge>
        )}
      </span>
    </>
  );
};

export default AppDashboardRunning;
