import {
  ActionButton,
  DataTable,
  Flex,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Avatar, Badge } from "@mantine/core";
import {
  IconEye,
  IconTrash,
  IconUserOff,
  IconUserPlus,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { AdminRouter } from "../../AdminRouter.tsx";

export interface AdminUsersProps {
  userRealmName?: string;
}

const filters = t.object({
  query: t.optional(t.text()),
  enabled: t.optional(t.boolean()),
  emailVerified: t.optional(t.boolean()),
});

const AdminUsers = (props: AdminUsersProps) => {
  const client = useClient<AdminUserController>();
  const router = useRouter<AdminRouter>();
  const { l } = useI18n();
  const dialog = useDialog();
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleToggleEnabled = async (user: UserEntity) => {
    const enabled = !user.enabled;
    const confirmed = await dialog.confirm({
      title: enabled ? "Enable user" : "Disable user",
      message: enabled
        ? `Enable ${user.email || user.username || "this user"}?`
        : `Disable ${user.email || user.username || "this user"}? They will no longer be able to sign in.`,
    });
    if (!confirmed) return;
    await client.updateUser({
      params: { id: user.id },
      query: { userRealmName: props.userRealmName },
      body: { enabled },
    });
    toast.success({
      message: enabled ? "User enabled" : "User disabled",
    });
    refresh();
  };

  const handleDelete = async (user: UserEntity) => {
    const confirmed = await dialog.confirm({
      title: "Delete user",
      message: `Permanently delete ${user.email || user.username || "this user"}? This action cannot be undone.`,
    });
    if (!confirmed) return;
    await client.deleteUser({
      params: { id: user.id },
      query: { userRealmName: props.userRealmName },
    });
    toast.success({ message: "User deleted" });
    refresh();
  };

  const handleBulkDisable = async (
    items: UserEntity[],
    clearSelection: () => void,
  ) => {
    const enabledUsers = items.filter((u) => u.enabled);
    if (enabledUsers.length === 0) {
      toast.danger({ message: "No active users in selection" });
      return;
    }
    const confirmed = await dialog.confirm({
      title: "Disable users",
      message: `Disable ${enabledUsers.length} user(s)? They will no longer be able to sign in.`,
    });
    if (!confirmed) return;
    for (const user of enabledUsers) {
      await client.updateUser({
        params: { id: user.id },
        query: { userRealmName: props.userRealmName },
        body: { enabled: false },
      });
    }
    toast.success({
      message: `${enabledUsers.length} user(s) disabled`,
    });
    clearSelection();
    refresh();
  };

  return (
    <Flex p={"md"} flex={1} direction="column">
      <DataTable<UserEntity, typeof filters>
        withCheckbox
        withExport
        checkboxActions={[
          {
            intent: "danger",
            label: "Disable selected",
            icon: <IconUserOff />,
            onClick: (ctx) =>
              handleBulkDisable(ctx.selectedItems, ctx.clearSelection),
          },
        ]}
        key={refreshKey}
        submitOnInit
        defaultSize={10}
        defaultFilters={["query"]}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
        }}
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={filters}
        items={async (filters) => {
          const response = await client.findUsers({
            query: {
              ...filters,
              userRealmName: props.userRealmName,
            },
          });
          return response as Page<UserEntity>;
        }}
        columns={{
          user: {
            label: "User",
            value: (item) => {
              const name =
                `${item.firstName || ""} ${item.lastName || ""}`.trim() ||
                item.username ||
                "Anonymous";

              return (
                <ActionButton
                  variant={"transparent"}
                  href={`/admin/users/${item.id}`}
                >
                  <Flex gap={"xs"} centerY>
                    <Avatar size={"sm"} name={name} />
                    <Flex col>
                      <Text size={"sm"} bold>
                        {name}
                      </Text>
                      <Text size="xs" muted>
                        {item.email || "\u2014"}
                      </Text>
                    </Flex>
                  </Flex>
                </ActionButton>
              );
            },
          },
          username: {
            label: "Username",
            defaultHidden: true,
            value: (item) => (
              <Text size="sm" ff="monospace">
                {item.username || "\u2014"}
              </Text>
            ),
          },
          roles: {
            label: "Roles",
            value: (item) =>
              item.roles.length > 0 ? (
                <Flex gap={4}>
                  {item.roles.map((role: string) => (
                    <Badge key={role} size="xs" variant="default">
                      {role}
                    </Badge>
                  ))}
                </Flex>
              ) : (
                <Text size="xs" muted>
                  No roles
                </Text>
              ),
          },
          enabled: {
            label: "Status",
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={item.enabled ? "green" : "red"}
              >
                {item.enabled ? "Active" : "Disabled"}
              </Badge>
            ),
          },
          emailVerified: {
            label: "Email",
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={item.emailVerified ? "green" : "gray"}
              >
                {item.emailVerified ? "Verified" : "Unverified"}
              </Badge>
            ),
          },
          createdAt: {
            label: "Joined",
            sortable: true,
            sortKey: "createdAt",
            value: (item) => (
              <Text size="xs" muted>
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
        rowActions={(item) => [
          {
            label: "View profile",
            icon: IconEye,
            onClick: () =>
              router.push("adminUserProfile", {
                params: { userId: item.id },
              }),
          },
          {
            label: item.enabled ? "Disable user" : "Enable user",
            icon: item.enabled ? IconUserOff : IconUserPlus,
            color: item.enabled ? "red" : "green",
            onClick: () => handleToggleEnabled(item),
          },
          {
            label: "Delete user",
            icon: IconTrash,
            color: "red",
            onClick: () => handleDelete(item),
          },
        ]}
      />
    </Flex>
  );
};

export default AdminUsers;
