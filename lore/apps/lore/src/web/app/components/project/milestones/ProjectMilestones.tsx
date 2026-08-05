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
import {
  BookMarked,
  Dices,
  History,
  Play,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { MilestoneController } from "@/api/controllers/MilestoneController.ts";
import type { Milestone } from "@/api/entities/milestones.ts";
import { currentMilestonesAtom } from "@/web/app/atoms/currentMilestonesAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import MilestoneHero from "./MilestoneHero.tsx";
import MilestoneTagInput from "./MilestoneTagInput.tsx";
import ProjectMilestonesCloseModal from "./ProjectMilestonesCloseModal.tsx";
import ProjectMilestonesDetail from "./ProjectMilestonesDetail.tsx";
import ProjectMilestonesRow from "./ProjectMilestonesRow.tsx";

export type MilestoneWithCount = Milestone & { questCount: number };

const ProjectMilestones = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const [milestones, setMilestones] = useStore(currentMilestonesAtom);
  const milestoneApi = useClient<MilestoneController>();
  const [startOpen, setStartOpen] = useState(false);
  const [startTitle, setStartTitle] = useState("");
  const [startDescription, setStartDescription] = useState("");
  const [startTags, setStartTags] = useState<string[]>([]);
  const [closeModal, setCloseModal] = useState<MilestoneWithCount | null>(null);
  const [detailMilestone, setDetailMilestone] =
    useState<MilestoneWithCount | null>(null);

  const activeMilestone = milestones?.find((c) => !c.closedAt);
  const closedMilestones = useMemo(
    () => (milestones ?? []).filter((c) => c.closedAt),
    [milestones],
  );

  const totals = useMemo(() => {
    const totalMilestones = milestones?.length ?? 0;
    const totalQuests = (milestones ?? []).reduce(
      (sum, c) => sum + (c.questCount ?? 0),
      0,
    );
    const totalTags = new Set((milestones ?? []).flatMap((c) => c.tags ?? []))
      .size;
    return { totalMilestones, totalQuests, totalTags };
  }, [milestones]);

  const reload = useCallback(async () => {
    if (!project) return;
    const updated = await milestoneApi.getMilestones({
      params: { projectId: project.id },
    });
    setMilestones(updated as MilestoneWithCount[]);
  }, [project?.id]);

  const openStart = async () => {
    setStartOpen(true);
    setStartDescription("");
    setStartTags([]);
    await reroll();
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
    await milestoneApi.closeMilestone({
      params: { id },
      body: { title },
    });
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
      (milestones ?? []).map((c) =>
        c.id === updated.id ? ({ ...c, ...updated } as MilestoneWithCount) : c,
      ),
    );
    setDetailMilestone((prev) =>
      prev && prev.id === updated.id ? { ...prev, ...updated } : prev,
    );
  };

  if (!project) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
            <BookMarked className="size-3.5" />
            {tr("milestone.page.eyebrow")}
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            {tr("milestone.page.title")}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            {tr("milestone.page.subtitle")}
          </p>
        </header>

        {activeMilestone ? (
          <MilestoneHero
            milestone={activeMilestone as MilestoneWithCount}
            onClose={() => setCloseModal(activeMilestone as MilestoneWithCount)}
            onOpenDetail={() =>
              setDetailMilestone(activeMilestone as MilestoneWithCount)
            }
          />
        ) : (
          <EmptyHero onStart={openStart} />
        )}

        {totals.totalMilestones > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <Stat
              icon={<BookMarked className="size-4" />}
              value={totals.totalMilestones}
              label={tr("milestone.stats.milestones")}
            />
            <Stat
              icon={<ScrollText className="size-4" />}
              value={totals.totalQuests}
              label={tr("milestone.stats.quests")}
            />
            <Stat
              icon={<Sparkles className="size-4" />}
              value={totals.totalTags}
              label={tr("milestone.stats.tags")}
            />
          </div>
        )}

        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <History className="text-muted-foreground size-4" />
            <h2 className="font-display text-lg font-semibold">
              {tr("milestone.history.title")}
            </h2>
            <span className="text-muted-foreground text-xs">
              ({closedMilestones.length})
            </span>
          </div>

          {closedMilestones.length === 0 ? (
            <div className="text-muted-foreground rounded-xl border border-dashed py-12 text-center text-sm">
              {tr("milestone.history.empty")}
            </div>
          ) : (
            <div className="flex flex-col">
              {closedMilestones.map((milestone, idx) => (
                <ProjectMilestonesRow
                  key={milestone.id}
                  milestone={milestone}
                  onDelete={handleDelete}
                  onOpenDetail={setDetailMilestone}
                  isLast={idx === closedMilestones.length - 1}
                />
              ))}
            </div>
          )}
        </section>

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
    </div>
  );
};

interface EmptyHeroProps {
  onStart: () => void;
}

const EmptyHero = (props: EmptyHeroProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div className="from-primary/5 via-background to-background relative overflow-hidden rounded-2xl border-2 border-dashed bg-gradient-to-br p-8 md:p-12">
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:gap-8">
        <div className="bg-primary/10 text-primary flex size-16 shrink-0 items-center justify-center rounded-2xl">
          <BookMarked className="size-8" />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <h2 className="font-display text-2xl font-bold md:text-3xl">
            {tr("milestone.hero.empty.title")}
          </h2>
          <p className="text-muted-foreground max-w-xl text-sm">
            {tr("milestone.hero.empty.subtitle")}
          </p>
        </div>
        <Button
          onClick={props.onStart}
          size="lg"
          className="bg-green-600 px-8 text-white hover:bg-green-700"
        >
          <Play className="size-4" />
          {tr("milestone.start")}
        </Button>
      </div>
    </div>
  );
};

interface StatProps {
  icon: React.ReactNode;
  value: number;
  label: string | number;
}

const Stat = (props: StatProps) => (
  <div className="bg-card flex flex-col gap-1 rounded-xl border p-4">
    <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
      {props.icon}
      {props.label}
    </div>
    <div className="font-display text-2xl font-bold">{props.value}</div>
  </div>
);

export default ProjectMilestones;
