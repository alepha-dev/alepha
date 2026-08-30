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
import { Library, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { Release } from "@/api/entities/releases.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { ReleaseChangelogGroup } from "@/api/schemas/releaseChangelogGroupSchema.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ProjectReleasesCloseModal from "./ProjectReleasesCloseModal.tsx";
import ProjectReleasesDetail from "./ProjectReleasesDetail.tsx";
import ReleaseChangelogPanel from "./ReleaseChangelogPanel.tsx";
import ReleaseClosedRail from "./ReleaseClosedRail.tsx";
import ReleaseLedgerHero from "./ReleaseLedgerHero.tsx";
import ReleaseOpenQuestsRail from "./ReleaseOpenQuestsRail.tsx";
import ReleaseSaveToFolioDialog from "./ReleaseSaveToFolioDialog.tsx";

interface ChangelogState {
  markdown: string;
  groups: ReleaseChangelogGroup[];
  stats: { questCount: number; areaCount: number; contributorCount: number };
}

/**
 * The Releases page — a ledger. An open release gets a hero band, its
 * changelog fills the page, and a right rail carries what is still open and
 * what has already shipped.
 *
 * The changelog is always shown for *something*: the open release when there
 * is one, otherwise the most recently closed. A page whose main column is
 * blank until you press a button teaches nothing about what releases are for.
 *
 * ⚠️ It still shows exactly ONE open release, which is now a lie the model
 * allows: the one-open-at-a-time guard was deleted with the recorder, so
 * `0.28.0` and `1.0.0` can coexist and this picks whichever comes first. The
 * list page that renders all of them is #1557; nothing here is worth
 * rebuilding twice in between.
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
  const [startTag, setStartTag] = useState("");
  const [startTitle, setStartTitle] = useState("");
  const [startDescription, setStartDescription] = useState("");
  const [closeModal, setCloseModal] = useState<ReleaseResource | null>(null);
  const [detailRelease, setDetailRelease] = useState<ReleaseResource | null>(
    null,
  );
  const [folioOpen, setFolioOpen] = useState(false);
  const [folioSaving, setFolioSaving] = useState(false);

  const [changelog, setChangelog] = useState<ChangelogState | null>(null);
  const [changelogLoading, setChangelogLoading] = useState(true);
  const [changelogError, setChangelogError] = useState(false);
  const [openQuests, setOpenQuests] = useState<QuestResource[]>([]);

  const openRelease = releases?.find((c) => !c.releasedAt);

  const closedReleases = useMemo(
    () => (releases ?? []).filter((c) => c.releasedAt),
    [releases],
  );

  /**
   * Whichever release the changelog panel is showing: the recording one,
   * or the last closed one as a fallback so the panel is never empty for a
   * project that has shipped before.
   */
  const shownRelease = openRelease ?? closedReleases[0];

  const reload = useCallback(async () => {
    if (!project) return;
    const updated = await releaseApi.getReleases({
      params: { projectId: project.id },
    });
    setReleases(updated as ReleaseResource[]);
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
  }, [shownRelease?.id, shownRelease?.releasedAt]);

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
      // A rail beside the release list: a failed fetch hides it rather than
      // breaking the page around it.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project?.id, releases]);

  /**
   * The title starts empty and the author types it. It used to be pre-filled
   * by a server round-trip to a fantasy-name generator ("Wrath of the
   * Thornwall"); a release is called `0.28.0`, and no generator can guess
   * that.
   */
  const openStart = () => {
    setStartDescription("");
    setStartTag("");
    setStartTitle("");
    setStartOpen(true);
  };

  const handleStart = async () => {
    if (!project) return;
    const tag = startTag.trim();
    if (!tag) return;
    try {
      await releaseApi.createRelease({
        params: { projectId: project.id },
        body: {
          tag,
          // Omitted rather than sent empty: the server defaults the title to
          // the tag, which is what `0.28.0` should read as.
          title: startTitle.trim() || undefined,
          description: startDescription.trim() || undefined,
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
      await releaseApi.publishRelease({ params: { id }, body: { title } });
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

  // The detail sheet PATCHes the row and gets back a plain release, with no
  // progress on it: `updateRelease` edits fields, it does not recount. Merged
  // over the existing resource so the rollup already on screen survives an
  // unrelated rename.
  const handleDetailUpdated = (updated: Release) => {
    setReleases(
      (releases ?? []).map((c) =>
        c.id === updated.id ? { ...c, ...updated } : c,
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
  const questsHref = router.path("projectQuests", { params: { projectSlug } });

  const statusLabel = !shownRelease
    ? tr("release.changelog.none")
    : shownRelease.releasedAt
      ? tr("release.changelog.frozen", {
          args: [
            shownRelease.tag ?? String(shownRelease.number),
            String(i18n.l(shownRelease.releasedAt, { date: "ll" })),
          ],
        })
      : tr("release.changelog.live", {
          args: [String(changelog?.stats.questCount ?? 0)],
        });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* No page header. The breadcrumb already reads "… › Releases", and
          Close Release sits on the hero, opposite where New Release sits on
          the empty band. Both states are full-bleed so they occupy the same
          band under the breadcrumb. */}
      {openRelease ? (
        <ReleaseLedgerHero
          release={openRelease}
          questCount={changelog?.stats.questCount ?? 0}
          areaCount={changelog?.stats.areaCount ?? 0}
          contributorCount={changelog?.stats.contributorCount ?? 0}
          onOpenDetail={() => setDetailRelease(openRelease)}
          onClose={() => setCloseModal(openRelease)}
        />
      ) : (
        // Deliberately plain. The band it replaced counted the quests that
        // had completed since the last close and named what they were falling
        // out of - the whole "nothing is recording" story, which only made
        // sense while membership was a time window. Nothing falls through a
        // gap now: a quest is in a release because someone put it there.
        <div className="bg-card border-border flex flex-col gap-5 border-b px-5 py-5 md:flex-row md:items-center md:gap-6 lg:px-7">
          <div className="bg-muted text-muted-foreground flex size-13 shrink-0 items-center justify-center rounded-xl">
            <Library className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-semibold">
              {tr("release.empty.title")}
            </h2>
            <p className="text-muted-foreground mt-1.5 max-w-2xl text-[13px] text-pretty">
              {tr("release.empty.body")}
            </p>
          </div>
          <Button
            onClick={openStart}
            className="bg-green-600 px-4 text-white hover:bg-green-700"
          >
            <Play className="size-4" />
            {tr("release.start")}
          </Button>
        </div>
      )}

      <div className="border-border flex min-h-0 flex-1 flex-col border-t xl:flex-row">
        <ReleaseChangelogPanel
          groups={changelog?.groups ?? []}
          statusLabel={String(statusLabel)}
          live={!!openRelease}
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
              <Label>{tr("release.start.tag")}</Label>
              {/* The tag, not the title, is what the dialog exists to fill:
                  it is the release's identity and its URL. The title is
                  optional and defaults to it. */}
              <Input
                value={startTag}
                className="font-mono"
                onChange={(e) => setStartTag(e.currentTarget.value)}
                placeholder={tr("release.start.tag.placeholder")}
                // Autofocus on the field the dialog exists to fill, on open only.
                // oxlint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("release.start.title")}</Label>
              <Input
                value={startTitle}
                onChange={(e) => setStartTitle(e.currentTarget.value)}
                placeholder={startTag || tr("release.start.placeholder")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("release.start.description")}</Label>
              <Textarea
                rows={3}
                value={startDescription}
                onChange={(e) => setStartDescription(e.currentTarget.value)}
              />
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
