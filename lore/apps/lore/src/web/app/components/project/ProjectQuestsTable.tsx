import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Archive,
  ArchiveRestore,
  CircleDot,
  Link2,
  MapPin,
  Search,
  Signature,
  Tag,
  Trash,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { User } from "@/api/entities/users.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentAreasAtom } from "../../atoms/currentAreasAtom.ts";
import { currentAssignedQuestsAtom } from "../../atoms/currentAssignedQuestsAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { currentQuestCountAtom } from "../../atoms/currentQuestCountAtom.ts";
import { descriptionSnippet } from "../../services/descriptionSnippet.ts";
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

/**
 * Board filter shape. Empty by default → "All statuses", which means
 * everything still in scope: shelved quests are excluded server-side
 * until you ask for them explicitly. AlephaTable persists the chosen
 * values per project via `persistenceKey` (see #113).
 */
const boardFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["new", "accepted", "completed", "shelved"]).optional(),
  area: z.string().optional(),
  tag: z.string().optional(),
});

const ProjectQuestsTable = () => {
  const alepha = useAlepha();
  const [project] = useStore(currentProjectAtom);
  const [currentAreas] = useStore(currentAreasAtom);
  const questApi = useClient<QuestController>();
  const projectApi = useClient<ProjectController>();
  const dateFormatter = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [users, setUsers] = useState<Array<User>>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);

  useEffect(() => {
    if (!project?.id) return;
    questApi
      .listQuestTags({ query: { projectId: project.id } })
      .then(setKnownTags)
      .catch(() => null);
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return;
    projectApi
      .getProjectUsers({ params: { id: project.id } })
      .then(setUsers)
      .catch(() => null);
  }, [project?.id]);

  const renderAvatar = (userId?: string) => {
    const user = userId ? users.find((u) => u.id === userId) : undefined;
    return (
      <UserAvatar fileId={user?.picture} className="size-6" alt="user avatar" />
    );
  };

  /**
   * The sidebar's Quests badge is filled once by the `project` route loader,
   * which does not re-run on a row action. Shelving or deleting from the list
   * changes the number it shows, so refresh it here — otherwise the badge and
   * the table it links to disagree until the next full navigation.
   */
  const reloadQuestCount = async () => {
    if (!project?.id) return;
    await questApi
      .countOpenQuests({ params: { projectId: project.id } })
      .then(({ count }) => alepha.store.set(currentQuestCountAtom, { count }))
      .catch(() => null);
  };

  if (!project) return null;

  const areaOptions = (currentAreas ?? []).map((a) => ({
    value: a.name,
    label: a.name,
  }));

  return (
    <div
      data-testid="quests-table"
      className="flex flex-1 flex-col overflow-hidden"
    >
      <AlephaTable<QuestResource>
        key={project.id}
        className="min-h-0 flex-1"
        defaultSize={25}
        emptyMessage={tr("common.noResults")}
        // AlephaTable owns the filter form + toolbar, and persists filter
        // values, column visibility, and sort under this key (replaces the
        // hand-rolled toolbar + localStorage that used to live here).
        persistenceKey={`lor.board.${project.id}`}
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
                  icon={CircleDot}
                  clearLabel={tr("board.filter.allStatuses")}
                  triggerClassName="w-full"
                  items={[
                    { label: "New", value: "new" },
                    { label: "Accepted", value: "accepted" },
                    { label: "Completed", value: "completed" },
                    { label: "Shelved", value: "shelved" },
                  ]}
                  inputProps={{ "aria-label": tr("board.filter.status") }}
                />
              </div>
              {areaOptions.length > 0 && (
                <div className="w-44">
                  <Control
                    input={form.input.area}
                    label=""
                    clearable
                    icon={MapPin}
                    clearLabel={tr("board.filter.allAreas")}
                    triggerClassName="w-full"
                    items={areaOptions}
                    inputProps={{ "aria-label": tr("board.filter.area") }}
                  />
                </div>
              )}
              {knownTags.length > 0 && (
                <div className="w-44">
                  <Control
                    input={form.input.tag}
                    label=""
                    clearable
                    icon={Tag}
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
            params: { projectId: project.id },
            query: {
              page,
              size,
              sort,
              search: f?.search || undefined,
              status: f?.status || undefined,
              area: f?.area || undefined,
              tag: f?.tag || undefined,
            } as any,
          })
        }
        onRowClick={(quest) =>
          router.push("projectQuest", {
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
                shelved: "bg-muted-foreground/50",
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
            // `w-full max-w-0` is what makes truncation follow the available
            // width instead of a character count: the table is auto-layout,
            // so `max-width: 0` stops this column claiming its content width
            // and `width: 100%` makes it absorb whatever the other columns
            // leave. Without the pair, the column grows to fit the longest
            // title and `text-overflow: ellipsis` never fires.
            //
            // `min-w-48` is the floor the pair needs. Once the other columns'
            // intrinsic widths fill the container there is nothing left for
            // `width: 100%` to claim, and `max-width: 0` then collapses this
            // column to literally zero — at 1024px the titles disappeared
            // entirely and the header overlapped the next one. min-width wins
            // over max-width, so the column stops shrinking there and the
            // table's own `overflow-x-auto` container takes over.
            className: "w-full max-w-0 min-w-48",
            cell: (quest: QuestResource) => (
              <div className="flex flex-col overflow-hidden whitespace-nowrap">
                <span
                  className={`truncate text-sm font-medium ${quest.completedAt ? "text-muted-foreground line-through" : ""}`}
                  title={quest.title}
                >
                  {quest.title}
                </span>
                {quest.description && (
                  <span className="text-muted-foreground truncate text-xs">
                    {descriptionSnippet(quest.description)}
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
          area: {
            label: tr("board.table.area"),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-xs">{quest.area}</span>
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
          ...(!quest.shelvedAt && questApi.shelveQuest.can()
            ? [
                {
                  icon: Archive,
                  label: tr("board.action.shelveQuest"),
                  onClick: async (
                    _quest: QuestResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    // Same warning QuestView gives: shelving a quest others
                    // depend on leaves them blocked with no path forward.
                    // The questline is fetched on click rather than per row —
                    // a table of 25 quests should not cost 25 extra requests
                    // for a menu entry most rows never open.
                    const questline = await questApi
                      .getQuestLine({ params: { id: quest.id } })
                      .catch(() => ({ dependents: [] }));
                    const blocked = questline.dependents.filter(
                      (d) => !d.completedAt,
                    );
                    const confirmed = await dialog.confirm({
                      title: tr("quest.view.shelve.title"),
                      description: blocked.length
                        ? tr("quest.view.shelve.confirmWithDependents", {
                            args: [
                              blocked.map((d) => `#${d.shortId}`).join(", "),
                            ],
                          })
                        : tr("quest.view.shelve.confirm"),
                      confirmLabel: tr("quest.view.shelve.confirmButton"),
                      cancelLabel: tr("common.cancel"),
                    });
                    if (!confirmed) return;
                    await questApi.shelveQuest({ params: { id: quest.id } });
                    await reloadQuestCount();
                    refresh();
                  },
                },
              ]
            : []),
          ...(quest.shelvedAt && questApi.unshelveQuest.can()
            ? [
                {
                  icon: ArchiveRestore,
                  label: tr("board.action.unshelveQuest"),
                  onClick: async (
                    _quest: QuestResource,
                    { refresh }: { refresh: () => void },
                  ) => {
                    await questApi.unshelveQuest({ params: { id: quest.id } });
                    await reloadQuestCount();
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
                    await reloadQuestCount();
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

export default ProjectQuestsTable;
