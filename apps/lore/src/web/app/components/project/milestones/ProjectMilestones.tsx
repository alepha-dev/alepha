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
import type { MilestoneController } from "@/api/controllers/MilestoneController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Milestone } from "@/api/entities/milestones.ts";
import type { MilestoneChangelogArea } from "@/api/schemas/milestoneChangelogAreaSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentMilestonesAtom } from "@/web/app/atoms/currentMilestonesAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import MilestoneChangelogPanel from "./MilestoneChangelogPanel.tsx";
import MilestoneEmptyBanner from "./MilestoneEmptyBanner.tsx";
import MilestoneLedgerHero from "./MilestoneLedgerHero.tsx";
import MilestoneOpenQuestsRail from "./MilestoneOpenQuestsRail.tsx";
import MilestoneReleasedRail from "./MilestoneReleasedRail.tsx";
import MilestoneSaveToFolioDialog from "./MilestoneSaveToFolioDialog.tsx";
import MilestoneTagInput from "./MilestoneTagInput.tsx";
import ProjectMilestonesCloseModal from "./ProjectMilestonesCloseModal.tsx";
import ProjectMilestonesDetail from "./ProjectMilestonesDetail.tsx";

export type MilestoneWithCount = Milestone & { questCount: number };

interface ChangelogState {
  markdown: string;
  areas: MilestoneChangelogArea[];
  stats: { questCount: number; areaCount: number; contributorCount: number };
}

interface BacklogState {
  count: number;
  since?: string;
  lastNumber?: number;
  lastTitle?: string;
}

/**
 * The Milestones page — a ledger. The active milestone gets a hero band, its
 * changelog fills the page, and a right rail carries what is still open and
 * what has already shipped.
 *
 * The changelog is always shown for *something*: the recording milestone
 * when there is one, otherwise the most recently closed. A page whose main
 * column is blank until you press a button teaches nothing about what
 * milestones are for.
 */
const ProjectMilestones = () => {
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [milestones, setMilestones] = useStore(currentMilestonesAtom);
  const milestoneApi = useClient<MilestoneController>();
  const questApi = useClient<QuestController>();
  const folioApi = useClient<FolioController>();

  const [startOpen, setStartOpen] = useState(false);
  const [startTitle, setStartTitle] = useState("");
  const [startDescription, setStartDescription] = useState("");
  const [startTags, setStartTags] = useState<string[]>([]);
  const [closeModal, setCloseModal] = useState<MilestoneWithCount | null>(null);
  const [detailMilestone, setDetailMilestone] =
    useState<MilestoneWithCount | null>(null);
  const [folioOpen, setFolioOpen] = useState(false);
  const [folioSaving, setFolioSaving] = useState(false);

  const [changelog, setChangelog] = useState<ChangelogState | null>(null);
  const [changelogLoading, setChangelogLoading] = useState(true);
  const [changelogError, setChangelogError] = useState(false);
  const [backlog, setBacklog] = useState<BacklogState | null>(null);
  const [openQuests, setOpenQuests] = useState<QuestResource[]>([]);

  const activeMilestone = milestones?.find((c) => !c.closedAt) as
    | MilestoneWithCount
    | undefined;

  const closedMilestones = useMemo(
    () =>
      ((milestones ?? []) as MilestoneWithCount[]).filter((c) => c.closedAt),
    [milestones],
  );

  /**
   * Whichever milestone the changelog panel is showing: the recording one,
   * or the last closed one as a fallback so the panel is never empty for a
   * project that has shipped before.
   */
  const shownMilestone = activeMilestone ?? closedMilestones[0];

  const reload = useCallback(async () => {
    if (!project) return;
    const updated = await milestoneApi.getMilestones({
      params: { projectId: project.id },
    });
    setMilestones(updated as MilestoneWithCount[]);
  }, [project?.id]);

  // Changelog for whichever milestone is on screen.
  useEffect(() => {
    if (!shownMilestone) {
      // Early return of the loader below — nothing to fetch, so nothing to show.
      // oxlint-disable-next-line react/set-state-in-effect
      setChangelog(null);
      setChangelogLoading(false);
      return;
    }
    let cancelled = false;
    setChangelogLoading(true);
    setChangelogError(false);
    milestoneApi
      .getMilestoneChangelog({ params: { id: shownMilestone.id } })
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
  }, [shownMilestone?.id, shownMilestone?.closedAt]);

  // Backlog only matters while nothing is recording.
  useEffect(() => {
    if (!project || activeMilestone) {
      // Early return of the loader below — nothing to fetch, so nothing to show.
      // oxlint-disable-next-line react/set-state-in-effect
      setBacklog(null);
      return;
    }
    let cancelled = false;
    milestoneApi
      .getMilestoneBacklog({ params: { projectId: project.id } })
      .then((res) => {
        // A failed backlog fetch hides the sentence rather than breaking
        // the empty state, so there is no error branch here.
        if (!cancelled) setBacklog(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project?.id, activeMilestone?.id]);

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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project?.id, milestones]);

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
    const { title } = await milestoneApi.getRandomMilestoneName();
    setStartTitle(title);
  };

  const handleStart = async () => {
    if (!project) return;
    await milestoneApi.startMilestone({
      params: { projectId: project.id },
      body: {
        title: startTitle.trim() || undefined,
        description: startDescription.trim() || undefined,
        tags: startTags,
      },
    });
    setStartOpen(false);
    await reload();
  };

  const handleClose = async (id: number, title: string) => {
    await milestoneApi.closeMilestone({ params: { id }, body: { title } });
    setCloseModal(null);
    await reload();
  };

  const handleDelete = async (id: number) => {
    try {
      await milestoneApi.deleteMilestone({ params: { id } });
      await reload();
    } catch {
      toaster.error(tr("milestone.delete.error"));
    }
  };

  const handleDetailUpdated = (updated: Milestone) => {
    setMilestones(
      ((milestones ?? []) as MilestoneWithCount[]).map((c) =>
        c.id === updated.id ? ({ ...c, ...updated } as MilestoneWithCount) : c,
      ),
    );
    setDetailMilestone((prev) =>
      prev && prev.id === updated.id ? { ...prev, ...updated } : prev,
    );
  };

  const handleCopy = async () => {
    if (!changelog) return;
    try {
      await navigator.clipboard.writeText(changelog.markdown);
      toaster.success(tr("milestone.changelog.copied"));
    } catch {
      toaster.error(tr("milestone.changelog.copyError"));
    }
  };

  const handleDownload = () => {
    if (!changelog || !shownMilestone) return;
    const blob = new Blob([changelog.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `milestone-${shownMilestone.number}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToFolio = async (title: string) => {
    if (!project || !changelog || !shownMilestone) return;
    setFolioSaving(true);
    try {
      await folioApi.create({
        body: {
          projectId: project.id,
          title,
          content: changelog.markdown,
          summary: tr("milestone.folio.summary", {
            args: [
              String(shownMilestone.number),
              String(changelog.stats.questCount),
            ],
          }) as string,
        },
      });
      setFolioOpen(false);
      toaster.success(tr("milestone.folio.saved"));
    } catch {
      // Dialog stays open so the typed title is not lost.
      toaster.error(tr("milestone.folio.error"));
    } finally {
      setFolioSaving(false);
    }
  };

  if (!project) return null;

  const projectSlug = project.slug;
  const settingsHref = router.path("projectSettingsMilestones", {
    params: { projectSlug },
  });
  const questsHref = router.path("projectQuests", { params: { projectSlug } });

  // Same wording the settings page offers, so the banner and the setting
  // never disagree on what "auto-close" is currently set to.
  const autoCloseLabel = String(
    project.milestoneDuration === "P7D"
      ? tr("project.settings.milestones.duration.1w")
      : project.milestoneDuration === "P14D"
        ? tr("project.settings.milestones.duration.2w")
        : project.milestoneDuration === "P1M"
          ? tr("project.settings.milestones.duration.1mo")
          : project.milestoneDuration === "P3M"
            ? tr("project.settings.milestones.duration.3mo")
            : tr("project.settings.milestones.duration.manual"),
  );

  const statusLabel = !shownMilestone
    ? tr("milestone.changelog.none")
    : shownMilestone.closedAt
      ? tr("milestone.changelog.frozen", {
          args: [
            String(shownMilestone.number),
            String(i18n.l(shownMilestone.closedAt, { date: "ll" })),
          ],
        })
      : tr("milestone.changelog.live", {
          args: [String(changelog?.stats.questCount ?? 0)],
        });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* No page header. The breadcrumb already reads "… › Milestones", and
          the two controls that lived here were both redundant: Auto-close
          settings pointed at the same route as the banner's own `change`
          link, and Close Milestone now sits on the hero, opposite where
          Start Milestone sits on the empty banner. Both banner states are
          full-bleed so they occupy the same band under the breadcrumb. */}
      {activeMilestone ? (
        <MilestoneLedgerHero
          milestone={activeMilestone}
          questCount={changelog?.stats.questCount ?? activeMilestone.questCount}
          areaCount={changelog?.stats.areaCount ?? 0}
          contributorCount={changelog?.stats.contributorCount ?? 0}
          onOpenDetail={() => setDetailMilestone(activeMilestone)}
          onClose={() => setCloseModal(activeMilestone)}
        />
      ) : (
        <MilestoneEmptyBanner
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
        <MilestoneChangelogPanel
          areas={changelog?.areas ?? []}
          statusLabel={String(statusLabel)}
          live={!!activeMilestone}
          loading={changelogLoading}
          error={changelogError}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onSaveToFolio={() => setFolioOpen(true)}
        />

        <aside className="border-border flex shrink-0 flex-col overflow-hidden border-t xl:w-[346px] xl:border-t-0 xl:border-l">
          <MilestoneOpenQuestsRail
            quests={openQuests}
            questsHref={questsHref}
          />
          <MilestoneReleasedRail
            milestones={closedMilestones}
            onOpenDetail={setDetailMilestone}
            onDelete={handleDelete}
          />
        </aside>
      </div>

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("milestone.start")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{tr("milestone.start.title")}</Label>
              <div className="flex gap-2">
                <Input
                  value={startTitle}
                  onChange={(e) => setStartTitle(e.currentTarget.value)}
                  placeholder={tr("milestone.start.placeholder")}
                  // Autofocus on the field the dialog exists to fill, on open only.
                  // oxlint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void reroll()}
                  aria-label={tr("milestone.start.reroll")}
                >
                  <Dices className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("milestone.start.description")}</Label>
              <Textarea
                rows={3}
                value={startDescription}
                onChange={(e) => setStartDescription(e.currentTarget.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("milestone.tags")}</Label>
              <MilestoneTagInput value={startTags} onChange={setStartTags} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStartOpen(false)}>
                {tr("milestone.start.cancel")}
              </Button>
              <Button
                onClick={handleStart}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                <Play className="size-4" />
                {tr("milestone.start")}
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
            <DialogTitle>{tr("milestone.close.modal.title")}</DialogTitle>
          </DialogHeader>
          {closeModal && (
            <ProjectMilestonesCloseModal
              milestone={closeModal}
              onConfirm={(title) => handleClose(closeModal.id, title)}
              onCancel={() => setCloseModal(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={folioOpen} onOpenChange={(o) => !o && setFolioOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("milestone.folio.dialogTitle")}</DialogTitle>
          </DialogHeader>
          {shownMilestone && (
            <MilestoneSaveToFolioDialog
              defaultTitle={tr("milestone.folio.defaultTitle", {
                args: [String(shownMilestone.number), shownMilestone.title],
              })}
              saving={folioSaving}
              onConfirm={handleSaveToFolio}
              onCancel={() => setFolioOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Sheet
        open={!!detailMilestone}
        onOpenChange={(o) => !o && setDetailMilestone(null)}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-auto p-0 data-[side=right]:sm:max-w-[50vw]"
        >
          <SheetHeader>
            <SheetTitle>
              {detailMilestone
                ? tr("milestone.detail.title", {
                    args: [
                      String(detailMilestone.number),
                      detailMilestone.title,
                    ],
                  })
                : ""}
            </SheetTitle>
          </SheetHeader>
          {detailMilestone && (
            <div className="p-4">
              <ProjectMilestonesDetail
                milestone={detailMilestone}
                onUpdated={handleDetailUpdated}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ProjectMilestones;
