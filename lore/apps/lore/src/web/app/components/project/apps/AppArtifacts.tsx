import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ArtifactController } from "@/api/controllers/ArtifactController.ts";
import type { SigilResource } from "@/api/schemas/sigilResourceSchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import AppArtifactsEmpty from "./AppArtifactsEmpty.tsx";
import AppArtifactsRow from "./AppArtifactsRow.tsx";

export interface AppArtifactsProps {
  sigil: SigilResource;
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
 * artifacts, forever. So the empty state prints the command rather than an
 * error or an ominous blank - the same answer the Quality tab reached.
 *
 * ## Its own query, not the route loader's
 *
 * The `projectApp` loader runs for every tab, Settings included, and used to
 * fetch insights for all of them. Nothing here is in it: an artifact list is
 * one indexed read, and it is paid for by the one tab that shows it.
 */
const AppArtifacts = (props: AppArtifactsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const artifactApi = useClient<ArtifactController>();
  const [project] = useStore(currentProjectAtom);

  const { data, loading, error } = useQuery(
    {
      enabled: Boolean(project),
      key: ["app-artifacts", project?.id, props.sigil.name],
      handler: async () => {
        if (!project) return undefined;
        return await artifactApi.listArtifacts({
          params: { projectId: project.id },
          query: { app: props.sigil.name },
        });
      },
    },
    [project?.id, props.sigil.name],
  );

  const groups = data?.groups ?? [];

  return (
    <Card data-testid="app-artifacts">
      <CardHeader>
        <CardTitle className="text-base">{tr("app.artifacts")}</CardTitle>
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
          <AppArtifactsEmpty
            projectSlug={project?.slug ?? ""}
            appName={props.sigil.name}
          />
        ) : (
          <div className="flex flex-col divide-y">
            {groups.map((group) => (
              <AppArtifactsRow key={group.tag} group={group} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AppArtifacts;
