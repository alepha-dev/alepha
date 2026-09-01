import { useDetailTab } from "@alepha/ui/components/detail/use-detail-tab";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { Gauge, ListTree, Package, ScrollText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { ArtifactController } from "@/api/controllers/ArtifactController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { ReleaseChangelogGroup } from "@/api/schemas/releaseChangelogGroupSchema.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleaseArtifactsTab from "./ReleaseArtifactsTab.tsx";
import ReleaseChangelogPanel from "./ReleaseChangelogPanel.tsx";
import ReleaseContents, {
  type ReleaseContentsData,
} from "./ReleaseContents.tsx";
import ReleaseEditSheet from "./ReleaseEditSheet.tsx";
import ReleaseOverviewTab from "./ReleaseOverviewTab.tsx";
import ReleasePlate from "./ReleasePlate.tsx";
import ReleaseSaveToFolioDialog from "./ReleaseSaveToFolioDialog.tsx";
import ReleaseTabBar, { type ReleaseTab } from "./ReleaseTabBar.tsx";

interface ChangelogState {
  markdown: string;
  groups: ReleaseChangelogGroup[];
  stats: { questCount: number; areaCount: number; contributorCount: number };
}

type TabKey = "overview" | "contents" | "changelog" | "artifacts";

/**
 * One release: what it is, how far along it is, what is in it, what it will
 * say when it ships, and what has been built against its tag.
 *
 * A full-width plate over four tabs. It was one `max-w-4xl` scrolling column -
 * hero, contents, a permanently-open edit card, then a `min-h-100` changelog
 * panel - so "what is left before this ships" meant scrolling past three
 * panels, and there was nowhere to put anything new. Editing moved into a
 * dialog and the three panels became tabs, which is what made room for the
 * fourth.
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
  const [changelog, setChangelog] = useState<ChangelogState | null>(null);
  const [changelogLoading, setChangelogLoading] = useState(true);
  const [changelogError, setChangelogError] = useState(false);
  const [contents, setContents] = useState<ReleaseContentsData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [folioOpen, setFolioOpen] = useState(false);
  const [folioSaving, setFolioSaving] = useState(false);

  const release: ReleaseResource | undefined = releases?.find(
    (r) => r.tag === releaseTag,
  );

  const reload = useCallback(async () => {
    if (!project) return;
    setReleases(
      await releaseApi.getReleases({ params: { projectId: project.id } }),
    );
  }, [project?.id]);

  // ⚠️ Fetched HERE, not inside the Contents tab, because two things outside
  // that tab read it: the plate's `2 epics` and the tab bar's row count. When
  // the tab owned the fetch, a deep link to `?tab=changelog` rendered a header
  // claiming `0 epics` and a Contents tab with no count at all.
  const loadContents = useCallback(async () => {
    if (!release) return;
    // Cleared first, so walking from one release to the next never shows the
    // previous one's epic count in this one's header. `null` is "unknown",
    // which every reader of it already renders as an absent count rather than
    // a confident zero.
    setContents(null);
    try {
      setContents(
        await releaseApi.getReleaseContents({ params: { id: release.id } }),
      );
    } catch {
      // The page already renders. A failed fetch leaves the counts absent
      // rather than breaking the release around them - which is why `null`
      // means "unknown" and renders no empty state.
    }
  }, [release?.id]);

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadContents();
    // `releasedAt` as well as the id: publishing freezes the contents the
    // same moment it freezes the changelog.
  }, [loadContents, release?.releasedAt]);

  /**
   * After an attach or a detach. The three reads move together on purpose:
   * the rollup in the plate, the rows in Contents and the changelog are three
   * projections of one membership, and refreshing one of them alone is how
   * they end up disagreeing on screen.
   */
  const reloadAll = useCallback(async () => {
    await Promise.all([reload(), loadContents()]);
  }, [reload, loadContents]);

  useEffect(() => {
    if (!release) return;
    let cancelled = false;
    // Synchronous state at the top of a fetch effect: the panel has to read
    // as loading from the moment the release changes, not from whenever the
    // request resolves.
    // oxlint-disable-next-line react/set-state-in-effect
    setChangelogLoading(true);
    setChangelogError(false);
    releaseApi
      .getReleaseChangelog({ params: { id: release.id } })
      .then((res) => {
        if (cancelled) return;
        setChangelog({
          markdown: res.markdown,
          groups: res.groups,
          stats: res.stats,
        });
      })
      .catch(() => {
        if (!cancelled) setChangelogError(true);
      })
      .finally(() => {
        if (!cancelled) setChangelogLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Keyed on `releasedAt` as well as the id, so publishing re-reads the
    // now-frozen copy rather than showing the live one it replaced.
  }, [release?.id, release?.releasedAt]);

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

  const handleSaveToFolio = async (title: string) => {
    if (!project || !changelog || !release) return;
    setFolioSaving(true);
    try {
      await folioApi.create({
        body: {
          projectId: project.id,
          title,
          content: changelog.markdown,
          summary: tr("release.folio.summary", {
            args: [
              release.tag ?? String(release.number),
              String(changelog.stats.questCount),
            ],
          }) as string,
        },
      });
      setFolioOpen(false);
      toaster.success(tr("release.folio.saved"));
    } catch {
      // Dialog stays open so the typed title is not lost.
      toaster.error(tr("release.folio.error"));
    } finally {
      setFolioSaving(false);
    }
  };

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
  const tabs: Array<ReleaseTab<TabKey>> = [
    {
      value: "overview",
      label: String(tr("release.tab.overview")),
      icon: Gauge,
    },
    {
      value: "contents",
      label: String(tr("release.tab.contents")),
      icon: ListTree,
      count: contents
        ? contents.epics.length + contents.looseQuests.length
        : undefined,
    },
    {
      value: "changelog",
      label: String(tr("release.tab.changelog")),
      icon: ScrollText,
    },
    {
      value: "artifacts",
      label: String(tr("release.tab.artifacts")),
      icon: Package,
      count: artifacts.length,
    },
  ];

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="bg-card/30 border-border shrink-0 border-b">
        <ReleasePlate
          release={release}
          epicCount={contents?.epics.length ?? 0}
          artifactCount={artifacts.length}
          onEdit={() => setEditOpen(true)}
          onChanged={() => void reload()}
        />
        <ReleaseTabBar tabs={tabs} value={tab} onChange={setTab} />
      </div>

      {/* The changelog owns its own scroll region - it has a sticky toolbar
          and a reading measure - so it is mounted outside this wrapper rather
          than inside it. */}
      {tab === "changelog" ? (
        <ReleaseChangelogPanel
          groups={changelog?.groups ?? []}
          statusLabel={String(
            published
              ? tr("release.changelog.frozen", {
                  args: [
                    release.tag ?? String(release.number),
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
          onSaveToFolio={() => setFolioOpen(true)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "overview" && (
            <ReleaseOverviewTab
              release={release}
              artifactCount={artifacts.length}
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
              onChanged={() => void reloadAll()}
            />
          )}
        </div>
      )}

      {/* Beside the tab bodies, not inside one: a drawer portals out anyway,
          and nesting it in a tab body would unmount it on a tab switch. */}
      <ReleaseEditSheet
        release={release}
        artifactCount={artifacts.length}
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
              args: [release.tag ?? String(release.number), release.title],
            })}
            saving={folioSaving}
            onConfirm={handleSaveToFolio}
            onCancel={() => setFolioOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectRelease;
