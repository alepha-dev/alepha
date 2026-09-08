import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

import type { ArtifactController } from "@/api/controllers/ArtifactController.ts";
import type { ArtifactGroup } from "@/api/schemas/artifactGroupSchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import ArtifactsEmpty from "../../shared/ArtifactsEmpty.tsx";
import AppArtifactsRow from "./AppArtifactsRow.tsx";

export interface AppArtifactsListProps {
  /**
   * The app name artifacts are keyed by, which is `app_instances.app` and not
   * the instance: a build belongs to an app, not to a deployed copy of one.
   */
  app: string;
  /**
   * A title overriding "Artifacts", for a caller reusing this list under a
   * different question. The Deploy tab asks "what can I ship here".
   */
  title?: string;
  /**
   * Per-row action, passed through to {@link AppArtifactsRow}. The Deploy tab's
   * button, and the reason this list is reused rather than copied.
   */
  action?: (group: ArtifactGroup) => ReactNode;
}

/**
 * What this app has built, newest first.
 *
 * ## ⚠️ One row per TAG, never one per artifact
 *
 * `artifacts` is unique on `(projectId, app, tag, runtime)` so that `1.2.3`
 * names one release that may carry a workerd build and a node build. Listing
 * them flat would contradict that model on the first screen anyone sees, so
 * the endpoint answers groups and this renders them.
 *
 * ## Empty is a normal state here, and a permanent one
 *
 * Everything else on this page comes from telemetry the app itself pushes.
 * Artifacts come from CI, which is a second foreign system that can be absent
 * entirely: an enrolled app with no CI integration has telemetry and zero
 * artifacts, forever. So the empty state says why and links the guide,
 * rather than showing an error or an ominous blank - the same answer the
 * Quality tab reached. It printed the command itself until feedback #P2154;
 * see `ArtifactsEmpty` for why that moved into the docs.
 *
 * ## Its own query, not the route loader's
 *
 * The `projectApp` loader runs for every tab, Settings included, and used to
 * fetch insights for all of them. Nothing here is in it: an artifact list is
 * one indexed read, and it is paid for by the one tab that shows it.
 */
const AppArtifactsList = (props: AppArtifactsListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const artifactApi = useClient<ArtifactController>();
  const [project] = useStore(currentProjectAtom);

  const { data, loading, error } = useQuery(
    {
      enabled: Boolean(project),
      key: ["app-artifacts", project?.id, props.app],
      handler: async () => {
        if (!project) return undefined;
        return await artifactApi.listArtifacts({
          params: { projectId: project.id },
          query: { app: props.app },
        });
      },
    },
    [project?.id, props.app],
  );

  const groups = data?.groups ?? [];

  return (
    <Card data-testid="app-artifacts">
      <CardHeader>
        <CardTitle className="text-base">
          {props.title ?? tr("app.artifacts")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {/*
          Three states, and the empty one is not the error one. A failed read
          says so; a project that has never pushed is told how to start. Folding
          them together is how "no artifacts" comes to mean "something is
          broken" to a reader who cannot tell the difference.
        */}
        {loading && !data ? (
          <p className="text-muted-foreground text-sm">
            {tr("app.artifacts.loading")}
          </p>
        ) : error ? (
          <p className="text-muted-foreground text-sm">
            {tr("app.artifacts.error")}
          </p>
        ) : groups.length === 0 ? (
          <ArtifactsEmpty
            description={String(tr("app.artifacts.empty.description"))}
          />
        ) : (
          <div className="flex flex-col divide-y">
            {groups.map((group) => (
              <AppArtifactsRow
                key={group.tag}
                group={group}
                action={props.action}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AppArtifactsList;
