import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Circle,
  FileText,
  History,
  Link2,
  ListChecks,
  Paperclip,
  Pencil,
  PiggyBank,
  ScrollText,
  Settings as SettingsIcon,
  Signature,
  SquareCheck,
  StickyNote,
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
import QuestCompletionDialog from "./QuestCompletionDialog.tsx";
import QuestDescription from "./QuestDescription.tsx";
import QuestHistory from "./QuestHistory.tsx";
import QuestSummaryEditDialog from "./QuestSummaryEditDialog.tsx";
import QuestViewCollapsibleBlock from "./QuestViewCollapsibleBlock.tsx";
import QuestViewDuplicateButton from "./QuestViewDuplicateButton.tsx";
import QuestViewEditButton from "./QuestViewEditButton.tsx";
import QuestViewNotes from "./QuestViewNotes.tsx";
import QuestViewObjectives from "./QuestViewObjectives.tsx";
import QuestViewSettings from "./QuestViewSettings.tsx";
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
  const dt = useInject(DateTimeProvider);
  const [showDialog, setShowDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showEditSummary, setShowEditSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [quest, setQuest] = useState<QuestResource>(props.quest);
  const [questline, setQuestline] = useState<{
    predecessor?: {
      id: number;
      shortId: number;
      title: string;
      completedAt?: string;
    };
    dependents: Array<{
      id: number;
      shortId: number;
      title: string;
      completedAt?: string;
    }>;
  }>({ dependents: [] });

  useEffect(() => {
    setQuest(props.quest);
  }, [props.quest]);

  // Pull predecessor + dependents whenever the quest identity flips
  // (route change or duplicate spawn). Cheap — at most a few rows.
  useEffect(() => {
    let alive = true;
    questApi
      .getQuestLine({ params: { id: quest.id } })
      .then((data) => {
        if (alive) setQuestline(data);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [quest.id]);

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
                  {/* Note + Reminder moved into the Settings block at
                      the bottom of the view (Lore quest #42). */}
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

          {/* Tags — read-only chips. Edit lives in the quest edit dialog. */}
          {quest.tags && quest.tags.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {quest.tags.map((tag) => (
                <Link
                  key={tag}
                  href={router.path("campaignBoard", {
                    params: { campaignId: String(quest.campaignId) },
                    query: { tag },
                  })}
                  className="bg-muted hover:bg-muted/70 rounded-sm border px-1.5 py-0.5 font-mono text-xs"
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}

          {/* Questline (Lore #32) — predecessor + dependents.
              Blocked-by flips to Unblocked once the predecessor closes;
              dependents are surfaced as a backlink list. */}
          {(questline.predecessor || questline.dependents.length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
              {questline.predecessor && (
                <Link
                  href={router.path("campaignQuest", {
                    params: {
                      campaignId: String(quest.campaignId),
                      shortId: String(questline.predecessor.shortId),
                    },
                  })}
                  className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 ${
                    questline.predecessor.completedAt
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-600"
                  }`}
                >
                  {questline.predecessor.completedAt ? (
                    <SquareCheck className="size-3" />
                  ) : (
                    <Link2 className="size-3" />
                  )}
                  {questline.predecessor.completedAt
                    ? tr("quest.view.questline.unblocked", {
                        args: [String(questline.predecessor.shortId)],
                      })
                    : tr("quest.view.questline.blockedBy", {
                        args: [String(questline.predecessor.shortId)],
                      })}
                  <span className="text-muted-foreground">
                    {questline.predecessor.title}
                  </span>
                </Link>
              )}
              {questline.dependents.map((dep) => (
                <Link
                  key={dep.id}
                  href={router.path("campaignQuest", {
                    params: {
                      campaignId: String(quest.campaignId),
                      shortId: String(dep.shortId),
                    },
                  })}
                  className="bg-muted hover:bg-muted/70 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5"
                >
                  <Link2 className="size-3 rotate-90" />
                  {tr("quest.view.questline.unlocks", {
                    args: [String(dep.shortId)],
                  })}
                  <span className="text-muted-foreground">{dep.title}</span>
                </Link>
              ))}
            </div>
          )}

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

          {/* Completion summary — visible on completed quests. Owners /
              creators (the only allowed editors server-side) can amend
              the message; the data model carries an `editedAt` stamp so
              the UI can surface "edited X ago" honestly. */}
          {quest.completedAt && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <SectionHeader
                  icon={<ScrollText className="size-5" />}
                  label={String(tr("quest.view.completionSummary"))}
                />
                {questApi.updateQuestById.can() && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={String(tr("quest.view.editSummary.title"))}
                    onClick={() => setShowEditSummary(true)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
              </div>
              {quest.completionMessage ? (
                <div className="bg-muted border-border flex flex-col gap-2 rounded-md border p-3 px-4">
                  <MarkdownView content={quest.completionMessage} />
                  {quest.completionMessageUpdatedAt &&
                    quest.completedAt &&
                    quest.completionMessageUpdatedAt !== quest.completedAt && (
                      <span className="text-muted-foreground text-xs italic">
                        {tr("quest.view.completionSummary.edited", {
                          args: [
                            dt.of(quest.completionMessageUpdatedAt).fromNow(),
                          ],
                        })}
                      </span>
                    )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowEditSummary(true)}
                  className="bg-muted border-border text-muted-foreground rounded-md border p-3 px-4 text-left text-sm italic hover:underline"
                >
                  {tr("quest.view.completionSummary.empty")}
                </button>
              )}
            </div>
          )}

          {/* Objectives (collapsible, default expanded) */}
          {quest.objectives.length > 0 && (
            <QuestViewCollapsibleBlock
              icon={<ListChecks className="size-5" />}
              label={String(tr("quest.view.objectives"))}
              defaultOpen
            >
              <QuestViewObjectives
                quest={quest}
                onQuestUpdate={(updatedQuest) => {
                  updateQuest(updatedQuest);
                  alepha.store.set(currentQuestAtom, updatedQuest);
                }}
              />
            </QuestViewCollapsibleBlock>
          )}

          {/* Attachments — kept non-collapsible; only shown when present */}
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

          {/* Notes — first-class quest field (was buried under Settings). */}
          {!quest.completedAt && questApi.updateQuestNote.can() && (
            <QuestViewCollapsibleBlock
              icon={<StickyNote className="size-5" />}
              label={String(tr("quest.view.notes"))}
              defaultOpen={!!quest.note}
            >
              <QuestViewNotes
                quest={quest}
                onUpdate={(it) => {
                  updateQuest(it);
                  alepha.store.set(currentQuestAtom, it);
                }}
              />
            </QuestViewCollapsibleBlock>
          )}

          {/* Rewards (collapsible, default expanded) */}
          <QuestViewCollapsibleBlock
            icon={<PiggyBank className="size-5" />}
            label={String(tr("quest.view.rewards"))}
            defaultOpen
          >
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
          </QuestViewCollapsibleBlock>

          {/* History (collapsible, default collapsed) */}
          <QuestViewCollapsibleBlock
            icon={<History className="size-5" />}
            label={String(tr("quest.view.history"))}
          >
            <QuestHistory quest={quest} />
          </QuestViewCollapsibleBlock>

          {/* Settings — Note + Reminder live here (Lore #42).
              Default collapsed; user opts in to configure. */}
          {!quest.completedAt && (
            <QuestViewCollapsibleBlock
              icon={<SettingsIcon className="size-5" />}
              label={String(tr("quest.view.settings"))}
            >
              <QuestViewSettings
                quest={quest}
                onUpdate={(it) => {
                  updateQuest(it);
                  alepha.store.set(currentQuestAtom, it);
                }}
              />
            </QuestViewCollapsibleBlock>
          )}
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
                    onClick={() => setShowCompleteDialog(true)}
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
      <QuestSummaryEditDialog
        open={showEditSummary}
        onOpenChange={(open) => {
          if (!savingSummary) setShowEditSummary(open);
        }}
        initialValue={quest.completionMessage}
        submitting={savingSummary}
        onSave={async (message) => {
          setSavingSummary(true);
          try {
            const updated = await questApi.updateQuestById({
              params: { id: quest.id },
              body: { completionMessage: message },
            });
            updateQuest(updated);
            alepha.store.set(currentQuestAtom, updated);
            setShowEditSummary(false);
          } finally {
            setSavingSummary(false);
          }
        }}
      />
      <QuestCompletionDialog
        open={showCompleteDialog}
        onOpenChange={(open) => {
          if (!completing) setShowCompleteDialog(open);
        }}
        submitting={completing}
        onConfirm={async (message) => {
          setCompleting(true);
          try {
            const { character, ...updatedQuest } = await questApi.completeQuest(
              {
                params: { id: quest.id },
                body: { message },
              },
            );
            updateQuest(updatedQuest);
            alepha.store.set(currentCampaignCharacterAtom, character);
            alepha.store.set(
              currentAssignedQuestsAtom,
              (alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
                (t) => t.id !== quest.id,
              ),
            );
            setShowCompleteDialog(false);
            handleClose();
          } finally {
            setCompleting(false);
          }
        }}
      />
    </Card>
  );
};

export default QuestView;
