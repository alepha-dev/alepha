import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useFieldValue, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { RotateCcw, Signature, Trash, User as UserIcon } from "lucide-react";
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

const filterStorageKey = (campaignId: number) =>
  `lor.board.filters.${campaignId}`;

const readStoredFilters = (
  campaignId: number,
  knownZones: string[],
): BoardFilterValues | undefined => {
  try {
    const raw = window.localStorage.getItem(filterStorageKey(campaignId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as BoardFilterValues;
    // Drop a persisted zone that no longer exists on the campaign so we don't
    // filter against a phantom value (would silently hide every quest).
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
  const [users, setUsers] = useState<Array<User>>([]);

  // Hydrate the form once per campaign: prior persisted filters if any, else
  // default to `status: "new"` so the board opens on the actionable lane.
  const initialFilterValues = useMemo<BoardFilterValues>(() => {
    if (!campaign?.id) return { status: "new" };
    return (
      readStoredFilters(campaign.id, campaign.zones ?? []) ?? { status: "new" }
    );
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

  // Persist filter state to localStorage on every change so the same campaign
  // re-opens with the same lens later. Strips empty fields to keep the blob
  // small and round-trip clean.
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
      // localStorage may be unavailable (private mode, quota); silently skip.
    }
  }, [
    campaign?.id,
    filterValues?.search,
    filterValues?.status,
    filterValues?.zone,
    filterValues?.tag,
  ]);

  // Honor a `?tag=foo` query param on first navigation (e.g. clicking a
  // tag chip on the quest view jumps to a pre-filtered board).
  useEffect(() => {
    const tagParam =
      typeof router.query.tag === "string" ? router.query.tag : undefined;
    if (!tagParam) return;
    filters.input.tag.set(tagParam);
  }, [router.query.tag]);

  const [knownTags, setKnownTags] = useState<string[]>([]);
  useEffect(() => {
    if (!campaign?.id) return;
    questApi
      .listQuestTags({ query: { campaignId: campaign.id } })
      .then(setKnownTags)
      .catch(() => null);
  }, [campaign?.id]);

  // Reset = clear all. `filters.reset()` would restore the hydrated initial
  // values (which include `status: "new"`); we want the button to wipe every
  // active filter, including status. Swap initial values for an empty object
  // first — the change is mirrored to live values + emits form:change so
  // AlephaTable refetches.
  const handleResetFilters = () => {
    filters.setInitialValues({});
    if (campaign?.id) {
      try {
        window.localStorage.removeItem(filterStorageKey(campaign.id));
      } catch {
        // ignore
      }
    }
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
        <div className="min-w-48 flex-1">
          <Control
            input={filters.input.search}
            label={String(tr("board.filter.search"))}
          />
        </div>
        <div className="w-40">
          <Control
            input={filters.input.status}
            label={String(tr("board.filter.status"))}
          />
        </div>
        {zoneOptions.length > 0 && (
          <div className="w-44">
            <ZoneFilter
              input={filters.input.zone}
              zones={zoneOptions}
              label={String(tr("board.filter.zone"))}
            />
          </div>
        )}
        {knownTags.length > 0 && (
          <div className="w-44">
            <ZoneFilter
              input={filters.input.tag}
              zones={knownTags.map((tag) => ({ label: tag, value: tag }))}
              label={String(tr("board.filter.tag"))}
            />
          </div>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleResetFilters}
        >
          <RotateCcw className="size-4" />
          {tr("board.filter.reset")}
        </Button>
      </form>

      <AlephaTable<QuestResource>
        key={campaign.id}
        className="min-h-0 flex-1"
        defaultSize={25}
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
        columns={{
          status: {
            label: String(tr("board.table.status")),
            cell: (quest) => {
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
            cell: (quest) =>
              quest.acceptedBy ? (
                <div className="flex items-center gap-2">
                  {renderAvatar(quest.acceptedBy)}
                  <span className="text-sm">
                    {displayName(
                      users.find((u) => u.id === quest.acceptedBy),
                      "",
                    )}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">-</span>
              ),
          },
          title: {
            label: String(tr("board.table.title")),
            sortable: true,
            cell: (quest) => (
              <div className="flex flex-col overflow-hidden whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-sm font-medium ${quest.completedAt ? "text-muted-foreground line-through" : ""}`}
                  >
                    {quest.title}
                  </span>
                  {quest.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="bg-muted rounded-sm border px-1 py-0.5 font-mono text-[10px]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {quest.description && (
                  <span className="text-muted-foreground truncate text-xs">
                    {removeHtmlTags(quest.description.slice(0, 60))}
                  </span>
                )}
              </div>
            ),
          },
          priority: {
            label: String(tr("board.table.priority")),
            sortable: true,
            cell: (quest) => (
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
            cell: (quest) => <QuestDifficulty difficulty={quest.difficulty} />,
          },
          zone: {
            label: String(tr("board.table.zone")),
            sortable: true,
            cell: (quest) => <span className="text-xs">{quest.zone}</span>,
          },
          createdAt: {
            label: String(tr("board.table.created")),
            sortable: true,
            cell: (quest) => (
              <span className="text-muted-foreground text-xs">
                {dateFormatter.of(quest.createdAt).fromNow()}
              </span>
            ),
          },
          updatedAt: {
            label: String(tr("board.table.updated")),
            sortable: true,
            cell: (quest) => (
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
  label: string;
}

const ZoneFilter = (props: ZoneFilterProps) => {
  const [value, setValue] = useFieldValue(props.input);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{props.label}</span>
      <Select
        value={value ?? "__all__"}
        onValueChange={(v) => setValue(v === "__all__" ? undefined : v)}
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">—</SelectItem>
          {props.zones.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default CampaignBoardTable;
