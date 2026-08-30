import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Dices, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { Release } from "@/api/entities/releases.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { ReleaseChangelogArea } from "@/api/schemas/releaseChangelogAreaSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ProjectReleasesCloseModal from "./ProjectReleasesCloseModal.tsx";
import ProjectReleasesDetail from "./ProjectReleasesDetail.tsx";
import ReleaseChangelogPanel from "./ReleaseChangelogPanel.tsx";
import ReleaseClosedRail from "./ReleaseClosedRail.tsx";
import ReleaseEmptyBanner from "./ReleaseEmptyBanner.tsx";
import ReleaseLedgerHero from "./ReleaseLedgerHero.tsx";
import ReleaseOpenQuestsRail from "./ReleaseOpenQuestsRail.tsx";
import ReleaseSaveToFolioDialog from "./ReleaseSaveToFolioDialog.tsx";
import ReleaseTagInput from "./ReleaseTagInput.tsx";

export type ReleaseWithCount = Release & { questCount: number };

interface ChangelogState {
  markdown: string;
  areas: ReleaseChangelogArea[];
  stats: { questCount: number; areaCount: number; contributorCount: number };
}

interface BacklogState {
  count: number;
  since?: string;
  lastNumber?: number;
  lastTitle?: string;
}

/**
 * The Releases page — a ledger. The active release gets a hero band, its
 * changelog fills the page, and a right rail carries what is still open and
 * what has already shipped.
 *
 * The changelog is always shown for *something*: the recording release
 * when there is one, otherwise the most recently closed. A page whose main
 * column is blank until you press a button teaches nothing about what
 * releases are for.
 */
const ProjectReleases = () => {
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [releases, setReleases] = useStore(currentReleasesAtom);
  const releaseApi = useClient<ReleaseController>();
  const questApi = useClient<QuestController>();
  const folioApi = useClient<FolioController>();

  const [startOpen, setStartOpen] = useState(false);
  const [startTitle, setStartTitle] = useState("");
  const [startDescription, setStartDescription] = useState("");
  const [startTags, setStartTags] = useState<string[]>([]);
  const [closeModal, setCloseModal] = useState<ReleaseWithCount | null>(null);
  const [detailRelease, setDetailRelease] = useState<ReleaseWithCount | null>(
    null,
  );
  const [folioOpen, setFolioOpen] = useState(false);
  const [folioSaving, setFolioSaving] = useState(false);

  const [changelog, setChangelog] = useState<ChangelogState | null>(null);
  const [changelogLoading, setChangelogLoading] = useState(true);
  const [changelogError, setChangelogError] = useState(false);
  const [backlog, setBacklog] = useState<BacklogState | null>(null);
  const [openQuests, setOpenQuests] = useState<QuestResource[]>([]);

  const activeRelease = releases?.find((c) => !c.closedAt) as
    | ReleaseWithCount
    | undefined;

  const closedReleases = useMemo(
    () => ((releases ?? []) as ReleaseWithCount[]).filter((c) => c.closedAt),
    [releases],
  );

  /**
   * Whichever release the changelog panel is showing: the recording one,
   * or the last closed one as a fallback so the panel is never empty for a
   * project that has shipped before.
   */
  const shownRelease = activeRelease ?? closedReleases[0];

  const reload = useCallback(async () => {
    if (!project) return;
    const updated = await releaseApi.getReleases({
      params: { projectId: project.id },
    });
    setReleases(updated as ReleaseWithCount[]);
  }, [project?.id]);

  // Changelog for whichever release is on screen.
  useEffect(() => {
    if (!shownRelease) {
      // Early return of the loader below — nothing to fetch, so nothing to show.
      // oxlint-disable-next-line react/set-state-in-effect
      setChangelog(null);
      setChangelogLoading(false);
      return;
    }
    let cancelled = false;
    setChangelogLoading(true);
    setChangelogError(false);
    releaseApi
      .getReleaseChangelog({ params: { id: shownRelease.id } })
      .then((res) => {
        if (cancelled) return;
        setChangelog({
          markdown: res.markdown,
          areas: res.areas,
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
  }, [shownRelease?.id, shownRelease?.closedAt]);

  // Backlog only matters while nothing is recording.
  useEffect(() => {
    if (!project || activeRelease) {
      // Early return of the loader below — nothing to fetch, so nothing to show.
      // oxlint-disable-next-line react/set-state-in-effect
      setBacklog(null);
      return;
    }
    let cancelled = false;
    releaseApi
      .getReleaseBacklog({ params: { projectId: project.id } })
      .then((res) => {
        // A failed backlog fetch hides the sentence rather than breaking
        // the empty state, so there is no error branch here.
        if (!cancelled) setBacklog(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project?.id, activeRelease?.id]);

  // "Still open" rail: accepted but not yet completed.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    questApi
      .getQuests({
        params: { projectId: project.id },
        query: { status: "accepted", size: 8, sort: "-updatedAt" },
      })
      .then((page) => {
        if (!cancelled) setOpenQuests(page.content);
      })
      // A rail beside the release list, like the backlog sentence above:
      // a failed fetch hides it rather than breaking the page around it.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project?.id, releases]);

  /**
   * Roll the suggested name *before* the dialog opens. Opening first and
   * awaiting the roll meant the response landed after the field was already
   * focused, overwriting whatever had been typed in the meantime.
   */
  const openStart = async () => {
    setStartDescription("");
    setStartTags([]);
    setStartTitle("");
    await reroll();
    setStartOpen(true);
  };

  const reroll = async () => {
    const { title } = await releaseApi.getRandomReleaseName();
    setStartTitle(title);
  };

  const handleStart = async () => {
    if (!project) return;
    try {
      await releaseApi.startRelease({
        params: { projectId: project.id },
        body: {
          title: startTitle.trim() || undefined,
          description: startDescription.trim() || undefined,
          tags: startTags,
        },
      });
      setStartOpen(false);
      await reload();
    } catch {
      // Dialog stays open so the typed title and notes are not lost — same
      // reasoning as `handleSaveToFolio` below.
      toaster.error(tr("release.start.error"));
    }
  };

  const handleClose = async (id: number, title: string) => {
    try {
      await releaseApi.closeRelease({ params: { id }, body: { title } });
      setCloseModal(null);
      await reload();
    } catch {
      // Modal stays open: closing a release is not undoable, so a failure
      // has to read as "it did not happen" rather than as a dismissal.
      toaster.error(tr("release.close.error"));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await releaseApi.deleteRelease({ params: { id } });
      await reload();
    } catch {
      toaster.error(tr("release.delete.error"));
    }
  };

  const handleDetailUpdated = (updated: Release) => {
    setReleases(
      ((releases ?? []) as ReleaseWithCount[]).map((c) =>
        c.id === updated.id ? ({ ...c, ...updated } as ReleaseWithCount) : c,
      ),
    );
    setDetailRelease((prev) =>
      prev && prev.id === updated.id ? { ...prev, ...updated } : prev,
    );
  };

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
    if (!changelog || !shownRelease) return;
    const blob = new Blob([changelog.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `release-${shownRelease.number}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToFolio = async (title: string) => {
    if (!project || !changelog || !shownRelease) return;
    setFolioSaving(true);
    try {
      await folioApi.create({
        body: {
          projectId: project.id,
          title,
          content: changelog.markdown,
          summary: tr("release.folio.summary", {
            args: [
              String(shownRelease.number),
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

  const projectSlug = project.slug;
  const settingsHref = router.path("projectSettingsReleases", {
    params: { projectSlug },
  });
  const questsHref = router.path("projectQuests", { params: { projectSlug } });

  // Same wording the settings page offers, so the banner and the setting
  // never disagree on what "auto-close" is currently set to.
  const autoCloseLabel = String(
    project.milestoneDuration === "P7D"
      ? tr("project.settings.releases.duration.1w")
      : project.milestoneDuration === "P14D"
        ? tr("project.settings.releases.duration.2w")
        : project.milestoneDuration === "P1M"
          ? tr("project.settings.releases.duration.1mo")
          : project.milestoneDuration === "P3M"
            ? tr("project.settings.releases.duration.3mo")
            : tr("project.settings.releases.duration.manual"),
  );

  const statusLabel = !shownRelease
    ? tr("release.changelog.none")
    : shownRelease.closedAt
      ? tr("release.changelog.frozen", {
          args: [
            String(shownRelease.number),
            String(i18n.l(shownRelease.closedAt, { date: "ll" })),
          ],
        })
      : tr("release.changelog.live", {
          args: [String(changelog?.stats.questCount ?? 0)],
        });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* No page header. The breadcrumb already reads "… › Releases", and
          the two controls that lived here were both redundant: Auto-close
          settings pointed at the same route as the banner's own `change`
          link, and Close Release now sits on the hero, opposite where
          Start Release sits on the empty banner. Both banner states are
          full-bleed so they occupy the same band under the breadcrumb. */}
      {activeRelease ? (
        <ReleaseLedgerHero
          release={activeRelease}
          questCount={changelog?.stats.questCount ?? activeRelease.questCount}
          areaCount={changelog?.stats.areaCount ?? 0}
          contributorCount={changelog?.stats.contributorCount ?? 0}
          onOpenDetail={() => setDetailRelease(activeRelease)}
          onClose={() => setCloseModal(activeRelease)}
        />
      ) : (
        <ReleaseEmptyBanner
          backlogCount={backlog?.count ?? 0}
          lastLabel={
            backlog?.lastNumber
              ? `#${backlog.lastNumber} ${backlog.lastTitle ?? ""}`.trim()
              : undefined
          }
          lastClosedOn={
            backlog?.since
              ? String(i18n.l(backlog.since, { date: "ll" }))
              : undefined
          }
          autoCloseLabel={autoCloseLabel}
          settingsHref={settingsHref}
          onStart={openStart}
        />
      )}

      <div className="border-border flex min-h-0 flex-1 flex-col border-t xl:flex-row">
        <ReleaseChangelogPanel
          areas={changelog?.areas ?? []}
          statusLabel={String(statusLabel)}
          live={!!activeRelease}
          loading={changelogLoading}
          error={changelogError}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onSaveToFolio={() => setFolioOpen(true)}
        />

        <aside className="border-border flex shrink-0 flex-col overflow-hidden border-t xl:w-[346px] xl:border-t-0 xl:border-l">
          <ReleaseOpenQuestsRail quests={openQuests} questsHref={questsHref} />
          <ReleaseClosedRail
            releases={closedReleases}
            onOpenDetail={setDetailRelease}
            onDelete={handleDelete}
          />
        </aside>
      </div>

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("release.start")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{tr("release.start.title")}</Label>
              <div className="flex gap-2">
                <Input
                  value={startTitle}
                  onChange={(e) => setStartTitle(e.currentTarget.value)}
                  placeholder={tr("release.start.placeholder")}
                  // Autofocus on the field the dialog exists to fill, on open only.
                  // oxlint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void reroll()}
                  aria-label={tr("release.start.reroll")}
                >
                  <Dices className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("release.start.description")}</Label>
              <Textarea
                rows={3}
                value={startDescription}
                onChange={(e) => setStartDescription(e.currentTarget.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("release.tags")}</Label>
              <ReleaseTagInput value={startTags} onChange={setStartTags} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStartOpen(false)}>
                {tr("release.start.cancel")}
              </Button>
              <Button
                onClick={handleStart}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                <Play className="size-4" />
                {tr("release.start")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!closeModal}
        onOpenChange={(o) => !o && setCloseModal(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("release.close.modal.title")}</DialogTitle>
          </DialogHeader>
          {closeModal && (
            <ProjectReleasesCloseModal
              release={closeModal}
              onConfirm={(title) => handleClose(closeModal.id, title)}
              onCancel={() => setCloseModal(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={folioOpen} onOpenChange={(o) => !o && setFolioOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("release.folio.dialogTitle")}</DialogTitle>
          </DialogHeader>
          {shownRelease && (
            <ReleaseSaveToFolioDialog
              defaultTitle={tr("release.folio.defaultTitle", {
                args: [String(shownRelease.number), shownRelease.title],
              })}
              saving={folioSaving}
              onConfirm={handleSaveToFolio}
              onCancel={() => setFolioOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Sheet
        open={!!detailRelease}
        onOpenChange={(o) => !o && setDetailRelease(null)}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-auto p-0 data-[side=right]:sm:max-w-[50vw]"
        >
          <SheetHeader>
            <SheetTitle>
              {detailRelease
                ? tr("release.detail.title", {
                    args: [String(detailRelease.number), detailRelease.title],
                  })
                : ""}
            </SheetTitle>
          </SheetHeader>
          {detailRelease && (
            <div className="p-4">
              <ProjectReleasesDetail
                release={detailRelease}
                onUpdated={handleDetailUpdated}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ProjectReleases;
