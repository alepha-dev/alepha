import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Circle,
  FileText,
  History,
  Paperclip,
  PiggyBank,
  Signature,
  Swords,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { currentCampaignCharacterAtom } from "@/web/app/atoms/currentCampaignCharacterAtom.ts";
import { currentQuestAtom } from "@/web/app/atoms/currentQuestAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import AttachmentBadge from "./AttachmentBadge.tsx";
import QuestDescription from "./QuestDescription.tsx";
import QuestHistory from "./QuestHistory.tsx";
import QuestViewDuplicateButton from "./QuestViewDuplicateButton.tsx";
import QuestViewEditButton from "./QuestViewEditButton.tsx";
import QuestViewNoteButton from "./QuestViewNoteButton.tsx";
import QuestViewObjectives from "./QuestViewObjectives.tsx";
import QuestViewTimer from "./QuestViewTimer.tsx";

export interface QuestViewProps {
  quest: QuestResource;
  onClose?: () => void;
  onQuestChange?: (quest: QuestResource) => void;
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  label: string;
}

const SectionHeader = (props: SectionHeaderProps) => (
  <div className="flex items-center justify-center gap-2">
    {props.icon}
    <span className="text-lg font-bold">{props.label}</span>
    <div className="bg-border h-px w-full opacity-30" />
  </div>
);

const QuestView = (props: QuestViewProps) => {
  const alepha = useAlepha();
  const questApi = useClient<QuestController>();
  const router = useRouter<AppRouter>();
  const info = useInject(CharacterInfo);
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [showDialog, setShowDialog] = useState(false);
  const [quest, setQuest] = useState<QuestResource>(props.quest);

  useEffect(() => {
    setQuest(props.quest);
  }, [props.quest]);

  const [campaign] = useStore(currentCampaignAtom);

  const updateQuest = (updated: QuestResource) => {
    setQuest(updated);
    props.onQuestChange?.(updated);
  };

  const handleClose = () => {
    if (props.onClose) {
      props.onClose();
    } else if (campaign) {
      router.push("campaignBoard", { meta: { deleted: true } });
    }
  };

  const money = info.getMoneyFromQuest(quest);

  const abandonQuest = {
    disabled: !questApi.abandonQuest.can(),
    onClick: async () => {
      const ok = await dialog.confirm({
        title: String(tr("quest.view.abandon.title")),
        description: String(tr("quest.view.abandon.confirm")),
        confirmLabel: String(tr("quest.view.abandon.confirmButton")),
        cancelLabel: String(tr("common.cancel")),
        destructive: true,
      });
      if (!ok) return;

      const updatedQuest = await questApi.abandonQuest({
        params: { id: quest.id },
      });
      updateQuest(updatedQuest);
      alepha.store.set(
        currentAssignedQuestsAtom,
        (alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
          (t) => t.id !== quest.id,
        ),
      );
      handleClose();
    },
  };

  return (
    <Card
      key={quest.id}
      className="m-0.5 flex flex-1 flex-col gap-0 overflow-hidden border-border p-0 shadow"
    >
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="flex flex-1 flex-col gap-6 overflow-auto px-5 py-4">
          {/* Title */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-center gap-2">
              <Tag className="size-5" />
              <span className="font-mono text-xs text-muted-foreground/70">
                #{quest.shortId}
              </span>
              <span className="cinzel-400 whitespace-nowrap text-lg font-bold">
                {quest.title}
              </span>
              {!quest.completedAt && campaign && (
                <>
                  <QuestViewEditButton
                    quest={quest}
                    onUpdate={(it) => {
                      updateQuest(it);
                      alepha.store.set(currentQuestAtom, it);
                    }}
                    showDialog={showDialog}
                    setShowDialog={setShowDialog}
                  />
                  <QuestViewNoteButton
                    quest={quest}
                    onUpdate={(it) => {
                      updateQuest(it);
                      alepha.store.set(currentQuestAtom, it);
                    }}
                  />
                  <QuestViewDuplicateButton quest={quest} />
                </>
              )}
              <div className="bg-border h-px flex-1 opacity-30" />
              <QuestViewTimer
                quest={quest}
                onUpdate={(it) => {
                  updateQuest(it);
                  alepha.store.set(currentQuestAtom, it);
                  const quests =
                    alepha.store.get(currentAssignedQuestsAtom) ?? [];
                  alepha.store.set(
                    currentAssignedQuestsAtom,
                    quests.map((t) => (t.id === it.id ? it : t)),
                  );
                }}
              />
              {props.onClose ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={props.onClose}
                >
                  <X className="size-4" />
                </Button>
              ) : campaign ? (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                >
                  <Link
                    href={router.path("campaignBoard", {
                      params: { campaignId: String(campaign.id) },
                    })}
                  >
                    <X className="size-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
            <span className="text-sm">
              {tr("quest.view.summary", {
                args: [quest.priority, info.getRank(quest.difficulty)],
              })}
            </span>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-2">
            <SectionHeader
              icon={<FileText className="size-5" />}
              label={String(tr("quest.view.description"))}
            />
            <QuestDescription
              quest={quest}
              onEdit={() => setShowDialog(true)}
            />
          </div>

          {/* Objectives */}
          <QuestViewObjectives
            quest={quest}
            onQuestUpdate={(updatedQuest) => {
              updateQuest(updatedQuest);
              alepha.store.set(currentQuestAtom, updatedQuest);
            }}
          />

          {/* Attachments */}
          {quest.attachments && quest.attachments.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionHeader
                icon={<Paperclip className="size-5" />}
                label={String(tr("quest.view.attachments"))}
              />
              <div className="flex flex-wrap gap-2">
                {quest.attachments.map((fileId) => (
                  <AttachmentBadge key={fileId} fileId={fileId} disabled />
                ))}
              </div>
            </div>
          )}

          {/* Rewards */}
          <div className="flex flex-col gap-2">
            <SectionHeader
              icon={<PiggyBank className="size-5" />}
              label={String(tr("quest.view.rewards"))}
            />
            <div className="flex items-center gap-2">
              <span className="text-sm">{tr("quest.view.receive")}</span>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-sm">
                  {info.getGold(money)}
                  <Circle
                    className="size-3"
                    fill="var(--color-gold)"
                    color="var(--color-gold)"
                  />
                </span>
                <span className="flex items-center gap-1 text-sm">
                  {info.getSilver(money)}
                  <Circle
                    className="size-3"
                    fill="var(--color-silver)"
                    color="var(--color-silver)"
                  />
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">{tr("quest.view.experience")}</span>
              <span className="text-sm font-bold">
                {info.getXpFromQuest(quest)} XP
              </span>
            </div>
          </div>

          {/* History */}
          <div className="flex flex-col gap-2">
            <SectionHeader
              icon={<History className="size-5" />}
              label={String(tr("quest.view.history"))}
            />
            <QuestHistory quest={quest} />
          </div>
        </div>

        {!quest.completedAt && (
          <div className="p-2">
            <Card className="bg-muted border-border w-full rounded-md p-2 shadow">
              {!quest.acceptedAt && (
                <div className="flex flex-1 justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-blue-500 hover:text-blue-600"
                    disabled={!questApi.acceptQuest.can()}
                    onClick={async () => {
                      const updatedQuest = await questApi.acceptQuest({
                        params: { id: quest.id },
                      });
                      updateQuest(updatedQuest);
                      alepha.store.set(currentQuestAtom, updatedQuest);
                      alepha.store.set(currentAssignedQuestsAtom, [
                        ...(alepha.store.get(currentAssignedQuestsAtom) ?? []),
                        updatedQuest,
                      ]);
                    }}
                  >
                    <Signature className="size-4" />
                    {tr("quest.view.actions.accept")}
                  </Button>
                </div>
              )}
              {quest.acceptedAt && (
                <div className="flex justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-red-500 hover:text-red-600"
                    {...abandonQuest}
                  >
                    <Trash2 className="size-4" />
                    <span className="hidden sm:inline">
                      {tr("quest.view.actions.abandon")}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-green-600 hover:text-green-700"
                    disabled={
                      !questApi.completeQuest.can() ||
                      quest.objectives.some((o) => !o.completed)
                    }
                    onClick={async () => {
                      const { character, ...updatedQuest } =
                        await questApi.completeQuest({
                          params: { id: quest.id },
                        });
                      updateQuest(updatedQuest);
                      alepha.store.set(currentCampaignCharacterAtom, character);
                      alepha.store.set(
                        currentAssignedQuestsAtom,
                        (
                          alepha.store.get(currentAssignedQuestsAtom) ?? []
                        ).filter((t) => t.id !== quest.id),
                      );
                      handleClose();
                    }}
                  >
                    <Swords className="size-4" />
                    {tr("quest.view.actions.complete")}
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </Card>
  );
};

export default QuestView;
