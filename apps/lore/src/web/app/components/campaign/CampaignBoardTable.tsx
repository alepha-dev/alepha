import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Link2, Search, Signature, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { User } from "@/api/entities/users.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentAssignedQuestsAtom } from "../../atoms/currentAssignedQuestsAtom.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";
import { UserAvatar } from "../shared/UserAvatar.tsx";
import QuestDifficulty from "./quest/QuestDifficulty.tsx";

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "high":
      return "bg-red-500/15 text-red-600";
    case "medium":
      return "bg-orange-500/15 text-orange-600";
    case "low":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const removeHtmlTags = (text: string) => text.replace(/<[^>]*>/g, "");

/**
 * Board filter shape. Empty by default → "All statuses" (show
 * everything on first load); AlephaTable persists the chosen values per
 * campaign via `persistenceKey` (see #113).
 */
const boardFiltersSchema = t.object({
  search: t.optional(t.string()),
  status: t.optional(t.enum(["new", "accepted", "completed"])),
  zone: t.optional(t.string()),
  tag: t.optional(t.string()),
});

const CampaignBoardTable = () => {
  const alepha = useAlepha();
  const [campaign] = useStore(currentCampaignAtom);
  const questApi = useClient<QuestController>();
  const campaignApi = useClient<CampaignController>();
  const dateFormatter = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [users, setUsers] = useState<Array<User>>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);

  useEffect(() => {
    if (!campaign?.id) return;
    questApi
      .listQuestTags({ query: { campaignId: campaign.id } })
      .then(setKnownTags)
      .catch(() => null);
  }, [campaign?.id]);

  useEffect(() => {
    if (!campaign?.id) return;
    campaignApi
      .getCampaignUsers({ params: { id: campaign.id } })
      .then(setUsers)
      .catch(() => null);
  }, [campaign?.id]);

  const renderAvatar = (userId?: string) => {
    const user = userId ? users.find((u) => u.id === userId) : undefined;
    return (
      <UserAvatar fileId={user?.picture} className="size-6" alt="user avatar" />
    );
  };

  if (!campaign) return null;

  const zoneOptions = (campaign.zones ?? []).map((p) => ({
    label: p,
    value: p,
  }));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <AlephaTable<QuestResource>
        key={campaign.id}
        className="min-h-0 flex-1"
        defaultSize={25}
        emptyMessage={tr("common.noResults")}
        // AlephaTable owns the filter form + toolbar, and persists filter
        // values, column visibility, and sort under this key (replaces the
        // hand-rolled toolbar + localStorage that used to live here).
        persistenceKey={`lor.board.${campaign.id}`}
        filters={{
          schema: boardFiltersSchema,
          render: (form) => (
            <>
              <div className="w-44">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={tr("board.filter.search")}
                  inputProps={{ "aria-label": tr("board.filter.search") }}
                />
              </div>
              <div className="w-44">
                <Control
                  input={form.input.status}
                  label=""
                  clearable
                  clearLabel={tr("board.filter.allStatuses")}
                  triggerClassName="w-full"
                  items={[
                    { label: "New", value: "new" },
                    { label: "Accepted", value: "accepted" },
                    { label: "Completed", value: "completed" },
                  ]}
                  inputProps={{ "aria-label": tr("board.filter.status") }}
                />
              </div>
              {zoneOptions.length > 0 && (
                <div className="w-44">
                  <Control
                    input={form.input.zone}
                    label=""
                    clearable
                    clearLabel={tr("board.filter.allZones")}
                    triggerClassName="w-full"
                    items={zoneOptions}
                    inputProps={{ "aria-label": tr("board.filter.zone") }}
                  />
                </div>
              )}
              {knownTags.length > 0 && (
                <div className="w-44">
                  <Control
                    input={form.input.tag}
                    label=""
                    clearable
                    clearLabel={tr("board.filter.allTags")}
                    triggerClassName="w-full"
                    items={knownTags.map((tag) => ({ label: tag, value: tag }))}
                    inputProps={{ "aria-label": tr("board.filter.tag") }}
                  />
                </div>
              )}
            </>
          ),
        }}
        fetch={async ({ page, size, sort, filters: f }) =>
          questApi.getQuests({
            params: { campaignId: campaign.id },
            query: {
              page,
              size,
              sort,
              search: f?.search || undefined,
              status: f?.status || undefined,
              zone: f?.zone || undefined,
              tag: f?.tag || undefined,
            } as any,
          })
        }
        onRowClick={(quest) =>
          router.push("campaignQuest", {
            params: { shortId: String(quest.shortId) },
          })
        }
        columns={{
          status: {
            label: tr("board.table.status"),
            className: "pl-4",
            cell: (quest: QuestResource) => {
              const colors: Record<string, string> = {
                new: "bg-blue-500",
                accepted: "bg-orange-500",
                completed: "bg-green-500",
              };
              return (
                <span
                  className={`inline-block size-2.5 rounded-full ${colors[quest.metadata.status] ?? "bg-muted"}`}
                />
              );
            },
          },
          assignedTo: {
            label: tr("board.table.assigned"),
            cell: (quest: QuestResource) => {
              if (!quest.acceptedBy) {
                return <span className="text-muted-foreground">-</span>;
              }
              const user = users.find((u) => u.id === quest.acceptedBy);
              return (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    {renderAvatar(quest.acceptedBy)}
                  </TooltipTrigger>
                  <TooltipContent className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {displayName(user, quest.acceptedBy)}
                    </span>
                    {quest.acceptedAt && (
                      <span className="text-muted-foreground text-xs">
                        {`${tr("board.table.assigned")} ${dateFormatter.of(quest.acceptedAt).fromNow()}`}
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            },
          },
          title: {
            label: tr("board.table.title"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <div className="flex flex-col overflow-hidden whitespace-nowrap">
                <span
                  className={`text-sm font-medium ${quest.completedAt ? "text-muted-foreground line-through" : ""}`}
                  title={quest.title}
                >
                  {quest.title.length > 50
                    ? `${quest.title.slice(0, 50)}…`
                    : quest.title}
                </span>
                {quest.description && (
                  <span className="text-muted-foreground truncate text-xs">
                    {removeHtmlTags(quest.description.slice(0, 60))}
                  </span>
                )}
              </div>
            ),
          },
          tags: {
            label: tr("board.table.tags"),
            cell: (quest: QuestResource) =>
              quest.tags && quest.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {quest.tags.map((tag: string) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          linked: {
            label: tr("board.table.linked"),
            // Niche column — starts hidden; users opt in via the column picker.
            defaultHidden: true,
            cell: (quest: QuestResource) =>
              quest.dependsOn ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs" />
                    }
                  >
                    <Link2 className="size-3.5" />#{quest.dependsOn}
                  </TooltipTrigger>
                  <TooltipContent>
                    {tr("board.table.linked.tooltip", {
                      args: [String(quest.dependsOn)],
                    })}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          priority: {
            label: tr("board.table.priority"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <Badge
                variant="secondary"
                className={getPriorityColor(quest.priority)}
              >
                {quest.priority}
              </Badge>
            ),
          },
          difficulty: {
            label: tr("board.table.rank"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <QuestDifficulty difficulty={quest.difficulty} />
            ),
          },
          zone: {
            label: tr("board.table.zone"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-xs">{quest.zone}</span>
            ),
          },
          createdAt: {
            label: tr("board.table.created"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-muted-foreground text-xs">
                {dateFormatter.of(quest.createdAt).fromNow()}
              </span>
            ),
          },
          updatedAt: {
            label: tr("board.table.updated"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-muted-foreground text-xs">
                {dateFormatter.of(quest.updatedAt).fromNow()}
              </span>
            ),
          },
        }}
        rowActions={(quest) => [
          ...(!quest.acceptedAt && questApi.acceptQuest.can()
            ? [
                {
                  icon: Signature,
                  label: tr("board.action.acceptQuest"),
                  onClick: async (
                    _quest: QuestResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    const updated = await questApi.acceptQuest({
                      params: { id: quest.id },
                    });
                    alepha.store.set(currentAssignedQuestsAtom, [
                      ...(alepha.store.get(currentAssignedQuestsAtom) ?? []),
                      updated,
                    ]);
                    refresh();
                  },
                },
              ]
            : []),
          ...(questApi.deleteQuest.can()
            ? [
                {
                  icon: Trash,
                  label: tr("board.action.deleteQuest"),
                  destructive: true,
                  onClick: async (
                    _quest: QuestResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    const confirmed = await dialog.confirm({
                      title: tr("board.confirm-delete-title"),
                      description: tr("board.confirm-delete-message"),
                      destructive: true,
                    });
                    if (!confirmed) return;
                    await questApi.deleteQuest({ params: { id: quest.id } });
                    refresh();
                  },
                },
              ]
            : []),
        ]}
      />
    </div>
  );
};

export default CampaignBoardTable;
