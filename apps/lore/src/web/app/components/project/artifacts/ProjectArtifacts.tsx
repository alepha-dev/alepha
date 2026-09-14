import { TimeAgo, Badge } from "@alepha/ui";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  AppWindow,
  Cloud,
  Container,
  GitCommitHorizontal,
  Package,
  SearchX,
  Server,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";

import type { ArtifactController } from "@/api/controllers/ArtifactController.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { artifactRuntimeLabel } from "../../shared/artifactRuntimeLabel.ts";
import ArtifactsEmpty from "../../shared/ArtifactsEmpty.tsx";
import CommitLink from "../../shared/CommitLink.tsx";

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
  /**
   * `archive` or `image`. The second half of what identifies a variant.
   */
  format: string;
  /**
   * The pullable string for an image variant, absent for an archive.
   */
  reference?: string;
  /**
   * ⚠️ Optional. An image variant often has no size, and where it has one it
   * is one architecture's compressed total. `paginate-local` already sorts a
   * nullish value last whichever way the arrow points, so the Size column
   * needs nothing extra to stay sortable.
   */
  size?: number;
  commitSha?: string | null;
  pushedAt?: string | null;
}

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
 * is learned, which is the same answer `ArtifactsEmpty` and the Quality
 * tab already reached. Minting a `features.*` key was the third option and
 * the most expensive: it would owe a settings page in the same commit.
 */
const ProjectArtifacts = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const artifactApi = useClient<ArtifactController>();
  const [project] = useStore(currentProjectAtom);
  const [releases] = useStore(currentReleasesAtom);

  // ⚠️ No `loading`. It existed to keep the page-level empty panel off screen
  // while the first read was in flight; the table owns the empty state now
  // and has its own loading pass, so reading it here would be a second
  // opinion about the same moment.
  const { data, error } = useQuery(
    {
      enabled: Boolean(project),
      key: ["project-artifacts", project?.id],
      handler: async () => {
        if (!project) return undefined;
        return await artifactApi.listArtifacts({
          params: { projectId: project.id },
        });
      },
      // Handled: the page renders its own error state, so the root
      // `ActionErrorToaster` must not toast the same failure on top of it.
      onError: () => {},
    },
    [project?.id],
  );

  const rows = useMemo<ArtifactRow[]>(() => {
    return (data?.groups ?? []).flatMap((group) =>
      group.variants.map((variant) => ({
        // `(app, tag, runtime, format)` is the entity's own uniqueness, minus
        // the project which is fixed here, so it is the row's identity too.
        //
        // ⚠️ `format` is load-bearing since #E47. Without it a node tarball
        // and a node image of one tag collide into ONE React key, and the
        // table renders one row where the registry holds two.
        key: `${group.app}:${group.tag}:${variant.runtime}:${variant.format}`,
        app: group.app,
        tag: group.tag,
        runtime: variant.runtime,
        format: variant.format,
        reference: variant.reference,
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
        .map((runtime) => ({
          label: artifactRuntimeLabel(runtime),
          value: runtime,
        })),
    [rows],
  );
  // Derived like the other two rather than hardcoded to the two known
  // formats: a project that has never recorded an image gets no Format
  // control at all, because it would be a filter that can only ever match
  // everything.
  const formatItems = useMemo(
    () =>
      [...new Set(rows.map((row) => row.format))]
        .sort((a, b) => a.localeCompare(b))
        .map((format) => ({ label: format, value: format })),
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

  // ⚠️ Absent is rendered, never computed around. An image variant may carry
  // no size at all, and `${NaN} MB` is what a `Math.max` over a list holding
  // one produces. A plain literal rather than a catalogue key, matching the
  // `pushedAt` cell just below it: this is a placeholder for a missing value,
  // not a sentence.
  const size = (bytes: number | undefined) =>
    bytes === undefined
      ? "N/A"
      : `${l(bytes / 1_000_000, { number: { maximumFractionDigits: 1 } })} MB`;

  /**
   * The lists are hidden below two values, the way the Epics table hides its
   * release filter: a multi-select offering one option that matches
   * everything is a control with nothing to do.
   */
  const filterFields = {
    search: {
      preset: "search",
      control: {
        inputProps: {
          // ⚠️ The kit's plain "Search" is the placeholder, like every filter
          // bar (#Q1750), and "Search" alone is thin for a screen reader on a
          // bar carrying three more controls.
          "aria-label": tr("artifacts.filter.searchLabel"),
        },
      },
    },
    app: {
      schema: z.array(z.string()),
      label: tr("artifacts.filter.app"),
      icon: AppWindow,
      items: appItems,
      hidden: appItems.length <= 1,
      control: {
        clearLabel: tr("artifacts.filter.allApps"),
        countLabel: (n: number) =>
          tr("artifacts.filter.appCount", { args: [String(n)] }),
      },
    },
    runtime: {
      schema: z.array(z.string()),
      label: tr("artifacts.filter.runtime"),
      icon: Server,
      items: runtimeItems,
      hidden: runtimeItems.length <= 1,
      control: {
        clearLabel: tr("artifacts.filter.allRuntimes"),
        countLabel: (n: number) =>
          tr("artifacts.filter.runtimeCount", { args: [String(n)] }),
      },
    },
    format: {
      schema: z.array(z.string()),
      label: tr("artifacts.filter.format"),
      icon: Container,
      items: formatItems,
      hidden: formatItems.length <= 1,
      control: {
        clearLabel: tr("artifacts.filter.allFormats"),
        countLabel: (n: number) =>
          tr("artifacts.filter.formatCount", { args: [String(n)] }),
      },
    },
  } satisfies DataTableFilterFields;

  return (
    <div
      data-testid="artifacts-table"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2"
    >
      {/*
        The error state is still the page's own, and the empty one is not it -
        the same split `AppArtifactsList` makes, for the same reason: folding
        them together is how "nothing pushed yet" comes to read as "something
        is broken".

        ⚠️ The EMPTY state is the table's now (feedback #P2130). The page used
        to paint its own panel whenever `rows.length === 0`, which collapsed
        `DataTable`'s two states into one: a reader whose filters excluded
        everything was told the project had no artifacts, and offered the
        command to push their first. See [[#F1216]] - the table chooses
        between them on `activeFilterCount`, which a page-level branch cannot
        see.
      */}
      {error ? (
        <p className="text-muted-foreground text-sm">
          {tr("app.artifacts.error")}
        </p>
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
          <DataTable<ArtifactRow, typeof filterFields>
            className="min-h-0 flex-1"
            persistenceKey={`lor.artifacts.${project.id}`}
            data={rows}
            rowKey={(row) => row.key}
            defaultSort={{ field: "pushedAt", direction: "desc" }}
            /*
             * ⚠️ Two states, never `emptyMessage`. That prop is the one-line
             * escape hatch: it replaces the title in BOTH states and
             * suppresses the description, which is precisely the collapse
             * this quest undid. `DataTable` picks between these on
             * `activeFilterCount`.
             */
            emptyState={{
              icon: Package,
              title: tr("artifacts.empty.title"),
              // The answer to "there is nothing here", which is what an
              // empty state's description is for: why the page is empty, and
              // the one link that says what to do about it.
              description: (
                <ArtifactsEmpty
                  description={tr("artifacts.empty.description")}
                />
              ),
            }}
            noMatchState={{
              icon: SearchX,
              title: tr("artifacts.noMatch"),
              description: tr("artifacts.list.empty"),
            }}
            filters={{ fields: filterFields }}
            // `app` and `runtime` would both be answered by the built-in
            // field matching, but `search` spans the tag AND the commit, so
            // once the predicate exists it owns all three rather than
            // leaving the reader to work out which filter runs where.
            filter={(row, values) => {
              const search = (values.search ?? "").toLowerCase();
              if (
                search &&
                !row.tag.toLowerCase().includes(search) &&
                !(row.commitSha ?? "").toLowerCase().includes(search)
              ) {
                return false;
              }
              const apps = values.app;
              if (apps?.length && !apps.includes(row.app)) return false;
              const runtimes = values.runtime;
              if (runtimes?.length && !runtimes.includes(row.runtime)) {
                return false;
              }
              const formats = values.format;
              if (formats?.length && !formats.includes(row.format)) {
                return false;
              }
              return true;
            }}
            columns={{
              app: {
                label: tr("artifacts.table.app"),
                sortable: true,
                // ⚠️ Plain text, and it must stay plain text (#P2162).
                //
                // This was a `Link` to `projectAppRedirect`, defended on the
                // grounds that an artifact is keyed by the APP and says
                // nothing about which copy runs it, so the app is the best
                // target available. That reasoning is right and still leads
                // somewhere unhelpful: the redirect resolves to the app's
                // DEFAULT instance - `production` if it exists, else the
                // first env by name - so clicking a row about `0.28.0` on
                // `node` opened a copy chosen by a rule with nothing to do
                // with the artifact clicked, and possibly running something
                // else entirely.
                //
                // The Tag column below keeps its link, because that one is a
                // real relationship rather than a resolved guess: it points
                // at a release only when a release actually carries the tag.
                cell: (row) => (
                  <span className="block truncate font-medium">{row.app}</span>
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
                    {artifactRuntimeLabel(row.runtime)}
                  </Badge>
                ),
              },
              format: {
                label: tr("artifacts.table.format"),
                sortable: true,
                cell: (row) => (
                  <Badge variant="tint" className="gap-1">
                    {row.format === "image" ? (
                      <Container className="size-3 shrink-0" aria-hidden />
                    ) : (
                      <Package className="size-3 shrink-0" aria-hidden />
                    )}
                    {row.format}
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
                // A push is an event, so its age is the answer and the exact
                // instant is the hover (feedback #P2202). The sort reads the
                // row's ISO value, never this cell, so it stays on the instant.
                cell: (row) =>
                  row.pushedAt ? (
                    <TimeAgo
                      value={row.pushedAt}
                      className="text-muted-foreground text-xs"
                    />
                  ) : (
                    "N/A"
                  ),
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
                      <CommitLink
                        sha={row.commitSha}
                        repositoryUrl={project?.repositoryUrl}
                      />
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
