import { Button, Skeleton } from "@alepha/ui";
import { PlateLayout, type PlateTab, useDetailTab } from "@alepha/ui/shell";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  useQueryParams,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import { ArrowLeft } from "lucide-react";

import type { ArtifactController } from "../../../../../api/controllers/ArtifactController.ts";
import ArtifactDeployments from "./ArtifactDeployments.tsx";
import ArtifactManifest from "./ArtifactManifest.tsx";
import ArtifactOverview from "./ArtifactOverview.tsx";
import ArtifactPlate from "./ArtifactPlate.tsx";
import { artifactVariantQuerySchema } from "./artifactVariantQuerySchema.ts";
import { artifactVariantKey } from "./artifactView.ts";

type TabKey = "overview" | "manifest" | "deployments";

/**
 * One tag of one app: what was built, what it asks for, and where it runs.
 *
 * ## ⚠️ One page per TAG, not per row
 *
 * The Artifacts table flattens a tag into its variants, because a table wants
 * rows. The model does not: `0.34.0` names one release built as an archive and
 * as an image, so they share this page and `?variant=` picks one.
 *
 * ## A plate, not `DetailLayout`
 *
 * `PlateLayout`, like `ProjectRelease` and for its reason: the identity here
 * is a title, a variant switch and four stats, several facts wide, and the
 * copies and builds below want the frame. The plate slot takes all of it, so
 * the shell needed no change.
 *
 * ## The app's other builds are a second read
 *
 * `listArtifacts`, narrowed to the app, not a field of `getArtifact`: the
 * endpoint already exists, already groups, and this is its question.
 */
const ProjectArtifact = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const artifactApi = useClient<ArtifactController>();
  // Read from the router state: this route has no loader, so a `$page` hands
  // its component nothing.
  const routerState = useRouterState();
  const app = String(routerState.params.app ?? "");
  const tag = String(routerState.params.artifactTag ?? "");
  const [project] = useStore(currentProjectAtom);

  const [tab, setTab] = useDetailTab<TabKey>("overview");
  const [query, setQuery] = useQueryParams(artifactVariantQuerySchema, {
    format: "querystring",
  });

  const { data, error } = useQuery(
    {
      enabled: Boolean(project),
      key: ["project-artifact", project?.id, app, tag],
      handler: async () => {
        if (!project) return undefined;
        return await artifactApi.getArtifact({
          params: { projectId: project.id, app, tag },
        });
      },
      // Handled: a tag nobody pushed is this page's own state, not a toast.
      onError: () => {},
    },
    [project?.id, app, tag],
  );

  const { data: builds } = useQuery(
    {
      enabled: Boolean(project),
      key: ["project-artifacts", project?.id, app],
      handler: async () => {
        if (!project) return undefined;
        return await artifactApi.listArtifacts({
          params: { projectId: project.id },
          query: { app },
        });
      },
      onError: () => {},
    },
    [project?.id, app],
  );

  if (!project) {
    return null;
  }

  if (error) {
    return (
      <div
        data-testid="artifact-not-found"
        className="flex flex-col items-start gap-3 p-6"
      >
        <p className="text-muted-foreground text-sm">
          {tr("artifact.notFound", { args: [app, tag] })}
        </p>
        <Button
          variant="outlined"
          render={
            <Link
              href={router.path("projectArtifacts", {
                params: { projectSlug: project.slug },
              })}
            />
          }
        >
          <ArrowLeft className="size-4" aria-hidden />
          {tr("artifact.back")}
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // An unknown `?variant=` falls back rather than failing: the link outlives
  // the variant it named, and a tag always has at least one.
  const variant =
    data.variants.find((it) => artifactVariantKey(it) === query.variant) ??
    data.variants[0];

  const tabs: PlateTab[] = [
    { key: "overview", label: tr("artifact.tab.overview") },
    { key: "manifest", label: tr("artifact.tab.manifest") },
    {
      key: "deployments",
      label: tr("artifact.tab.deployments"),
      count: data.deployments.length,
    },
  ];

  return (
    <PlateLayout
      tabsTestId="artifact-tabs"
      tabs={tabs}
      active={tab}
      onSelect={(key) => setTab(key as TabKey)}
      plate={
        <ArtifactPlate
          detail={data}
          variant={variant}
          builds={builds?.groups ?? []}
          onVariant={(key) => setQuery({ variant: key })}
        />
      }
    >
      {tab === "overview" && (
        <ArtifactOverview
          detail={data}
          variant={variant}
          builds={builds?.groups ?? []}
        />
      )}
      {tab === "manifest" && <ArtifactManifest variant={variant} />}
      {tab === "deployments" && <ArtifactDeployments detail={data} />}
    </PlateLayout>
  );
};

export default ProjectArtifact;
