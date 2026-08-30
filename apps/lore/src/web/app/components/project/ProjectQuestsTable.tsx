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
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleDot,
  Link2,
  type LucideIcon,
  MapPin,
  Minus,
  Search,
  Signature,
  Flag,
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
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "../../atoms/currentReleasesAtom.ts";
import { descriptionSnippet } from "../../services/descriptionSnippet.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";
import { useQuestMutations } from "../shared/useQuestMutations.ts";
import { UserAvatar } from "../shared/UserAvatar.tsx";
import { QUEST_PRIORITY_TONE } from "./quest/questChips.ts";
import { formatQuestSize } from "./quest/questSize.ts";

/**
 * The priority glyph. An arrow idiom rather than four differently-coloured
 * dots: the shape says which way the priority points even before the tone
 * registers, which is what makes the column scannable in monochrome.
 */
const PRIORITY_ICONS: Record<QuestResource["priority"], LucideIcon> = {
  high: ChevronsUp,
  medium: ChevronUp,
  low: ChevronDown,
  optional: Minus,
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
  // The release's numeric id, carried as a string because that is what a
  // select's value is. Coerced back on the way into the query.
  release: z.string().optional(),
});

/**
 * The `?status=` values this page understands.
 *
 * Anything else in the URL is dropped rather than rejected: a stale bookmark
 * or a hand-edited link must land on the unfiltered list, not on an error
 * page or an empty table with no visible cause.
 */
const SEEDABLE_STATUSES = ["new", "accepted", "completed", "shelved"] as const;

const ProjectQuestsTable = () => {
  const [project] = useStore(currentProjectAtom);
  const [currentAreas] = useStore(currentAreasAtom);
  const [releases] = useStore(currentReleasesAtom);
  const questApi = useClient<QuestController>();
  const questMutations = useQuestMutations();
  const projectApi = useClient<ProjectController>();
  const dateFormatter = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [users, setUsers] = useState<Array<User>>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);

  /**
   * The status the reader arrived with, if any.
   *
   * Read straight off the route and handed to AlephaTable as `seedValues`,
   * which outranks the persisted filter — a drill-through link that lost to
   * a filter set last week would be a link that does nothing.
   *
   * ⚠️ Read-only. Nothing here writes the filter back to the URL; see the
   * `projectQuests` route for the #156 incident that rule comes from.
   */
  const seededStatus = SEEDABLE_STATUSES.find(
    (status) => status === router.query.status,
  );

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

  if (!project) return null;

  const areaOptions = (currentAreas ?? []).map((a) => ({
    value: a.name,
    label: a.name,
  }));

  // Every release, published included: this is a filter over history, not a
  // picker for an attachment, so hiding what has shipped would make the
  // table unable to answer "what went into 0.27.0".
  const releaseOptions = (releases ?? []).map((r) => ({
    value: String(r.id),
    label: r.tag ?? r.title,
  }));

  return (
    <div
      data-testid="quests-table"
      className="flex flex-1 flex-col overflow-hidden"
    >
      <AlephaTable<QuestResource>
        // The seed is part of the identity: `initialValues` are captured once
        // per mount, and arriving from a different drill-through link on a
        // route the app is already showing would otherwise change nothing.
        key={`${project.id}:${seededStatus ?? ""}`}
        className="min-h-0 flex-1"
        defaultSize={25}
        emptyMessage={tr("common.noResults")}
        // AlephaTable owns the filter form + toolbar, and persists filter
        // values, column visibility, and sort under this key (replaces the
        // hand-rolled toolbar + localStorage that used to live here).
        persistenceKey={`lor.board.${project.id}`}
        filters={{
          schema: boardFiltersSchema,
          seedValues: seededStatus ? { status: seededStatus } : undefined,
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
                  items={(
                    ["new", "accepted", "completed", "shelved"] as const
                  ).map((status) => ({
                    label: String(tr(`quest.status.${status}`)),
                    value: status,
                  }))}
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
              {releaseOptions.length > 0 && (
                <div className="w-44">
                  <Control
                    input={form.input.release}
                    label=""
                    clearable
                    icon={Flag}
                    clearLabel={tr("board.filter.allReleases")}
                    triggerClassName="w-full"
                    items={releaseOptions}
                    inputProps={{ "aria-label": tr("board.filter.release") }}
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
              releaseId: f?.release ? Number(f.release) : undefined,
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
                {/* A real anchor, not a span inside the clickable row: that
                    way the browser owns shift / cmd / middle click, shows the
                    target URL on hover, and offers "copy link address". The
                    router bails on modified clicks without preventDefault, so
                    a new tab opens natively while a plain click still routes
                    in place. Same reasoning as the project switcher's rows
                    (Lore feedback #61).

                    `stopPropagation` because the row carries `onRowClick`
                    too, and without it a plain click navigates twice: once
                    through the anchor, once through the row. It is the guard
                    the table's own checkbox cell already uses. */}
                <Link
                  href={router.path("projectQuest", {
                    params: { shortId: String(quest.shortId) },
                  })}
                  onClick={(e) => e.stopPropagation()}
                  className={`truncate text-sm font-medium ${quest.completedAt ? "text-muted-foreground line-through" : ""}`}
                  title={`#${quest.shortId} - ${quest.title}`}
                >
                  {/* The id carries the title's own colour: it is part of
                      the name, not an annotation on it. Only the separator
                      is muted, same treatment as the quest header. */}
                  #{quest.shortId}{" "}
                  <span className="text-muted-foreground">-</span> {quest.title}
                </Link>
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
            // One line, always. As wrapping chips this column set the row
            // height: a quest with five tags stood three rows tall and threw
            // the whole table's rhythm out, and the tallest row won.
            //
            // `max-w-0` + `truncate` is what actually holds the line. Without
            // the pair the cell claims its content width and the text never
            // reaches the ellipsis, so a long tag list would still push the
            // table wide instead of tall. Same trick the title column uses,
            // and `min-w-24` keeps it from collapsing to nothing.
            className: "max-w-0 min-w-24",
            cell: (quest: QuestResource) =>
              quest.tags && quest.tags.length > 0 ? (
                <span
                  className="text-muted-foreground block truncate text-xs"
                  title={quest.tags.join(", ")}
                >
                  {quest.tags.join(", ")}
                </span>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          releaseId: {
            label: tr("board.table.release"),
            // Niche enough to start hidden, like `linked`: most projects run
            // one release at a time and the filter above answers the common
            // question. The column is for reading a mixed list.
            defaultHidden: true,
            className: "w-28",
            cell: (quest: QuestResource) => {
              const release = releases?.find((r) => r.id === quest.releaseId);
              return release ? (
                <Badge variant="outline" className="font-mono">
                  {release.tag ?? release.title}
                </Badge>
              ) : (
                <span className="text-muted-foreground">-</span>
              );
            },
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
            cell: (quest: QuestResource) => {
              const Icon = PRIORITY_ICONS[quest.priority];
              return (
                <Badge
                  variant="tint"
                  tone={QUEST_PRIORITY_TONE[quest.priority]}
                  className="capitalize"
                >
                  <Icon className="size-3" />
                  {quest.priority}
                </Badge>
              );
            },
          },
          // ⚠️ Sorted on `size`, the INTEGER column, not on the label this
          // cell renders. `sort` is passed straight through to `getQuests`
          // and resolved against the entity, so SQL orders 1..5 and XS..XL
          // come out in the right order for free. Sorting the label instead
          // is exactly the mistake that put `optional` above `high` on the
          // kanban board for its whole life: `priority` is a TEXT enum, which
          // is why the questlog has to carry its own order map for it.
          //
          // Hidden by default. The table is already wide, and `size` has had
          // no reader at all since it replaced `difficulty`, so it earns its
          // place in the picker before it earns a permanent column.
          size: {
            label: tr("board.table.size"),
            sortable: true,
            defaultHidden: true,
            className: "w-20",
            cell: (quest: QuestResource) => {
              const label = formatQuestSize(quest.size);
              return label ? (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {label}
                </Badge>
              ) : null;
            },
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
                    await questMutations.accept(quest.id);
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
                    await questMutations.shelve(quest.id);
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
                    await questMutations.unshelve(quest.id);
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
                    await questMutations.remove(quest.id);
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
