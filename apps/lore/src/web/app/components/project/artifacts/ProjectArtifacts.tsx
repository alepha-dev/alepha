import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  AppWindow,
  Cloud,
  GitCommitHorizontal,
  Search,
  Server,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";

import type { ArtifactController } from "@/api/controllers/ArtifactController.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import FilterSlot from "../../shared/FilterSlot.tsx";
import ProjectArtifactsEmpty from "./ProjectArtifactsEmpty.tsx";

/**
 * One artifact, flattened out of the endpoint's groups.
 *
 * The API answers `(app, tag)` groups with their runtime variants, because a
 * tag naming both a workerd and a node build is one release and the app page
 * says so. A table wants rows, so this page unwinds that: grouping is the app
 * page's presentation, not a property of the data.
 */
interface ArtifactRow {
  key: string;
  app: string;
  tag: string;
  runtime: string;
  size: number;
  commitSha?: string | null;
  pushedAt?: string | null;
}

const filtersSchema = z.object({
  search: z.string().optional(),
  app: z.array(z.string()).optional(),
  runtime: z.array(z.string()).optional(),
});

/**
 * Every build this project has, across every app (feedback #2111).
 *
 * Artifacts were reachable only as a tab on one app, so "what has this
 * project built" could be answered one app at a time. The data was already
 * project-scoped: `listArtifacts` is `GET /projects/:projectId/artifacts`
 * where `app` and `tag` are optional narrowing, so this page is the same
 * endpoint called with neither, and needed no schema or endpoint change.
 *
 * ## Static-data mode, and the one thing that costs
 *
 * The response is not paginated on purpose: `limit` caps the rows read
 * BEFORE grouping and the answer carries `truncated` instead of offering a
 * second page, because narrowing by app or tag is the intended reply. So the
 * table gets the whole list and filters, sorts and pages it in memory, like
 * `ProjectApps` and `ProjectEpics`.
 *
 * ⚠️ Which is exactly why {@link truncated} is rendered as a banner. A
 * client-side table cannot narrow a read it has already made, so past the
 * 500-row ceiling this page would show a subset while its own footer stated a
 * total with confidence. That is the failure the endpoint's design was
 * avoiding, reintroduced one layer up.
 *
 * ## A project with no artifacts gets a page, not a hidden entry
 *
 * The alternative was hiding the sidebar entry until the first push, and it
 * loses twice. It needs a project-wide count in the route loader, so every
 * reader pays a request on every project load to decide one nav row. And it
 * makes the capability undiscoverable: somebody who has never pushed an
 * artifact would never learn that they could. The empty state is where that
 * is learned, which is the same answer `AppArtifactsEmpty` and the Quality
 * tab already reached. Minting a `features.*` key was the third option and
 * the most expensive: it would owe a settings page in the same commit.
 */
const ProjectArtifacts = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const artifactApi = useClient<ArtifactController>();
  const [project] = useStore(currentProjectAtom);
  const [releases] = useStore(currentReleasesAtom);

  const { data, loading, error } = useQuery(
    {
      enabled: Boolean(project),
      key: ["project-artifacts", project?.id],
      handler: async () => {
        if (!project) return undefined;
        return await artifactApi.listArtifacts({
          params: { projectId: project.id },
        });
      },
    },
    [project?.id],
  );

  const rows = useMemo<ArtifactRow[]>(() => {
    return (data?.groups ?? []).flatMap((group) =>
      group.variants.map((variant) => ({
        // `(app, tag, runtime)` is the entity's own uniqueness, minus the
        // project which is fixed here, so it is the row's identity too.
        key: `${group.app}:${group.tag}:${variant.runtime}`,
        app: group.app,
        tag: group.tag,
        runtime: variant.runtime,
        size: variant.size,
        commitSha: group.commitSha,
        pushedAt: group.pushedAt,
      })),
    );
  }, [data]);

  // The values actually present, not a hardcoded list: `runtime` is a plain
  // column and a build target this project has never used is a filter entry
  // that can only ever match nothing.
  const appItems = useMemo(
    () =>
      [...new Set(rows.map((row) => row.app))]
        .sort((a, b) => a.localeCompare(b))
        .map((app) => ({ label: app, value: app })),
    [rows],
  );
  const runtimeItems = useMemo(
    () =>
      [...new Set(rows.map((row) => row.runtime))]
        .sort((a, b) => a.localeCompare(b))
        .map((runtime) => ({ label: runtime, value: runtime })),
    [rows],
  );

  // Tag equality, which is the whole join: there is no join table and no
  // foreign key, and an artifact whose tag names no release is normal.
  const releaseTags = useMemo(
    () => new Set((releases ?? []).map((release) => release.tag)),
    [releases],
  );

  if (!project) {
    return null;
  }

  const size = (bytes: number) =>
    `${l(bytes / 1_000_000, { number: { maximumFractionDigits: 1 } })} MB`;

  return (
    <div
      data-testid="artifacts-table"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
    >
      {/*
        Three states, and the empty one is not the error one - the same split
        `AppArtifactsList` makes, for the same reason: folding them together
        is how "nothing pushed yet" comes to read as "something is broken".
      */}
      {error ? (
        <p className="text-muted-foreground text-sm">
          {tr("app.artifacts.error")}
        </p>
      ) : !loading && rows.length === 0 ? (
        <ProjectArtifactsEmpty projectSlug={project.slug} />
      ) : (
        <>
          {data?.truncated && (
            <div
              data-testid="artifacts-truncated"
              className="text-muted-foreground flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
            >
              <TriangleAlert
                className="mt-px size-4 shrink-0 text-amber-600 dark:text-amber-500"
                aria-hidden
              />
              <span>{tr("artifacts.truncated")}</span>
            </div>
          )}
          <AlephaTable<ArtifactRow>
            className="min-h-0 flex-1"
            persistenceKey={`lor.artifacts.${project.id}`}
            data={rows}
            rowKey={(row) => row.key}
            defaultSort={{ field: "pushedAt", direction: "desc" }}
            emptyMessage={tr("artifacts.list.empty")}
            filters={{
              schema: filtersSchema,
              render: (form) => (
                <>
                  <FilterSlot>
                    <Control
                      input={form.input.search}
                      label=""
                      icon={Search}
                      placeholder={tr("artifacts.filter.search")}
                      inputProps={{
                        "aria-label": tr("artifacts.filter.search"),
                      }}
                    />
                  </FilterSlot>
                  {/* Both hidden below two values, the way the Epics table
                      hides its release filter: a multi-select offering one
                      option that matches everything is a control with
                      nothing to do. */}
                  {appItems.length > 1 && (
                    <FilterSlot>
                      <Control
                        input={form.input.app}
                        label=""
                        clearable
                        icon={AppWindow}
                        clearLabel={tr("artifacts.filter.allApps")}
                        countLabel={(n) =>
                          String(
                            tr("artifacts.filter.appCount", {
                              args: [String(n)],
                            }),
                          )
                        }
                        triggerClassName="w-full"
                        items={appItems}
                        inputProps={{
                          "aria-label": tr("artifacts.filter.app"),
                        }}
                      />
                    </FilterSlot>
                  )}
                  {runtimeItems.length > 1 && (
                    <FilterSlot>
                      <Control
                        input={form.input.runtime}
                        label=""
                        clearable
                        icon={Server}
                        clearLabel={tr("artifacts.filter.allRuntimes")}
                        countLabel={(n) =>
                          String(
                            tr("artifacts.filter.runtimeCount", {
                              args: [String(n)],
                            }),
                          )
                        }
                        triggerClassName="w-full"
                        items={runtimeItems}
                        inputProps={{
                          "aria-label": tr("artifacts.filter.runtime"),
                        }}
                      />
                    </FilterSlot>
                  )}
                </>
              ),
            }}
            // `app` and `runtime` would both be answered by the built-in
            // field matching, but `search` spans the tag AND the commit, so
            // once the predicate exists it owns all three rather than
            // leaving the reader to work out which filter runs where.
            filter={(row, values) => {
              const search = String(values.search ?? "").toLowerCase();
              if (
                search &&
                !row.tag.toLowerCase().includes(search) &&
                !(row.commitSha ?? "").toLowerCase().includes(search)
              ) {
                return false;
              }
              const apps = values.app as string[] | undefined;
              if (apps?.length && !apps.includes(row.app)) return false;
              const runtimes = values.runtime as string[] | undefined;
              if (runtimes?.length && !runtimes.includes(row.runtime)) {
                return false;
              }
              return true;
            }}
            columns={{
              app: {
                label: tr("artifacts.table.app"),
                sortable: true,
                cell: (row) => (
                  <Link
                    href={router.path("app", {
                      params: {
                        projectSlug: project.slug,
                        appName: row.app,
                      },
                    })}
                    className="block truncate font-medium"
                  >
                    {row.app}
                  </Link>
                ),
              },
              tag: {
                label: tr("artifacts.table.tag"),
                sortable: true,
                cell: (row) =>
                  // A link only where the release exists. An artifact tagged
                  // with something no release names is normal, and a dead
                  // link would say otherwise.
                  releaseTags.has(row.tag) ? (
                    <Link
                      href={router.path("projectRelease", {
                        params: {
                          projectSlug: project.slug,
                          releaseTag: row.tag,
                        },
                      })}
                      className="font-mono text-xs"
                    >
                      {row.tag}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{row.tag}</span>
                  ),
              },
              runtime: {
                label: tr("artifacts.table.runtime"),
                sortable: true,
                cell: (row) => (
                  <Badge variant="tint" className="gap-1">
                    {row.runtime === "workerd" ? (
                      <Cloud className="size-3 shrink-0" aria-hidden />
                    ) : (
                      <Server className="size-3 shrink-0" aria-hidden />
                    )}
                    {row.runtime}
                  </Badge>
                ),
              },
              size: {
                label: tr("artifacts.table.size"),
                sortable: true,
                className: "tabular-nums",
                cell: (row) => size(row.size),
              },
              pushedAt: {
                label: tr("artifacts.table.pushed"),
                sortable: true,
                cell: (row) =>
                  row.pushedAt ? String(l(row.pushedAt, { date: "lll" })) : "—",
              },
              commitSha: {
                label: tr("artifacts.table.commit"),
                cell: (row) =>
                  row.commitSha ? (
                    <span
                      className="text-muted-foreground inline-flex items-center gap-1 font-mono text-xs"
                      title={row.commitSha}
                    >
                      <GitCommitHorizontal
                        className="size-3.5 shrink-0"
                        aria-hidden
                      />
                      {row.commitSha.slice(0, 7)}
                    </span>
                  ) : (
                    "—"
                  ),
              },
            }}
          />
        </>
      )}
    </div>
  );
};

export default ProjectArtifacts;
