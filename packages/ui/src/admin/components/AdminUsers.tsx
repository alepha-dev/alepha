import { useClient } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Text } from "@alepha/ui";
import { Badge, Flex, Group } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { type UserController, type UserEntity, users } from "alepha/api/users";

export interface AdminUsersProps {
  userRealmName?: string;
}

const AdminUsers = (props: AdminUsersProps) => {
  const client = useClient<UserController>();
  const { l } = useI18n();

  const filters = t.object({
    query: t.optional(
      t.string({
        $control: {
          query: t.omit(users.schema, ["id", "version"]),
        },
      }),
    ),
  });

  return (
    <Flex flex={1} direction={"column"}>
      <DataTable<UserEntity, typeof filters>
        submitOnInit
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
        }}
        onFilterChange={(key, value, form) => {
          if (key === "query") {
            return form.submit();
          }
        }}
        filters={filters}
        tableTrProps={(item) => {
          if (!item.enabled) {
            return {
              opacity: 0.5,
            };
          }
          return {};
        }}
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
                {item.username || "-"}
              </Text>
            ),
          },
          email: {
            label: "Email",
            value: (item) => (
              <Group gap="xs">
                <Text size="sm">{item.email || "-"}</Text>
                {item.email && (
                  <Badge
                    size="xs"
                    variant="light"
                    color={item.emailVerified ? "green" : "gray"}
                    leftSection={
                      item.emailVerified ? (
                        <IconCheck size={10} />
                      ) : (
                        <IconX size={10} />
                      )
                    }
                  >
                    {item.emailVerified ? "Verified" : "Unverified"}
                  </Badge>
                )}
              </Group>
            ),
          },
          roles: {
            label: "Roles",
            value: (item) => (
              <Group gap={4}>
                {item.roles.map((role: string) => (
                  <Badge key={role} size="xs" variant="outline">
                    {role}
                  </Badge>
                ))}
              </Group>
            ),
          },
          enabled: {
            label: "Status",
            fit: true,
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
