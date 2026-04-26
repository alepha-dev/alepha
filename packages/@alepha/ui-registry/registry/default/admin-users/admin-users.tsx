import type { Page } from "alepha";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Eye, Trash2, UserCheck, UserX } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AlephaTable } from "@/registry/default/alepha-table/alepha-table";
import { useConfirm } from "@/registry/default/use-confirm/use-confirm";

export interface AdminUsersProps {
  userRealmName?: string;
}

export function AdminUsers(props: AdminUsersProps) {
  const client = useClient<AdminUserController>();
  const router = useRouter();
  const { l } = useI18n();
  const confirm = useConfirm();
  const [refreshKey, setRefreshKey] = useState(0);

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findUsers({
        query: {
          ...params,
          userRealmName: props.userRealmName,
        } as never,
      });
      return res as Page<UserEntity>;
    },
    [client, props.userRealmName, refreshKey],
  );

  const handleToggleEnabled = async (user: UserEntity) => {
    const enable = !user.enabled;
    const ok = await confirm({
      title: enable ? "Enable user" : "Disable user",
      description: enable
        ? `Enable ${user.email || user.username || "this user"}?`
        : `Disable ${user.email || user.username || "this user"}? They will no longer be able to sign in.`,
      destructive: !enable,
    });
    if (!ok) return;
    await client.updateUser({
      params: { id: user.id },
      query: { userRealmName: props.userRealmName },
      body: { enabled: enable },
    });
    toast.success(enable ? "User enabled" : "User disabled");
    setRefreshKey((k) => k + 1);
  };

  const handleDelete = async (user: UserEntity) => {
    const ok = await confirm({
      title: "Delete user",
      description: `Permanently delete ${user.email || user.username || "this user"}? This action cannot be undone.`,
      destructive: true,
    });
    if (!ok) return;
    await client.deleteUser({
      params: { id: user.id },
      query: { userRealmName: props.userRealmName },
    });
    toast.success("User deleted");
    setRefreshKey((k) => k + 1);
  };

  const handleBulkDisable = async (items: UserEntity[], clear: () => void) => {
    const enabled = items.filter((u) => u.enabled);
    if (enabled.length === 0) {
      toast.error("No active users in selection");
      return;
    }
    const ok = await confirm({
      title: "Disable users",
      description: `Disable ${enabled.length} user(s)? They will no longer be able to sign in.`,
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
    toast.success(`${enabled.length} user(s) disabled`);
    clear();
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="p-6">
      <AlephaTable<UserEntity>
        fetch={fetcher}
        bulkActions={[
          {
            label: "Disable selected",
            icon: UserX,
            destructive: true,
            onClick: handleBulkDisable,
          },
        ]}
        columns={{
          user: {
            label: "User",
            cell: (u) => {
              const name =
                `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
                u.username ||
                "Anonymous";
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
            label: "Roles",
            cell: (u) =>
              u.roles.length > 0 ? (
                <div className="flex gap-1">
                  {u.roles.map((r: string) => (
                    <Badge key={r} variant="secondary">
                      {r}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">No roles</span>
              ),
          },
          enabled: {
            label: "Status",
            cell: (u) => (
              <Badge variant={u.enabled ? "default" : "destructive"}>
                {u.enabled ? "Active" : "Disabled"}
              </Badge>
            ),
          },
          emailVerified: {
            label: "Email",
            cell: (u) => (
              <Badge variant={u.emailVerified ? "default" : "outline"}>
                {u.emailVerified ? "Verified" : "Unverified"}
              </Badge>
            ),
          },
          createdAt: {
            label: "Joined",
            sortable: true,
            cell: (u) => (
              <span className="text-muted-foreground text-xs">
                {String(l(u.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(u) => [
          {
            label: "View profile",
            icon: Eye,
            onClick: () => router.push(`/admin/users/${u.id}` as never),
          },
          {
            label: u.enabled ? "Disable user" : "Enable user",
            icon: u.enabled ? UserX : UserCheck,
            onClick: () => handleToggleEnabled(u),
          },
          {
            label: "Delete user",
            icon: Trash2,
            destructive: true,
            onClick: () => handleDelete(u),
          },
        ]}
      />
    </div>
  );
}
