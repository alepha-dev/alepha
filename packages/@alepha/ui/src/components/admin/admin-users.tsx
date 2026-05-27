import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Avatar, AvatarFallback } from "@alepha/ui/components/ui/avatar";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { type Page, type Static, t } from "alepha";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useFieldValue } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Eye, Search, Trash2, UserCheck, UserX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface RoleMeta {
  name: string;
  default?: boolean;
  description?: string;
}

export interface AdminUsersProps {
  /**
   * Realm name to query users from. Defaults to the configured user realm.
   */
  userRealmName?: string;
}

// Filter schema. Lives at module scope so its identity stays stable
// across renders — AlephaTable's internal `useForm` only captures it
// once and a fresh reference per render would harmlessly re-anchor the
// form initialization but is wasteful.
const filtersSchema = t.object({
  search: t.optional(t.string()),
  // "" = All status, "verified" = Active + emailVerified, "active" =
  // enabled, "disabled" = !enabled. Stored as a free-form string (not
  // enum) so unknown values from old persisted state simply fall back
  // to "All status" instead of throwing on schema validation.
  status: t.optional(t.string()),
});
type AdminUserFilters = Static<typeof filtersSchema>;

type StatusPreset = {
  enabled?: boolean;
  emailVerified?: boolean;
};

const STATUS_PRESETS: Record<string, StatusPreset> = {
  verified: { enabled: true, emailVerified: true },
  active: { enabled: true },
  disabled: { enabled: false },
};

export function AdminUsers(props: AdminUsersProps) {
  const client = useClient<AdminUserController>();
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const { l, tr } = useI18n();
  const dialog = useDialog();

  const [availableRoles, setAvailableRoles] = useState<RoleMeta[]>([]);
  // Bumped after every per-row mutation (e.g. role toggle) to force the
  // AlephaTable's fetcher identity to change so the data reloads.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const roles = (await client.findRoles({
        query: { userRealmName: props.userRealmName },
      } as never)) as RoleMeta[];
      if (!cancelled) setAvailableRoles(roles);
    })().catch(() => {
      // The picker simply degrades to read-only text if the metadata
      // fetch fails; not a blocking error.
    });
    return () => {
      cancelled = true;
    };
  }, [client, props.userRealmName]);

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AdminUserFilters;
    }) => {
      const preset = params.filters?.status
        ? STATUS_PRESETS[params.filters.status]
        : undefined;
      const res = await client.findUsers({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
          enabled: preset?.enabled,
          emailVerified: preset?.emailVerified,
          userRealmName: props.userRealmName,
        } as never,
      });
      return res as Page<UserEntity>;
    },
    [client, props.userRealmName, reloadKey],
  );

  const isSelf = (user: UserEntity) => currentUser?.id === user.id;

  const handleToggleRole = useCallback(
    async (user: UserEntity, role: string, checked: boolean) => {
      const next = checked
        ? Array.from(new Set([...(user.roles ?? []), role]))
        : (user.roles ?? []).filter((r) => r !== role);
      try {
        await client.updateUser({
          params: { id: user.id },
          query: { userRealmName: props.userRealmName },
          body: { roles: next },
        } as never);
        setReloadKey((k) => k + 1);
      } catch (err) {
        toast.error(
          tr("admin.users.roleUpdateFailed", {
            default: "Failed to update roles",
          }),
        );
        throw err;
      }
    },
    [client, props.userRealmName, tr],
  );

  const userLabel = (u: UserEntity) =>
    u.email ||
    u.username ||
    tr("admin.users.thisUser", { default: "this user" });

  const handleToggleEnabled = async (user: UserEntity, refresh: () => void) => {
    if (isSelf(user)) {
      toast.error(
        tr("admin.users.cantDisableSelf", {
          default: "You cannot disable your own account",
        }),
      );
      return;
    }
    const enable = !user.enabled;
    const label = userLabel(user);
    const ok = await dialog.confirm({
      title: enable
        ? tr("admin.users.enableTitle", { default: "Enable user" })
        : tr("admin.users.disableTitle", { default: "Disable user" }),
      description: enable
        ? tr("admin.users.enableConfirm", {
            default: `Enable ${label}?`,
            args: [label],
          })
        : tr("admin.users.disableConfirm", {
            default: `Disable ${label}? They will no longer be able to sign in.`,
            args: [label],
          }),
      destructive: !enable,
    });
    if (!ok) return;
    await client.updateUser({
      params: { id: user.id },
      query: { userRealmName: props.userRealmName },
      body: { enabled: enable },
    });
    toast.success(
      enable
        ? tr("admin.users.enabled", { default: "User enabled" })
        : tr("admin.users.disabled", { default: "User disabled" }),
    );
    refresh();
  };

  const handleDelete = async (user: UserEntity, refresh: () => void) => {
    const label = userLabel(user);
    const ok = await dialog.confirm({
      title: tr("admin.users.deleteTitle", { default: "Delete user" }),
      description: tr("admin.users.deleteConfirm", {
        default: `Permanently delete ${label}? This action cannot be undone.`,
        args: [label],
      }),
      destructive: true,
    });
    if (!ok) return;
    await client.deleteUser({
      params: { id: user.id },
      query: { userRealmName: props.userRealmName },
    });
    toast.success(tr("admin.users.deleted", { default: "User deleted" }));
    refresh();
  };

  const handleBulkDelete = async (
    items: UserEntity[],
    {
      clearSelection,
      refresh,
    }: { clearSelection: () => void; refresh: () => void },
  ) => {
    const targets = items.filter((u) => !isSelf(u));
    if (targets.length === 0) {
      toast.error(
        tr("admin.users.noneSelected", {
          default: "No deletable users in selection",
        }),
      );
      return;
    }
    const ok = await dialog.confirm({
      title: tr("admin.users.bulkDeleteTitle", { default: "Delete users" }),
      description: tr("admin.users.bulkDeleteConfirm", {
        default: `Delete ${targets.length} user(s)? This cannot be undone.`,
        args: [String(targets.length)],
      }),
      destructive: true,
    });
    if (!ok) return;
    const res = await client.deleteUsers({
      query: { userRealmName: props.userRealmName },
      body: { ids: targets.map((u) => u.id) },
    });
    toast.success(
      tr("admin.users.bulkDeleted", {
        default: `${res.deleted.length} user(s) deleted`,
        args: [String(res.deleted.length)],
      }),
    );
    clearSelection();
    refresh();
  };

  const handleBulkDisable = async (
    items: UserEntity[],
    {
      clearSelection,
      refresh,
    }: { clearSelection: () => void; refresh: () => void },
  ) => {
    const enabled = items.filter((u) => u.enabled && !isSelf(u));
    if (enabled.length === 0) {
      toast.error(
        tr("admin.users.noneSelected", {
          default: "No active users in selection",
        }),
      );
      return;
    }
    const ok = await dialog.confirm({
      title: tr("admin.users.bulkDisableTitle", { default: "Disable users" }),
      description: tr("admin.users.bulkDisableConfirm", {
        default: `Disable ${enabled.length} user(s)? They will no longer be able to sign in.`,
        args: [String(enabled.length)],
      }),
      destructive: true,
    });
    if (!ok) return;
    for (const u of enabled) {
      await client.updateUser({
        params: { id: u.id },
        query: { userRealmName: props.userRealmName },
        body: { enabled: false },
      });
    }
    toast.success(
      tr("admin.users.bulkDisabled", {
        default: `${enabled.length} user(s) disabled`,
        args: [String(enabled.length)],
      }),
    );
    clearSelection();
    refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <AlephaTable<UserEntity>
        className="min-h-0 flex-1"
        persistenceKey="admin.users"
        fetch={fetcher}
        filters={{
          schema: filtersSchema,
          render: (form) => (
            <div className="flex items-center gap-2">
              <div className="w-72">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={String(
                    tr("admin.users.searchPlaceholder", {
                      default: "Search…",
                    }),
                  )}
                  inputProps={{
                    "aria-label": String(
                      tr("admin.users.search", { default: "Search users" }),
                    ),
                  }}
                />
              </div>
              <StatusFilter input={form.input.status} tr={tr} />
            </div>
          ),
        }}
        bulkActions={[
          {
            label: tr("admin.users.bulkDisable", {
              default: "Disable selected",
            }),
            icon: UserX,
            destructive: true,
            onClick: handleBulkDisable,
          },
          {
            label: tr("admin.users.bulkDelete", {
              default: "Delete selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: handleBulkDelete,
          },
        ]}
        columns={{
          user: {
            label: tr("admin.users.colUser", { default: "User" }),
            cell: (u) => {
              const name =
                `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
                u.username ||
                tr("admin.users.anonymous", { default: "Anonymous" });
              return (
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>
                      {name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground text-xs">
                      {u.email || "—"}
                    </span>
                  </div>
                </div>
              );
            },
          },
          roles: {
            label: tr("admin.users.colRoles", { default: "Roles" }),
            cell: (u) => (
              <RolesPicker
                user={u}
                availableRoles={availableRoles}
                onToggle={(role, checked) => handleToggleRole(u, role, checked)}
                noRolesLabel={String(
                  tr("admin.users.noRoles", { default: "No roles" }),
                )}
              />
            ),
          },
          enabled: {
            label: tr("admin.users.colStatus", { default: "Status" }),
            cell: (u) => (
              <Badge variant={u.enabled ? "default" : "destructive"}>
                {u.enabled
                  ? tr("admin.users.active", { default: "Active" })
                  : tr("admin.users.statusDisabled", { default: "Disabled" })}
              </Badge>
            ),
          },
          emailVerified: {
            label: tr("admin.users.colEmail", { default: "Email" }),
            cell: (u) => (
              <Badge variant={u.emailVerified ? "default" : "outline"}>
                {u.emailVerified
                  ? tr("admin.users.verified", { default: "Verified" })
                  : tr("admin.users.unverified", { default: "Unverified" })}
              </Badge>
            ),
          },
          createdAt: {
            label: tr("admin.users.colJoined", { default: "Joined" }),
            sortable: true,
            // Defaulting joined-date hidden keeps the table compact on
            // first view; opt back in via the column picker. The
            // sortable header still works once enabled.
            defaultHidden: false,
            cell: (u) => (
              <span className="text-muted-foreground text-xs">
                {String(l(u.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(u) => [
          {
            label: tr("admin.users.viewProfile", { default: "View profile" }),
            icon: Eye,
            onClick: () => router.push(`/admin/users/${u.id}` as never),
          },
          ...(!isSelf(u)
            ? [
                {
                  label: u.enabled
                    ? tr("admin.users.disableUser", {
                        default: "Disable user",
                      })
                    : tr("admin.users.enableUser", { default: "Enable user" }),
                  icon: u.enabled ? UserX : UserCheck,
                  onClick: (
                    _u: UserEntity,
                    { refresh }: { refresh: () => void },
                  ) => handleToggleEnabled(u, refresh),
                },
                {
                  label: tr("admin.users.deleteUser", {
                    default: "Delete user",
                  }),
                  icon: Trash2,
                  destructive: true,
                  onClick: (
                    _u: UserEntity,
                    { refresh }: { refresh: () => void },
                  ) => handleDelete(u, refresh),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

function RolesPicker({
  user,
  availableRoles,
  onToggle,
  noRolesLabel,
}: {
  user: UserEntity;
  availableRoles: RoleMeta[];
  onToggle: (role: string, checked: boolean) => Promise<void>;
  noRolesLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const userRoles = user.roles ?? [];
  const label =
    userRoles.length > 0 ? (
      userRoles.join(", ")
    ) : (
      <span className="text-muted-foreground">{noRolesLabel}</span>
    );

  // If the metadata fetch hasn't landed yet, union the user's roles
  // with a sane fallback so the popover still renders rows for everything
  // the user currently has. Default state isn't known until metadata
  // arrives — only the disable rule degrades.
  const rows: RoleMeta[] =
    availableRoles.length > 0
      ? availableRoles
      : userRoles.map((name) => ({ name }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="text-left text-sm hover:underline focus:outline-none focus-visible:underline"
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">Roles</div>
        <div className="flex flex-col">
          {rows.map((role) => {
            const checked = userRoles.includes(role.name);
            const disabled = role.default === true || pending === role.name;
            return (
              <label
                key={role.name}
                className={
                  disabled
                    ? "flex cursor-not-allowed items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-60"
                    : "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                }
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={async (next) => {
                    if (disabled) return;
                    setPending(role.name);
                    try {
                      await onToggle(role.name, Boolean(next));
                    } finally {
                      setPending(null);
                    }
                  }}
                />
                <span className="flex-1">{role.name}</span>
                {role.default && (
                  <span className="text-[10px] uppercase text-muted-foreground">
                    default
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type StatusInput = Parameters<typeof useFieldValue>[0];

function StatusFilter({
  input,
  tr,
}: {
  input: StatusInput;
  tr: ReturnType<typeof useI18n>["tr"];
}) {
  const [value, setValue] = useFieldValue(input);
  // Base UI's SelectValue displays the raw underlying string when items
  // are rendered with arbitrary children — so a `value: "verified"`
  // shows up as the lower-case slug in the trigger even though the
  // SelectItem renders "Verified". Resolve the localized label
  // ourselves and pass it as SelectValue's children to override that.
  const labels: Record<string, string> = {
    "": String(tr("admin.users.statusAll", { default: "All status" })),
    verified: String(tr("admin.users.statusVerified", { default: "Verified" })),
    active: String(tr("admin.users.statusActive", { default: "Active" })),
    disabled: String(tr("admin.users.statusDisabled", { default: "Disabled" })),
  };
  const selected = value ?? "";
  return (
    <Select
      value={selected}
      onValueChange={(v) => setValue(v === "" ? undefined : v)}
    >
      <SelectTrigger
        className="w-40"
        aria-label={String(
          tr("admin.users.statusFilter", {
            default: "Filter by status",
          }),
        )}
      >
        <SelectValue placeholder={labels[""]}>{labels[selected]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">{labels[""]}</SelectItem>
        <SelectSeparator />
        <SelectItem value="verified">{labels.verified}</SelectItem>
        <SelectItem value="active">{labels.active}</SelectItem>
        <SelectItem value="disabled">{labels.disabled}</SelectItem>
      </SelectContent>
    </Select>
  );
}
