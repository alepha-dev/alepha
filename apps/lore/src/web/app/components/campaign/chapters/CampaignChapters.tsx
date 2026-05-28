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
import type { ChapterController } from "@/api/controllers/ChapterController.ts";
import type { Chapter } from "@/api/entities/chapters.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { currentChaptersAtom } from "@/web/app/atoms/currentChaptersAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignChaptersCloseModal from "./CampaignChaptersCloseModal.tsx";
import CampaignChaptersDetail from "./CampaignChaptersDetail.tsx";
import CampaignChaptersRow from "./CampaignChaptersRow.tsx";
import ChapterHero from "./ChapterHero.tsx";
import ChapterTagInput from "./ChapterTagInput.tsx";

export type ChapterWithCount = Chapter & { questCount: number };

const CampaignChapters = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [campaign] = useStore(currentCampaignAtom);
  const [chapters, setChapters] = useStore(currentChaptersAtom);
  const chapterApi = useClient<ChapterController>();
  const [startOpen, setStartOpen] = useState(false);
  const [startTitle, setStartTitle] = useState("");
  const [startDescription, setStartDescription] = useState("");
  const [startTags, setStartTags] = useState<string[]>([]);
  const [closeModal, setCloseModal] = useState<ChapterWithCount | null>(null);
  const [detailChapter, setDetailChapter] = useState<ChapterWithCount | null>(
    null,
  );

  const activeChapter = chapters?.find((c) => !c.closedAt);
  const closedChapters = useMemo(
    () => (chapters ?? []).filter((c) => c.closedAt),
    [chapters],
  );

  const totals = useMemo(() => {
    const totalChapters = chapters?.length ?? 0;
    const totalQuests = (chapters ?? []).reduce(
      (sum, c) => sum + (c.questCount ?? 0),
      0,
    );
    const totalTags = new Set((chapters ?? []).flatMap((c) => c.tags ?? []))
      .size;
    return { totalChapters, totalQuests, totalTags };
  }, [chapters]);

  const reload = useCallback(async () => {
    if (!campaign) return;
    const updated = await chapterApi.getChapters({
      params: { campaignId: campaign.id },
    });
    setChapters(updated as ChapterWithCount[]);
  }, [campaign?.id]);

  const openStart = async () => {
    setStartOpen(true);
    setStartDescription("");
    setStartTags([]);
    await reroll();
  };

  const reroll = async () => {
    const { title } = await chapterApi.getRandomChapterName();
    setStartTitle(title);
  };

  const handleStart = async () => {
    if (!campaign) return;
    await chapterApi.startChapter({
      params: { campaignId: campaign.id },
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
    await chapterApi.closeChapter({
      params: { id },
      body: { title },
    });
    setCloseModal(null);
    await reload();
  };

  const handleDelete = async (id: number) => {
    try {
      await chapterApi.deleteChapter({ params: { id } });
      await reload();
    } catch {
      toaster.error(String(tr("chapter.delete.error")));
    }
  };

  const handleDetailUpdated = (updated: Chapter) => {
    setChapters(
      (chapters ?? []).map((c) =>
        c.id === updated.id ? ({ ...c, ...updated } as ChapterWithCount) : c,
      ),
    );
    setDetailChapter((prev) =>
      prev && prev.id === updated.id ? { ...prev, ...updated } : prev,
    );
  };

  if (!campaign) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-10">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
            <BookMarked className="size-3.5" />
            {tr("chapter.page.eyebrow")}
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            {tr("chapter.page.title")}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            {tr("chapter.page.subtitle")}
          </p>
        </header>

        {activeChapter ? (
          <ChapterHero
            chapter={activeChapter as ChapterWithCount}
            onClose={() => setCloseModal(activeChapter as ChapterWithCount)}
            onOpenDetail={() =>
              setDetailChapter(activeChapter as ChapterWithCount)
            }
          />
        ) : (
          <EmptyHero onStart={openStart} />
        )}

        {totals.totalChapters > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <Stat
              icon={<BookMarked className="size-4" />}
              value={totals.totalChapters}
              label={tr("chapter.stats.chapters")}
            />
            <Stat
              icon={<ScrollText className="size-4" />}
              value={totals.totalQuests}
              label={tr("chapter.stats.quests")}
            />
            <Stat
              icon={<Sparkles className="size-4" />}
              value={totals.totalTags}
              label={tr("chapter.stats.tags")}
            />
          </div>
        )}

        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <History className="text-muted-foreground size-4" />
            <h2 className="font-display text-lg font-semibold">
              {tr("chapter.history.title")}
            </h2>
            <span className="text-muted-foreground text-xs">
              ({closedChapters.length})
            </span>
          </div>

          {closedChapters.length === 0 ? (
            <div className="text-muted-foreground rounded-xl border border-dashed py-12 text-center text-sm">
              {tr("chapter.history.empty")}
            </div>
          ) : (
            <div className="flex flex-col">
              {closedChapters.map((chapter, idx) => (
                <CampaignChaptersRow
                  key={chapter.id}
                  chapter={chapter}
                  onDelete={handleDelete}
                  onOpenDetail={setDetailChapter}
                  isLast={idx === closedChapters.length - 1}
                />
              ))}
            </div>
          )}
        </section>

        <Dialog open={startOpen} onOpenChange={setStartOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr("chapter.start")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{tr("chapter.start.title")}</Label>
                <div className="flex gap-2">
                  <Input
                    value={startTitle}
                    onChange={(e) => setStartTitle(e.currentTarget.value)}
                    placeholder={String(tr("chapter.start.placeholder"))}
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reroll()}
                    aria-label={String(tr("chapter.start.reroll"))}
                  >
                    <Dices className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{tr("chapter.start.description")}</Label>
                <Textarea
                  rows={3}
                  value={startDescription}
                  onChange={(e) => setStartDescription(e.currentTarget.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{tr("chapter.tags")}</Label>
                <ChapterTagInput value={startTags} onChange={setStartTags} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStartOpen(false)}>
                  {tr("chapter.start.cancel")}
                </Button>
                <Button
                  onClick={handleStart}
                  className="bg-green-600 text-white hover:bg-green-700"
                >
                  <Play className="size-4" />
                  {tr("chapter.start")}
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
              <DialogTitle>{tr("chapter.close.modal.title")}</DialogTitle>
            </DialogHeader>
            {closeModal && (
              <CampaignChaptersCloseModal
                chapter={closeModal}
                onConfirm={(title) => handleClose(closeModal.id, title)}
                onCancel={() => setCloseModal(null)}
              />
            )}
          </DialogContent>
        </Dialog>

        <Sheet
          open={!!detailChapter}
          onOpenChange={(o) => !o && setDetailChapter(null)}
        >
          <SheetContent
            side="right"
            className="flex w-full flex-col gap-0 overflow-auto p-0 sm:max-w-2xl"
          >
            <SheetHeader>
              <SheetTitle>
                {detailChapter
                  ? tr("chapter.detail.title", {
                      args: [String(detailChapter.number), detailChapter.title],
                    })
                  : ""}
              </SheetTitle>
            </SheetHeader>
            {detailChapter && (
              <div className="p-4">
                <CampaignChaptersDetail
                  chapter={detailChapter}
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
            {tr("chapter.hero.empty.title")}
          </h2>
          <p className="text-muted-foreground max-w-xl text-sm">
            {tr("chapter.hero.empty.subtitle")}
          </p>
        </div>
        <Button
          onClick={props.onStart}
          size="lg"
          className="bg-green-600 px-8 text-white hover:bg-green-700"
        >
          <Play className="size-4" />
          {tr("chapter.start")}
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

export default CampaignChapters;
