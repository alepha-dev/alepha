import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
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
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Static, t } from "alepha";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useAction, useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import type { useFieldValue } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Check, Eye, Search, Trash2, UserCheck, UserX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
  /**
   * Column keys to hide by default. Users can still toggle them on via
   * the column picker. Useful when the host app doesn't populate certain
   * fields (e.g. apps without `firstName`/`lastName`).
   */
  defaultHiddenColumns?: ReadonlyArray<
    | "username"
    | "firstName"
    | "lastName"
    | "email"
    | "roles"
    | "enabled"
    | "createdAt"
    | "lastLoginAt"
  >;
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

function applyDefaultHidden<C extends Record<string, unknown>>(
  hiddenKeys: readonly string[] | undefined,
  columns: C,
): C {
  if (!hiddenKeys?.length) return columns;
  const next = { ...columns } as Record<string, any>;
  for (const key of hiddenKeys) {
    if (next[key]) next[key] = { ...next[key], defaultHidden: true };
  }
  return next as C;
}

export function AdminUsers(props: AdminUsersProps) {
  const client = useClient<AdminUserController>();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const { l, tr } = useI18n();
  const dialog = useDialog();

  // Role metadata is a read-only fetch via useQuery: runs on mount, re-runs
  // when realm changes, aborts on unmount via the passed signal, and exposes
  // refetch() — called after a role toggle so the picker reflects new state.
  // The picker simply degrades to read-only text if the metadata fetch fails;
  // not a blocking error (swallowed in onError).
  const rolesQuery = useQuery(
    {
      handler: ({ signal }) =>
        client.findRoles(
          { query: { userRealmName: props.userRealmName } } as never,
          { request: { signal } },
        ) as Promise<RoleMeta[]>,
      onError: () => {},
    },
    [client, props.userRealmName],
  );
  const availableRoles = rolesQuery.data ?? [];

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
      return client.findUsers({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
          enabled: preset?.enabled,
          emailVerified: preset?.emailVerified,
          userRealmName: props.userRealmName,
        },
      });
    },
    [client, props.userRealmName],
  );

  const isSelf = (user: UserEntity) => currentUser?.id === user.id;

  const toggleRole = useAction<[UserEntity, string, boolean]>(
    {
      handler: async (user, role, checked) => {
        const next = checked
          ? Array.from(new Set([...(user.roles ?? []), role]))
          : (user.roles ?? []).filter((r) => r !== role);
        await client.updateUser({
          params: { id: user.id },
          query: { userRealmName: props.userRealmName },
          body: { roles: next },
        } as never);
        await rolesQuery.refetch();
      },
    },
    [client, props.userRealmName],
  );

  const userLabel = (u: UserEntity) =>
    u.email ||
    u.username ||
    tr("admin.users.thisUser", { default: "this user" });

  const toggleEnabled = useAction<[UserEntity]>(
    {
      handler: async (user) => {
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
      },
    },
    [client, currentUser, props.userRealmName],
  );

  const deleteUser = useAction<[UserEntity]>(
    {
      handler: async (user) => {
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
      },
    },
    [client, props.userRealmName],
  );

  const bulkDelete = useAction<[UserEntity[]]>(
    {
      handler: async (items) => {
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
      },
    },
    [client, currentUser, props.userRealmName],
  );

  const bulkDisable = useAction<[UserEntity[]]>(
    {
      handler: async (items) => {
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
          title: tr("admin.users.bulkDisableTitle", {
            default: "Disable users",
          }),
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
      },
    },
    [client, currentUser, props.userRealmName],
  );

  return (
    <AdminPage>
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
            onClick: async (items, ctx) => {
              await bulkDisable.run(items);
              ctx.clearSelection();
              ctx.refresh();
            },
          },
          {
            label: tr("admin.users.bulkDelete", {
              default: "Delete selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: async (items, ctx) => {
              await bulkDelete.run(items);
              ctx.clearSelection();
              ctx.refresh();
            },
          },
        ]}
        columns={applyDefaultHidden(props.defaultHiddenColumns, {
          email: {
            label: tr("admin.users.colEmail", { default: "Email" }),
            cell: (u) => {
              const initial = (
                u.email ||
                u.username ||
                u.firstName ||
                u.lastName ||
                "?"
              )
                .charAt(0)
                .toUpperCase();
              return (
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>{initial}</AvatarFallback>
                  </Avatar>
                  <button
                    type="button"
                    onClick={() => router.push(`/admin/users/${u.id}` as never)}
                    className="hover:text-primary inline-flex items-center gap-1.5 truncate text-left font-medium underline-offset-2 hover:underline"
                  >
                    <span className="truncate">{u.email ?? "—"}</span>
                    {u.emailVerified && u.email && (
                      <Check
                        className="size-3.5 shrink-0 text-emerald-500"
                        aria-label={String(
                          tr("admin.users.verified", { default: "Verified" }),
                        )}
                      />
                    )}
                  </button>
                </div>
              );
            },
          },
          username: {
            label: tr("admin.users.colUsername", { default: "Username" }),
            cell: (u) =>
              u.username ? (
                <span className="truncate">@{u.username}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          firstName: {
            label: tr("admin.users.colFirstName", { default: "First name" }),
            cell: (u) =>
              u.firstName ? (
                <span className="truncate">{u.firstName}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          lastName: {
            label: tr("admin.users.colLastName", { default: "Last name" }),
            cell: (u) =>
              u.lastName ? (
                <span className="truncate">{u.lastName}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          roles: {
            label: tr("admin.users.colRoles", { default: "Roles" }),
            cell: (u) => (
              <RolesPicker
                user={u}
                availableRoles={availableRoles}
                onToggle={(role, checked) => toggleRole.run(u, role, checked)}
                rolesLabel={String(
                  tr("admin.users.rolesLabel", { default: "Roles" }),
                )}
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
          lastLoginAt: {
            label: tr("admin.users.colLastLogin", { default: "Last login" }),
            sortable: true,
            cell: (u) => (
              <span className="text-muted-foreground text-xs">
                {u.lastLoginAt
                  ? String(l(u.lastLoginAt, { date: "fromNow" }))
                  : "—"}
              </span>
            ),
          },
        })}
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
                  onClick: async (
                    _u: UserEntity,
                    { refresh }: { refresh: () => void },
                  ) => {
                    await toggleEnabled.run(u);
                    refresh();
                  },
                },
                {
                  label: tr("admin.users.deleteUser", {
                    default: "Delete user",
                  }),
                  icon: Trash2,
                  destructive: true,
                  onClick: async (
                    _u: UserEntity,
                    { refresh }: { refresh: () => void },
                  ) => {
                    await deleteUser.run(u);
                    refresh();
                  },
                },
              ]
            : []),
        ]}
      />
    </AdminPage>
  );
}

function RolesPicker({
  user,
  availableRoles,
  onToggle,
  rolesLabel,
  noRolesLabel,
}: {
  user: UserEntity;
  availableRoles: RoleMeta[];
  onToggle: (role: string, checked: boolean) => Promise<void>;
  rolesLabel: string;
  noRolesLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  // The users table no longer hard-reloads after a role toggle, so the row's
  // `user.roles` would stay stale. Track an optimistic override locally so the
  // label and checkboxes reflect the change immediately; re-sync whenever the
  // row's roles change (e.g. a table refresh from another action).
  const [optimisticRoles, setOptimisticRoles] = useState<string[] | null>(null);
  useEffect(() => {
    setOptimisticRoles(null);
  }, [user.roles]);

  const userRoles = optimisticRoles ?? user.roles ?? [];
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
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {rolesLabel}
        </div>
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
                      // Reflect the change locally — the table no longer
                      // reloads the row after a role toggle.
                      setOptimisticRoles(
                        next
                          ? Array.from(new Set([...userRoles, role.name]))
                          : userRoles.filter((r) => r !== role.name),
                      );
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
  return (
    <Control
      input={input}
      label=""
      clearable
      clearLabel={String(
        tr("admin.users.statusAll", { default: "All status" }),
      )}
      triggerClassName="w-40"
      items={[
        {
          value: "verified",
          label: String(
            tr("admin.users.statusVerified", { default: "Verified" }),
          ),
        },
        {
          value: "active",
          label: tr("admin.users.statusActive", { default: "Active" }),
        },
        {
          value: "disabled",
          label: String(
            tr("admin.users.statusDisabled", { default: "Disabled" }),
          ),
        },
      ]}
    />
  );
}
