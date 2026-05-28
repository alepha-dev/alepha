import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useFieldValue, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Columns3,
  FunnelX,
  Link2,
  MoreVertical,
  RefreshCw,
  Search,
  Signature,
  Trash,
  User as UserIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { User } from "@/api/entities/users.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentAssignedQuestsAtom } from "../../atoms/currentAssignedQuestsAtom.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";
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

type BoardFilterValues = {
  search?: string;
  status?: "new" | "accepted" | "completed";
  zone?: string;
  tag?: string;
};

/** Per-user-per-campaign filter persistence via localStorage. The
 *  URL-state experiment from #95 was reverted in #113: URL churn on
 *  every filter change wasn't worth the share-link benefit at our
 *  scale, and the default empty filter set means most loads carry no
 *  query at all. */
const filterStorageKey = (campaignId: number) =>
  `lor.board.filters.${campaignId}`;

/** Column visibility — same persistence pattern as filters. */
const columnsStorageKey = (campaignId: number) =>
  `lor.board.columns.${campaignId}`;

/** Sort persistence — same pattern. */
const sortStorageKey = (campaignId: number) => `lor.board.sort.${campaignId}`;

type SortState = { field: string; direction: "asc" | "desc" } | null;

const readStoredSort = (campaignId: number): SortState => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(sortStorageKey(campaignId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.field === "string" &&
      (parsed.direction === "asc" || parsed.direction === "desc")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

/** Canonical column order + the source of truth for "all columns".
 *  New entries get added here; the toggle menu enumerates this list. */
const COLUMN_IDS = [
  "status",
  "assignedTo",
  "title",
  "tags",
  "linked",
  "priority",
  "difficulty",
  "zone",
  "createdAt",
  "updatedAt",
] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

/** Translation key per column. Used by the Columns toggle menu. */
const COLUMN_LABEL_KEYS: Record<ColumnId, string> = {
  status: "board.table.status",
  assignedTo: "board.table.assigned",
  title: "board.table.title",
  tags: "board.table.tags",
  linked: "board.table.linked",
  priority: "board.table.priority",
  difficulty: "board.table.rank",
  zone: "board.table.zone",
  createdAt: "board.table.created",
  updatedAt: "board.table.updated",
};

/** Columns that start hidden — user opts in via the Columns menu. */
const DEFAULT_HIDDEN_COLUMNS: ReadonlySet<ColumnId> = new Set(["linked"]);
const defaultVisibleColumns = (): Set<ColumnId> =>
  new Set(COLUMN_IDS.filter((id) => !DEFAULT_HIDDEN_COLUMNS.has(id)));

const readStoredVisibleColumns = (
  campaignId: number,
): Set<ColumnId> | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(columnsStorageKey(campaignId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as string[];
    return new Set(
      parsed.filter((c): c is ColumnId =>
        (COLUMN_IDS as readonly string[]).includes(c),
      ),
    );
  } catch {
    return undefined;
  }
};

const readStoredFilters = (
  campaignId: number,
  knownZones: string[],
): BoardFilterValues | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(filterStorageKey(campaignId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as BoardFilterValues;
    // Drop a persisted zone that no longer exists on the campaign so
    // we don't silently hide every quest filtering against a phantom.
    if (parsed.zone && !knownZones.includes(parsed.zone)) {
      parsed.zone = undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
};

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

  // Hydrate from localStorage if anything is stored, otherwise empty
  // (the "All statuses" default — show everything on first load).
  const initialFilterValues = useMemo<BoardFilterValues>(() => {
    if (!campaign?.id) return {};
    return readStoredFilters(campaign.id, campaign.zones ?? []) ?? {};
  }, [campaign?.id]);

  const filters = useForm({
    initialValues: initialFilterValues,
    schema: t.object({
      search: t.optional(t.string()),
      status: t.optional(t.enum(["new", "accepted", "completed"])),
      zone: t.optional(t.string()),
      tag: t.optional(t.string()),
    }),
    handler: async () => {
      // No-op: AlephaTable subscribes to `form:submit:success` and refetches.
    },
  });

  // Persist filter values back to localStorage on every change. Strips
  // empty fields so the stored blob is small and round-trips clean.
  const filterValues = useFormState(filters, ["values"]).values as
    | BoardFilterValues
    | undefined;
  useEffect(() => {
    if (!campaign?.id || !filterValues) return;
    const clean: BoardFilterValues = {};
    if (filterValues.search) clean.search = filterValues.search;
    if (filterValues.status) clean.status = filterValues.status;
    if (filterValues.zone) clean.zone = filterValues.zone;
    if (filterValues.tag) clean.tag = filterValues.tag;
    try {
      if (Object.keys(clean).length === 0) {
        window.localStorage.removeItem(filterStorageKey(campaign.id));
      } else {
        window.localStorage.setItem(
          filterStorageKey(campaign.id),
          JSON.stringify(clean),
        );
      }
    } catch {
      // localStorage may be unavailable (private mode, quota); skip.
    }
  }, [
    campaign?.id,
    filterValues?.search,
    filterValues?.status,
    filterValues?.zone,
    filterValues?.tag,
  ]);

  const [knownTags, setKnownTags] = useState<string[]>([]);
  useEffect(() => {
    if (!campaign?.id) return;
    questApi
      .listQuestTags({ query: { campaignId: campaign.id } })
      .then(setKnownTags)
      .catch(() => null);
  }, [campaign?.id]);

  // Column visibility — default to the visible-by-default set (a few
  // niche columns like "linked" start hidden and the user opts in).
  // Persisted in localStorage alongside filters.
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(() => {
    if (!campaign?.id) return defaultVisibleColumns();
    return readStoredVisibleColumns(campaign.id) ?? defaultVisibleColumns();
  });
  useEffect(() => {
    if (!campaign?.id || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        columnsStorageKey(campaign.id),
        JSON.stringify([...visibleColumns]),
      );
    } catch {
      // localStorage may be unavailable (private mode, quota); skip.
    }
  }, [campaign?.id, visibleColumns]);

  const toggleColumn = (id: ColumnId) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const initialSort = useMemo<SortState>(
    () => (campaign?.id ? readStoredSort(campaign.id) : null),
    [campaign?.id],
  );
  const handleSortChange = (s: SortState) => {
    if (!campaign?.id || typeof window === "undefined") return;
    try {
      if (s) {
        window.localStorage.setItem(
          sortStorageKey(campaign.id),
          JSON.stringify(s),
        );
      } else {
        window.localStorage.removeItem(sortStorageKey(campaign.id));
      }
    } catch {
      // localStorage may be unavailable; skip.
    }
  };

  // Reset = clear every filter. We `.set(undefined)` per-field instead
  // of calling `filters.setInitialValues({})` because the latter
  // doesn't emit `form:change` for keys it DELETES (only for keys it
  // re-assigns), so the inputs stay visually populated and AlephaTable
  // doesn't refetch. Explicit per-field set keeps subscribers in sync.
  const handleResetFilters = () => {
    filters.input.search.set(undefined);
    filters.input.status.set(undefined);
    filters.input.zone.set(undefined);
    filters.input.tag.set(undefined);
  };

  // Refresh = re-fire the existing fetch with current filters. The
  // table subscribes to `form:submit:success`, so submitting is the
  // cheap way to trigger a re-fetch without an extra refetchKey hook.
  const handleRefresh = () => {
    void filters.submit();
  };

  useEffect(() => {
    if (!campaign?.id) return;
    campaignApi
      .getCampaignUsers({ params: { id: campaign.id } })
      .then(setUsers)
      .catch(() => null);
  }, [campaign?.id]);

  const renderAvatar = (userId?: string) => {
    if (userId) {
      const user = users.find((u) => u.id === userId);
      if (user?.picture) {
        return (
          <img
            alt="user avatar"
            className="size-6 rounded-full"
            src={`/api/files/${user.picture}`}
          />
        );
      }
    }
    return <UserIcon className="size-4" />;
  };

  if (!campaign) return null;

  const zoneOptions = (campaign.zones ?? []).map((p) => ({
    label: p,
    value: p,
  }));

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-auto">
      <form
        {...filters.props}
        className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-2"
      >
        <div className="w-44">
          <Control
            input={filters.input.search}
            label=""
            icon={Search}
            placeholder={String(tr("board.filter.search"))}
            inputProps={{ "aria-label": String(tr("board.filter.search")) }}
          />
        </div>
        <div className="w-44">
          <ZoneFilter
            input={filters.input.status}
            zones={[
              { label: "New", value: "new" },
              { label: "Accepted", value: "accepted" },
              { label: "Completed", value: "completed" },
            ]}
            ariaLabel={String(tr("board.filter.status"))}
            allLabel={String(tr("board.filter.allStatuses"))}
          />
        </div>
        {zoneOptions.length > 0 && (
          <div className="w-44">
            <ZoneFilter
              input={filters.input.zone}
              zones={zoneOptions}
              ariaLabel={String(tr("board.filter.zone"))}
              allLabel={String(tr("board.filter.allZones"))}
            />
          </div>
        )}
        {knownTags.length > 0 && (
          <div className="w-44">
            <ZoneFilter
              input={filters.input.tag}
              zones={knownTags.map((tag) => ({ label: tag, value: tag }))}
              ariaLabel={String(tr("board.filter.tag"))}
              allLabel={String(tr("board.filter.allTags"))}
            />
          </div>
        )}
        <div className="ml-auto flex items-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label="Columns"
                />
              }
            >
              <Columns3 className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {tr("board.columns.title")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUMN_IDS.map((id) => (
                  <DropdownMenuCheckboxItem
                    key={id}
                    checked={visibleColumns.has(id)}
                    onSelect={(e) => {
                      e.preventDefault();
                      toggleColumn(id);
                    }}
                  >
                    {tr(COLUMN_LABEL_KEYS[id] as string)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label="Actions"
                />
              }
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleRefresh}>
                <RefreshCw className="size-4" />
                {tr("board.filter.refresh")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleResetFilters}>
                <FunnelX className="size-4" />
                {tr("board.filter.reset")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </form>

      <AlephaTable<QuestResource>
        key={campaign.id}
        className="min-h-0 flex-1"
        defaultSize={25}
        defaultSort={initialSort}
        onSortChange={handleSortChange}
        emptyMessage={String(tr("common.noResults"))}
        form={filters}
        autoApplyFilters
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
        columns={((allColumns) =>
          Object.fromEntries(
            Object.entries(allColumns).filter(([id]) =>
              visibleColumns.has(id as ColumnId),
            ),
          ) as typeof allColumns)({
          status: {
            label: String(tr("board.table.status")),
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
            label: String(tr("board.table.assigned")),
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
                        {`${String(tr("board.table.assigned"))} ${dateFormatter.of(quest.acceptedAt).fromNow()}`}
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            },
          },
          title: {
            label: String(tr("board.table.title")),
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
            label: String(tr("board.table.tags")),
            cell: (quest: QuestResource) =>
              quest.tags && quest.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {quest.tags.map((t: string) => (
                    <Badge key={t} variant="outline" className="text-xs">
                      {t}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          linked: {
            label: String(tr("board.table.linked")),
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
            label: String(tr("board.table.priority")),
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
            label: String(tr("board.table.rank")),
            sortable: true,
            cell: (quest: QuestResource) => (
              <QuestDifficulty difficulty={quest.difficulty} />
            ),
          },
          zone: {
            label: String(tr("board.table.zone")),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-xs">{quest.zone}</span>
            ),
          },
          createdAt: {
            label: String(tr("board.table.created")),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-muted-foreground text-xs">
                {dateFormatter.of(quest.createdAt).fromNow()}
              </span>
            ),
          },
          updatedAt: {
            label: String(tr("board.table.updated")),
            sortable: true,
            cell: (quest: QuestResource) => (
              <span className="text-muted-foreground text-xs">
                {dateFormatter.of(quest.updatedAt).fromNow()}
              </span>
            ),
          },
        })}
        rowActions={(quest) => [
          ...(!quest.acceptedAt && questApi.acceptQuest.can()
            ? [
                {
                  icon: Signature,
                  label: String(tr("board.action.acceptQuest")),
                  onClick: async () => {
                    const updated = await questApi.acceptQuest({
                      params: { id: quest.id },
                    });
                    alepha.store.set(currentAssignedQuestsAtom, [
                      ...(alepha.store.get(currentAssignedQuestsAtom) ?? []),
                      updated,
                    ]);
                    await filters.submit();
                  },
                },
              ]
            : []),
          ...(questApi.deleteQuest.can()
            ? [
                {
                  icon: Trash,
                  label: String(tr("board.action.deleteQuest")),
                  destructive: true,
                  onClick: async () => {
                    const confirmed = await dialog.confirm({
                      title: String(tr("board.confirm-delete-title")),
                      description: String(tr("board.confirm-delete-message")),
                      destructive: true,
                    });
                    if (!confirmed) return;
                    await questApi.deleteQuest({ params: { id: quest.id } });
                    await filters.submit();
                  },
                },
              ]
            : []),
        ]}
      />
    </div>
  );
};

interface ZoneFilterProps {
  input: any;
  zones: { label: string; value: string }[];
  /** Visible "clear" entry, e.g. "All statuses" / "All zones". */
  allLabel: string;
  /** Screen-reader name for the select. */
  ariaLabel: string;
}

const ZoneFilter = (props: ZoneFilterProps) => {
  const [value, setValue] = useFieldValue(props.input);
  return (
    <Select
      value={value ?? "__all__"}
      onValueChange={(v) => setValue(v === "__all__" ? undefined : v)}
    >
      <SelectTrigger className="h-9 w-full" aria-label={props.ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{props.allLabel}</SelectItem>
        <SelectSeparator />
        {props.zones.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default CampaignBoardTable;
