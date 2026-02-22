import { DataTable, Flex, Text, useDialog, useToast } from "@alepha/ui";
import { Badge } from "@mantine/core";
import { IconUsersPlus } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { AdminRouter } from "../../AdminRouter.ts";

export interface AdminUsersProps {
  userRealmName?: string;
}

const createUserSchema = t.object({
  username: t.optional(
    t.shortText({
      minLength: 3,
      maxLength: 50,
      pattern: "^[a-zA-Z0-9._-]+$",
    }),
  ),
  email: t.optional(t.email()),
  phoneNumber: t.optional(t.e164()),
  firstName: t.optional(t.string()),
  lastName: t.optional(t.string()),
  roles: t.optional(t.array(t.string())),
  enabled: t.optional(t.boolean()),
  password: t.optional(t.string({ minLength: 8 })),
});

const AdminUsers = (props: AdminUsersProps) => {
  const client = useClient<AdminUserController>();
  const router = useRouter<AdminRouter>();
  const { l } = useI18n();
  const dialog = useDialog();
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreate = async () => {
    const data = await dialog.form({
      title: "Create User",
      schema: createUserSchema,
      columns: 2,
      submitLabel: "Create",
    });
    if (data) {
      await client.createUser({
        query: { userRealmName: props.userRealmName },
        body: { ...data, enabled: data.enabled ?? true },
      });
      toast.success({ title: "User created" });
      setRefreshKey((k) => k + 1);
    }
  };

  const filters = t.object({
    query: t.optional(
      t.string({
        $control: {
          query: t.object({
            email: t.optional(t.email()),
            enabled: t.optional(t.boolean()),
            emailVerified: t.optional(t.boolean()),
          }),
        },
      }),
    ),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<UserEntity, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconUsersPlus,
            onClick: handleCreate,
            label: "Create User",
          },
        ]}
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
          highlightOnHover: true,
        }}
        onFilterChange={(key, _value, form) => {
          if (key === "query") {
            return form.submit();
          }
        }}
        filters={filters}
        tableTrProps={(item) => ({
          style: {
            cursor: "pointer",
            opacity: item.enabled ? 1 : 0.5,
          },
          onClick: () =>
            router.push("adminUserProfile", {
              params: { userId: item.id },
            }),
        })}
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
          username: {
            label: "Username",
            value: (item) => (
              <Text size="sm" fw={500}>
                {item.username || "\u2014"}
              </Text>
            ),
          },
          email: {
            label: "Email",
            value: (item) => <Text size="sm">{item.email || "\u2014"}</Text>,
          },
          roles: {
            label: "Roles",
            value: (item) => (
              <Flex gap={4}>
                {item.roles.map((role: string) => (
                  <Badge key={role} size="xs" variant="default">
                    {role}
                  </Badge>
                ))}
              </Flex>
            ),
          },
          enabled: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Text size="sm" c="dimmed">
                {item.enabled ? "Active" : "Disabled"}
              </Text>
            ),
          },
          createdAt: {
            label: "Created",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
      />
    </Flex>
  );
};

export default AdminUsers;
