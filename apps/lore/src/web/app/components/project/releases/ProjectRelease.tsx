import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { useDetailTab, PlateLayout, type PlateTab } from "@alepha/ui/shell";
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { Gauge, ListTree, Package, ScrollText, Workflow } from "lucide-react";
import { useState } from "react";

import type { ArtifactController } from "@/api/controllers/ArtifactController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { ReleaseChangelogGroup } from "@/api/schemas/releaseChangelogGroupSchema.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";
import ReleaseArtifactsTab from "./ReleaseArtifactsTab.tsx";
import ReleaseChangelogPanel from "./ReleaseChangelogPanel.tsx";
import ReleaseContents, {
  type ReleaseContentsData,
} from "./ReleaseContents.tsx";
import ReleaseEditSheet from "./ReleaseEditSheet.tsx";
import ReleaseFlow from "./ReleaseFlow.tsx";
import ReleaseOverviewTab from "./ReleaseOverviewTab.tsx";
import ReleasePlate from "./ReleasePlate.tsx";
import ReleaseSaveToFolioDialog from "./ReleaseSaveToFolioDialog.tsx";

interface ChangelogState {
  markdown: string;
  groups: ReleaseChangelogGroup[];
  stats: { questCount: number; areaCount: number; contributorCount: number };
}

type TabKey = "overview" | "contents" | "flow" | "changelog" | "artifacts";

/**
 * One release: what it is, how far along it is, what is in it, what order it
 * ships in, what it will say when it ships, and what has been built against
 * its tag.
 *
 * A full-width plate over five tabs. It was one `max-w-4xl` scrolling column -
 * hero, contents, a permanently-open edit card, then a `min-h-100` changelog
 * panel - so "what is left before this ships" meant scrolling past three
 * panels, and there was nowhere to put anything new. Editing moved into a
 * dialog and the three panels became tabs, which is what made room for the
 * fourth, and then for the Flow beside Contents: the two are one membership
 * seen twice, as a list and as a map.
 *
 * Resolved from `currentReleasesAtom` rather than fetched by tag: the project
 * loader already holds every release with its rollup, so the page opens
 * without a round-trip and the list it was clicked from cannot disagree with
 * it.
 *
 * ⚠️ **Not `DetailLayout`.** Every other detail page in Lore uses it - a
 * 288px identity aside beside a tabbed column - and this one deliberately
 * does not. A release's identity is four facts wide and no facts deep, and
 * both the artifact table and the epic cards want the full frame. It reuses
 * `useDetailTab` from that family, and nothing else.
 */
const ProjectRelease = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  // ⚠️ Read from the router state, NOT from props. A `$page` hands its
  // component whatever its LOADER returned, and this route deliberately has
  // none — the project route already holds every release in the store. A
  // props-declared `releaseTag` is silently `undefined` here.
  //
  // The param is `releaseTag`, never `tag` and never `number`: one param name
  // per tree position, the trap `:epicNumber` documents in `AppRouter`.
  const routerState = useRouterState();
  const releaseTag = String(routerState.params.releaseTag ?? "");
  const [project] = useStore(currentProjectAtom);
  const [releases, setReleases] = useStore(currentReleasesAtom);
  const releaseApi = useClient<ReleaseController>();
  const folioApi = useClient<FolioController>();

  const [tab, setTab] = useDetailTab<TabKey>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [folioOpen, setFolioOpen] = useState(false);
  const queries = useQueryClient();

  const release: ReleaseResource | undefined = releases?.find(
    (r) => r.tag === releaseTag,
  );

  /**
   * The project's releases, back into the atom this page resolves from. A
   * `useAction` (#E59, #Q2326), called through `refetch` so a newer reload
   * supersedes one in flight; a failure is toasted by the root listener.
   */
  const reloadAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        setReleases(
          await releaseApi.getReleases({ params: { projectId: project.id } }),
        );
      },
    },
    [releaseApi, project?.id],
  );
  const reload = reloadAction.refetch;

  // ⚠️ Fetched HERE, not inside the Contents tab, because two things outside
  // that tab read it: the plate's `2 epics` and the tab bar's row count. When
  // the tab owned the fetch, a deep link to `?tab=changelog` rendered a header
  // claiming `0 epics` and a Contents tab with no count at all.
  //
  // Keyed on the release AND on `releasedAt`: publishing freezes the contents
  // the same moment it freezes the changelog, so it is a new read. The answer
  // carries the release it was read for, and anything else reads as `null`
  // ("unknown", which every reader renders as an absent count rather than a
  // confident zero): `keepPreviousData` holds the rows through a re-read of
  // THIS release, and must not show one release's epic count in the next
  // one's header.
  //
  // Quiet on failure: the page already renders, and a failed read leaves the
  // counts absent rather than breaking the release around them.
  const contentsQuery = useQuery(
    {
      key: ["release-contents", release?.id, release?.releasedAt],
      enabled: !!release,
      keepPreviousData: true,
      handler: async () => ({
        releaseId: release?.id,
        data: await releaseApi.getReleaseContents({
          params: { id: release?.id as number },
        }),
      }),
      onError: () => {},
    },
    [releaseApi, release?.id, release?.releasedAt],
  );
  const contents: ReleaseContentsData | null =
    release && contentsQuery.data?.releaseId === release.id
      ? contentsQuery.data.data
      : null;

  // Keyed on `releasedAt` as well as the id, so publishing re-reads the
  // now-frozen copy rather than showing the live one it replaced. Handled:
  // the panel renders its own error state.
  const changelogQuery = useQuery(
    {
      key: ["release-changelog", release?.id, release?.releasedAt],
      enabled: !!release,
      handler: () =>
        releaseApi.getReleaseChangelog({
          params: { id: release?.id as number },
        }),
      onError: () => {},
    },
    [releaseApi, release?.id, release?.releasedAt],
  );
  const changelog: ChangelogState | null = changelogQuery.data
    ? {
        markdown: changelogQuery.data.markdown,
        groups: changelogQuery.data.groups,
        stats: changelogQuery.data.stats,
      }
    : null;
  const changelogLoading = changelogQuery.loading && !changelogQuery.data;
  const changelogError = !!changelogQuery.error && !changelogQuery.data;

  /**
   * After an attach or a detach. The three reads move together on purpose:
   * the rollup in the plate, the rows in Contents and the changelog are three
   * projections of one membership, and refreshing one of them alone is how
   * they end up disagreeing on screen.
   */
  const reloadAll = () => {
    if (!release) return;
    queries.invalidate(["release-contents", release.id]);
    queries.invalidate(["release-changelog", release.id]);
    void reload();
  };

  /*
    Real rows since epic #18. Every artifact surface on this page reads this
    one list, so the tab count, the KPI and the edit sheet's warning cannot
    disagree with the table.

    ⚠️ Keyed on the TAG, which is the join: `artifacts.tag = releases.tag`,
    with no join table and no foreign key. Retagging a release therefore
    changes what this returns, which is exactly what the edit sheet warns
    about.

    A release with no tag asks for nothing: the query would be unanswerable,
    and `enabled: false` is the honest way to say so rather than a request for
    the empty string.
  */
  const artifactApi = useClient<ArtifactController>();
  const { data: artifactData, loading: artifactsLoading } = useQuery(
    {
      enabled: Boolean(project && release?.tag),
      key: ["release-artifacts", project?.id, release?.tag],
      handler: async () => {
        if (!project || !release?.tag) return undefined;
        return await artifactApi.listArtifacts({
          params: { projectId: project.id },
          query: { tag: release.tag },
        });
      },
    },
    [project?.id, release?.tag],
  );

  const artifacts = artifactData?.groups ?? [];
  // Variants, not groups: the Artifacts tab lists one row per variant since
  // #Q2267, so the count on its badge, on the plate and in the retag warning
  // is the number of rows a reader sees there.
  const artifactCount = artifacts.reduce(
    (count, group) => count + group.variants.length,
    0,
  );

  const handleCopy = async () => {
    if (!changelog) return;
    try {
      await navigator.clipboard.writeText(changelog.markdown);
      toaster.success(tr("release.changelog.copied"));
    } catch {
      toaster.error(tr("release.changelog.copyError"));
    }
  };

  const handleDownload = () => {
    if (!changelog || !release) return;
    const blob = new Blob([changelog.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `release-${release.tag ?? release.number}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // A `useAction` (#E59, #Q2326). A refusal is the server's sentence, toasted
  // by the root `ActionErrorToaster`, and the dialog stays open so the typed
  // title is not lost: it closes inside the handler, on success only.
  const saveToFolioAction = useAction<[title: string], void>(
    {
      handler: async (title) => {
        if (!project || !changelog || !release) return;
        await folioApi.create({
          body: {
            projectId: project.id,
            title,
            content: changelog.markdown,
            summary: tr("release.folio.summary", {
              args: [
                release.tag ?? formatReference("release", release.number),
                String(changelog.stats.questCount),
              ],
            }),
          },
        });
        setFolioOpen(false);
        toaster.success(tr("release.folio.saved"));
      },
    },
    [folioApi, project?.id, changelog, release, toaster, tr],
  );

  if (!project) return null;

  // A tag that resolves to nothing: a stale link, or a release deleted since.
  // Says so rather than rendering an empty plate.
  if (!release) {
    return (
      <div className="mx-auto w-full max-w-4xl px-5 py-12 text-center lg:px-7">
        <p className="text-muted-foreground text-sm">
          {tr("release.detail.notFound", { args: [releaseTag] })}
        </p>
      </div>
    );
  }

  const published = !!release.releasedAt;

  // A count is shown only once its collection has resolved - `null` renders
  // the bare label rather than a confident "0".
  const tabs: PlateTab[] = [
    {
      key: "overview",
      label: tr("release.tab.overview"),
      icon: Gauge,
    },
    {
      key: "contents",
      label: tr("release.tab.contents"),
      icon: ListTree,
      count: contents
        ? contents.epics.length + contents.looseQuests.length
        : undefined,
    },
    {
      key: "flow",
      label: tr("release.tab.flow"),
      icon: Workflow,
    },
    {
      key: "changelog",
      label: tr("release.tab.changelog"),
      icon: ScrollText,
    },
    {
      key: "artifacts",
      label: tr("release.tab.artifacts"),
      icon: Package,
      count: artifactCount,
    },
  ];

  return (
    <PlateLayout
      tabsTestId="release-tabs"
      tabs={tabs}
      active={tab}
      onSelect={(key) => setTab(key as TabKey)}
      // The changelog owns its own scroll region - it has a sticky toolbar and
      // a reading measure - so the layout must not wrap it in a second one.
      // The Flow owns its viewport: it pans and zooms instead of scrolling,
      // and a scroll region around it would give the wheel two things to do.
      scroll={tab !== "changelog" && tab !== "flow"}
      plate={
        <ReleasePlate
          release={release}
          epicCount={contents?.epics.length ?? 0}
          artifactCount={artifactCount}
          onEdit={() => setEditOpen(true)}
          onChanged={() => void reload()}
        />
      }
    >
      {tab === "changelog" ? (
        <ReleaseChangelogPanel
          groups={changelog?.groups ?? []}
          statusLabel={String(
            published
              ? tr("release.changelog.frozen", {
                  args: [
                    release.tag ?? formatReference("release", release.number),
                    String(changelog?.stats.questCount ?? 0),
                  ],
                })
              : tr("release.changelog.live", {
                  args: [String(changelog?.stats.questCount ?? 0)],
                }),
          )}
          live={!published}
          loading={changelogLoading}
          error={changelogError}
          onCopy={() => void handleCopy()}
          onDownload={handleDownload}
          onSaveToFolio={
            folioApi.create.can() ? () => setFolioOpen(true) : undefined
          }
        />
      ) : (
        <>
          {tab === "overview" && (
            <ReleaseOverviewTab
              release={release}
              artifactCount={artifactCount}
              onEdit={() => setEditOpen(true)}
            />
          )}
          {tab === "artifacts" && (
            <ReleaseArtifactsTab
              tag={release.tag ?? String(release.number)}
              artifacts={artifacts}
              loading={artifactsLoading}
            />
          )}
          {tab === "contents" && (
            <ReleaseContents
              releaseId={release.id}
              readOnly={published}
              contents={contents}
              onChanged={() => reloadAll()}
            />
          )}
          {tab === "flow" && <ReleaseFlow contents={contents} />}
        </>
      )}

      {/* Beside the tab bodies, not inside one: a drawer portals out anyway,
          and nesting it in a tab body would unmount it on a tab switch. */}
      <ReleaseEditSheet
        release={release}
        artifactCount={artifactCount}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={() => {
          setEditOpen(false);
          void reload();
        }}
      />

      {/* `ReleaseSaveToFolioDialog` is the dialog's BODY, not a dialog: it
          has always been mounted inside one by its caller. */}
      <Dialog open={folioOpen} onOpenChange={(o) => !o && setFolioOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("release.folio.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <ReleaseSaveToFolioDialog
            defaultTitle={tr("release.folio.defaultTitle", {
              args: [
                release.tag ?? formatReference("release", release.number),
                release.title,
              ],
            })}
            saving={saveToFolioAction.loading}
            onConfirm={(title) => void saveToFolioAction.run(title)}
            onCancel={() => setFolioOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </PlateLayout>
  );
};

export default ProjectRelease;
