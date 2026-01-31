import { ActionButton, Control, Flex } from "@alepha/ui";
import { Card, Stack, Text } from "@mantine/core";
import { t } from "alepha";
import type { AdminUserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import type { AdminRouter } from "../../AdminRouter.ts";

export interface AdminUserCreateProps {
  userRealmName?: string;
}

const AdminUserCreate = (props: AdminUserCreateProps) => {
  const client = useClient<AdminUserController>();
  const router = useRouter<AdminRouter>();

  const form = useForm({
    schema: t.object({
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
    }),
    handler: async (data) => {
      const user = await client.createUser({
        query: {
          userRealmName: props.userRealmName,
        },
        body: {
          ...data,
          enabled: data.enabled ?? true,
        },
      });

      await router.push("adminUserDetails", {
        params: { userId: user.id },
      });
    },
  });

  return (
    <Flex flex={1} p="md">
      <Card withBorder p="lg" maw={600} w="100%">
        <form {...form.props}>
          <Stack gap="md">
            <Text size="lg" fw={500}>
              Create New User
            </Text>

            <Control title="Username" input={form.input.username} />

            <Control title="Email" input={form.input.email} />

            <Control title="Phone Number" input={form.input.phoneNumber} />

            <Control title="First Name" input={form.input.firstName} />

            <Control title="Last Name" input={form.input.lastName} />

            <Control title="Password" input={form.input.password} password />

            <Control title="Roles" input={form.input.roles} />

            <Control title="Enabled" input={form.input.enabled} />

            <ActionButton form={form}>Create User</ActionButton>
          </Stack>
        </form>
      </Card>
    </Flex>
  );
};

export default AdminUserCreate;
