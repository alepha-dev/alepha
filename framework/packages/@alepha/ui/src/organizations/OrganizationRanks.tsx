import type {
  MemberController,
  OrganizationRankController,
  OrganizationRankResource,
} from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { useAction, useClient, useInject, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { PermissionCatalogue } from "alepha/security";
import { Plus, Save } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import { Card } from "../core/Card.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { cn } from "../core/utils.ts";
import { settingsCardEdge } from "../settings/settingsCardEdge.ts";
import {
  PermissionMatrix,
  type PermissionMatrixColumn,
  type PermissionMatrixGroup,
} from "../table/PermissionMatrix.tsx";
import { OrganizationRankColumnHeader } from "./OrganizationRankColumnHeader.tsx";
import { rankOrder } from "./rankOrder.ts";

type CatalogueGroup = PermissionCatalogue["groups"][number];
type CataloguePermission = CatalogueGroup["permissions"][number];

export interface OrganizationRankPreset {
  key: string;
  name: string;
  permissions: string[];
}

export interface OrganizationRanksProps {
  organizationId: string;
  presets?: OrganizationRankPreset[];
  /**
   * Whether "Create rank" offers a blank rank beside the presets. On by
   * default; an app whose every rank starts from a base turns it off.
   */
  blank?: boolean;
  filterPermission?: (
    permission: CataloguePermission,
    group: CatalogueGroup,
  ) => boolean;
  lockPermission?: (
    permission: CataloguePermission,
    group: CatalogueGroup,
  ) => "on" | "off" | undefined;
  label?: (key: string | undefined, fallback: string) => string;
  /**
   * Whether a given rank may not be given a permission right now, on top of
   * `lockPermission`: an application rule about one rank (a rank kept
   * narrow while some state holds). Such an unchecked cell is closed.
   */
  closedPermission?: (rank: { key: string }, permission: string) => boolean;
}

export const OrganizationRanks = (props: OrganizationRanksProps) => {
  const api = useClient<OrganizationRankController>();
  const membersApi = useClient<MemberController>();
  const dateTime = useInject(DateTimeProvider);
  const dialog = useDialog();
  const toaster = useToast();
  const { tr } = useI18n();
  const invalidates = [["organization-ranks", props.organizationId]];

  const ranksQuery = useQuery(
    {
      key: ["organization-ranks", props.organizationId],
      handler: () =>
        api.getOrganizationRanks({
          params: { organizationId: props.organizationId },
        }),
    },
    [api, props.organizationId],
  );
  const catalogueQuery = useQuery(
    {
      handler: () =>
        api.getOrganizationRankCatalogue({
          params: { organizationId: props.organizationId },
        }),
    },
    [api, props.organizationId],
  );
  const membersQuery = useQuery(
    {
      handler: () =>
        membersApi.getOrganizationMembers({
          params: { organizationId: props.organizationId },
        }),
    },
    [membersApi, props.organizationId],
  );
  const rankResponse = ranksQuery.data?.items;
  const ranks = rankResponse ?? [];
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [seededFrom, setSeededFrom] = useState<OrganizationRankResource[]>();
  if (rankResponse && rankResponse !== seededFrom) {
    setSeededFrom(rankResponse);
    setDraft(organizationRankDraft(rankResponse));
  }

  const save = useAction<[], void>(
    {
      handler: async () => {
        for (const rank of ranks) {
          if (!rank.editable) continue;
          const permissions = draft[rank.key] ?? [];
          if (samePermissions(permissions, rank.permissions)) continue;
          await api.saveOrganizationRank({
            params: { organizationId: props.organizationId, key: rank.key },
            body: { name: rank.name, permissions },
          });
        }
        toaster.success(
          tr("organizations.ranks.saved", { default: "Ranks saved" }),
        );
      },
      invalidates,
    },
    [api, draft, props.organizationId, ranks, toaster, tr],
  );
  const create = useAction<[OrganizationRankPreset | undefined], void>(
    {
      handler: async (_ctx, preset) => {
        const name = await dialog.prompt({
          title: tr("organizations.ranks.createTitle", {
            default: "Create a rank",
          }),
          description: tr("organizations.ranks.createDescription", {
            default: "Name the rank. Its key stays stable when renamed.",
          }),
          confirmLabel: tr("organizations.ranks.createConfirm", {
            default: "Create",
          }),
          defaultValue: preset?.name ?? "",
        });
        if (!name?.trim()) return;
        await api.saveOrganizationRank({
          params: {
            organizationId: props.organizationId,
            key: `r${dateTime.nowMillis().toString(36)}`,
          },
          body: {
            name: name.trim(),
            permissions: preset?.permissions ?? [],
          },
        });
      },
      invalidates,
    },
    [api, dateTime, dialog, props.organizationId, tr],
  );
  const rename = useAction<[OrganizationRankResource], void>(
    {
      handler: async (_ctx, rank) => {
        const name = await dialog.prompt({
          title: tr("organizations.ranks.renameTitle", {
            default: "Rename $1",
            args: [rank.name],
          }),
          confirmLabel: tr("organizations.ranks.rename", {
            default: "Rename",
          }),
          defaultValue: rank.name,
        });
        if (!name?.trim() || name.trim() === rank.name) return;
        await api.saveOrganizationRank({
          params: { organizationId: props.organizationId, key: rank.key },
          body: {
            name: name.trim(),
            permissions: draft[rank.key] ?? rank.permissions,
          },
        });
      },
      invalidates,
    },
    [api, dialog, draft, props.organizationId, tr],
  );
  const remove = useAction<[OrganizationRankResource], void>(
    {
      handler: async (_ctx, rank) => {
        const confirmed = await dialog.confirm({
          title: tr("organizations.ranks.deleteTitle", {
            default: "Delete $1?",
            args: [rank.name],
          }),
          description: tr("organizations.ranks.deleteDescription", {
            default: "A rank held by a member cannot be deleted.",
          }),
          confirmLabel: tr("organizations.ranks.delete", {
            default: "Delete",
          }),
          destructive: true,
        });
        if (!confirmed) return;
        await api.deleteOrganizationRank({
          params: { organizationId: props.organizationId, key: rank.key },
        });
        toaster.success(
          tr("organizations.ranks.deleted", { default: "Rank deleted" }),
        );
      },
      invalidates,
    },
    [api, dialog, props.organizationId, toaster, tr],
  );

  const holdersOf = (key: string) =>
    (membersQuery.data ?? []).filter(
      (member) => (member.rank ?? "member") === key,
    ).length;
  const reset = useAction<[OrganizationRankResource], void>(
    {
      handler: async (_ctx, rank) => {
        const defaults = rank.defaultPermissions ?? [];
        const adds = defaults.filter((it) => !rank.permissions.includes(it));
        const removes = rank.permissions.filter((it) => !defaults.includes(it));
        const holders = holdersOf(rank.key);
        const confirmed = await dialog.confirm({
          title: tr("organizations.ranks.resetTitle", {
            default: "Reset $1 to its default?",
            args: [rank.name],
          }),
          description: [
            adds.length
              ? tr("organizations.ranks.resetAdds", {
                  default: "Adds $1: $2.",
                  args: [String(adds.length), adds.join(", ")],
                })
              : tr("organizations.ranks.resetAddsNone", {
                  default: "Adds none.",
                }),
            removes.length
              ? tr("organizations.ranks.resetRemoves", {
                  default: "Removes $1: $2.",
                  args: [String(removes.length), removes.join(", ")],
                })
              : tr("organizations.ranks.resetRemovesNone", {
                  default: "Removes none.",
                }),
            holders === 1
              ? tr("organizations.ranks.resetHolder", {
                  default:
                    "1 member holds this rank, and their access changes right away.",
                })
              : tr("organizations.ranks.resetHolders", {
                  default:
                    "$1 members hold this rank, and their access changes right away.",
                  args: [String(holders)],
                }),
          ].join(" "),
          confirmLabel: tr("organizations.ranks.resetConfirm", {
            default: "Reset",
          }),
        });
        if (!confirmed) return;
        await api.resetOrganizationRank({
          params: { organizationId: props.organizationId, key: rank.key },
        });
        toaster.success(
          tr("organizations.ranks.resetDone", {
            default: "$1 follows its default",
            args: [rank.name],
          }),
        );
      },
      invalidates,
    },
    [api, dialog, membersQuery.data, props.organizationId, toaster, tr],
  );

  const saving =
    save.loading ||
    create.loading ||
    rename.loading ||
    remove.loading ||
    reset.loading;
  const label = props.label ?? ((_key, fallback) => fallback);
  const groups: PermissionMatrixGroup[] = (
    catalogueQuery.data?.groups ?? []
  ).flatMap((group) => {
    const permissions = group.permissions
      .filter(
        (permission) => props.filterPermission?.(permission, group) ?? true,
      )
      .map((permission) => ({
        name: permission.name,
        label: label(permission.label, permission.name),
        description: permission.description,
        lock: props.lockPermission?.(permission, group),
      }));
    return permissions.length
      ? [
          {
            key: group.name,
            label: label(group.label, group.name),
            permissions,
          },
        ]
      : [];
  });
  // Most permissions first (#Q3701), so the presets read Owner, Admin,
  // Member and a custom rank falls into place by how much it grants. Counted
  // on the SAVED grants over the permissions the matrix shows, `*` holding
  // them all: a column never moves under a click, only once the change is
  // saved. Ties go by name, as in the member and invite pickers (#Q3840).
  const shown = groups.flatMap((group) =>
    group.permissions.map((permission) => permission.name),
  );
  const grants = (rank: (typeof ranks)[number]) =>
    rank.permissions.includes("*")
      ? shown.length
      : shown.filter((name) => rank.permissions.includes(name)).length;
  const ordered = rankOrder(ranks, grants);
  const dirty =
    seededFrom !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(organizationRankDraft(ranks));
  // Counted on the SAVED grants, like the order: the mark and the reset say
  // what is stored, and an unsaved click is the Save button's business. The
  // dots in the cells follow the draft, so a reader sees what a click undid.
  const differencesOf = (rank: OrganizationRankResource): number => {
    const defaults = rank.defaultPermissions;
    if (!defaults || !rank.editable) return 0;
    return shown.filter(
      (name) => rank.permissions.includes(name) !== defaults.includes(name),
    ).length;
  };
  const columns: PermissionMatrixColumn[] = ordered.map((rank) => ({
    key: rank.key,
    readOnly: !rank.editable,
    defaults: rank.editable ? rank.defaultPermissions : undefined,
    closed: props.closedPermission
      ? (permission: string) => props.closedPermission!(rank, permission)
      : undefined,
    description:
      holdersOf(rank.key) === 1
        ? tr("organizations.ranks.holder", { default: "1 member" })
        : tr("organizations.ranks.holders", {
            default: "$1 members",
            args: [String(holdersOf(rank.key))],
          }),
    label: (
      <OrganizationRankColumnHeader
        name={rank.name}
        differences={differencesOf(rank)}
        onReset={!saving && !dirty ? () => void reset.run(rank) : undefined}
        onRename={
          rank.renamable && !saving ? () => void rename.run(rank) : undefined
        }
        onDelete={
          !rank.builtin && rank.editable && !saving
            ? () => void remove.run(rank)
            : undefined
        }
      />
    ),
  }));
  // No title, description or propagation note above the editor (#Q3666):
  // the tab already names the page, and Create rank sits in the editor's own
  // header cell, the Permission column's, beside the rank names it adds to.
  const createRank = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outlined"
            size="sm"
            loading={create.loading}
            aria-label={tr("organizations.ranks.create", {
              default: "Create rank",
            })}
          />
        }
      >
        <Plus className="size-3.5" />
        {tr("organizations.ranks.create", { default: "Create rank" })}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.blank !== false && (
          <DropdownMenuItem
            disabled={saving}
            onClick={() => void create.run(undefined)}
          >
            {tr("organizations.ranks.blank", { default: "Blank rank" })}
          </DropdownMenuItem>
        )}
        {props.blank !== false && !!props.presets?.length && (
          <DropdownMenuSeparator />
        )}
        {props.presets?.map((preset) => (
          <DropdownMenuItem
            key={preset.key}
            disabled={saving}
            onClick={() => void create.run(preset)}
          >
            {tr("organizations.ranks.fromPreset", {
              default: "Start from $1",
              args: [preset.name],
            })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy={saving}>
      <Card
        className={cn(
          settingsCardEdge,
          "min-h-0 flex-1 gap-0 overflow-hidden py-0",
        )}
      >
        <PermissionMatrix
          className="min-h-0 flex-1"
          header={
            <span className="flex items-center justify-between gap-2">
              {tr("organizations.ranks.permission", {
                default: "Permission",
              })}
              {createRank}
            </span>
          }
          empty={tr("organizations.ranks.empty", {
            default: "No permissions to display.",
          })}
          disabled={saving}
          groups={groups}
          columns={columns}
          value={draft}
          onChange={setDraft}
        />
      </Card>
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            variant="minimal"
            disabled={saving}
            onClick={() => setDraft(organizationRankDraft(ranks))}
          >
            {tr("organizations.ranks.cancel", { default: "Cancel" })}
          </Button>
          <Button
            disabled={saving}
            loading={save.loading}
            onClick={() => void save.run()}
            aria-label={tr("organizations.ranks.save", {
              default: "Save ranks",
            })}
          >
            <Save className="size-4" />
            {tr("organizations.ranks.save", { default: "Save ranks" })}
          </Button>
        </div>
      )}
    </div>
  );
};

const organizationRankDraft = (
  ranks: OrganizationRankResource[],
): Record<string, string[]> =>
  Object.fromEntries(
    ranks
      .filter((rank) => rank.editable)
      .map((rank) => [rank.key, [...rank.permissions]]),
  );

const samePermissions = (left: string[], right: string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
