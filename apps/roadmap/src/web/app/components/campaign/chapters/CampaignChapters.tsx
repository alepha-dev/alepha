import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BookOpen, Play, Square } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ChapterController } from "@/api/controllers/ChapterController.ts";
import type { Chapter } from "@/api/entities/chapters.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { currentChaptersAtom } from "@/web/app/atoms/currentChaptersAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignChaptersChangelog from "./CampaignChaptersChangelog.tsx";
import CampaignChaptersCloseModal from "./CampaignChaptersCloseModal.tsx";
import CampaignChaptersRow from "./CampaignChaptersRow.tsx";

export type ChapterWithCount = Chapter & { questCount: number };

const CampaignChapters = () => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const [chapters, setChapters] = useStore(currentChaptersAtom);
  const chapterApi = useClient<ChapterController>();
  const [showStartForm, setShowStartForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [changelogModal, setChangelogModal] = useState<{
    markdown: string;
    chapter: Chapter;
  } | null>(null);
  const [closeModal, setCloseModal] = useState<ChapterWithCount | null>(null);

  const activeChapter = chapters?.find((c) => !c.closedAt);

  const reload = useCallback(async () => {
    if (!campaign) return;
    const updated = await chapterApi.getChapters({
      params: { campaignId: campaign.id },
    });
    setChapters(updated as ChapterWithCount[]);
  }, [campaign?.id]);

  const handleStart = async () => {
    if (!campaign) return;
    await chapterApi.startChapter({
      params: { campaignId: campaign.id },
      body: newTitle.trim() ? { title: newTitle.trim() } : {},
    });
    setNewTitle("");
    setShowStartForm(false);
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
      toast.error(String(tr("chapter.delete.error")));
    }
  };

  const handleViewChangelog = async (id: number) => {
    const result = await chapterApi.getChapterChangelog({ params: { id } });
    setChangelogModal({
      markdown: result.markdown,
      chapter: result.chapter,
    });
  };

  if (!campaign) return null;

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <div className="flex flex-col gap-4">
        {/* Active chapter banner */}
        {activeChapter && (
          <Card className="bg-card shadow">
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <BookOpen className="size-5 text-green-600" />
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">
                    {tr("chapter.banner.active")}
                  </span>
                  <span className="text-lg font-bold">
                    {tr("chapter.banner.title", {
                      args: [String(activeChapter.number), activeChapter.title],
                    })}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setCloseModal(activeChapter as ChapterWithCount)}
              >
                <Square className="size-4" />
                {tr("chapter.close")}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Start new chapter */}
        {!activeChapter && (
          <Card className="bg-card shadow">
            <CardContent className="p-4">
              {showStartForm ? (
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label>{tr("chapter.start.title")}</Label>
                    <Input
                      placeholder={String(tr("chapter.start.placeholder"))}
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleStart();
                      }}
                      autoFocus
                    />
                  </div>
                  <Button
                    onClick={handleStart}
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    {tr("chapter.start")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowStartForm(false);
                      setNewTitle("");
                    }}
                  >
                    {tr("chapter.start.cancel")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    {tr("chapter.list.noActive")}
                  </span>
                  <Button
                    onClick={() => setShowStartForm(true)}
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    <Play className="size-4" />
                    {tr("chapter.start")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Chapter list */}
        <div className="flex flex-col gap-2">
          <span className="font-semibold">{tr("chapter.list.title")}</span>
          {(!chapters || chapters.length === 0) && (
            <span className="text-muted-foreground text-sm">
              {tr("chapter.list.empty")}
            </span>
          )}
          {chapters?.map((chapter) => (
            <CampaignChaptersRow
              key={chapter.id}
              chapter={chapter}
              onDelete={handleDelete}
              onViewChangelog={handleViewChangelog}
            />
          ))}
        </div>

        {/* Close Chapter Dialog */}
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

        {/* Changelog Dialog */}
        <Dialog
          open={!!changelogModal}
          onOpenChange={(o) => !o && setChangelogModal(null)}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {changelogModal
                  ? tr("chapter.changelog.title", {
                      args: [
                        String(changelogModal.chapter.number),
                        changelogModal.chapter.title,
                      ],
                    })
                  : ""}
              </DialogTitle>
            </DialogHeader>
            {changelogModal && (
              <CampaignChaptersChangelog
                markdown={changelogModal.markdown}
                chapter={changelogModal.chapter}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default CampaignChapters;
