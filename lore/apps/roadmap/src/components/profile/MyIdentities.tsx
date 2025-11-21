import { useClient } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import {
  Badge,
  Card,
  Flex,
  Group,
  Modal,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconKey,
  IconLock,
  IconUser,
} from "@tabler/icons-react";
import { t } from "alepha";
import { useState } from "react";
import type { IdentityApi } from "../../api/IdentityApi.ts";
import Action from "../ui/Action.jsx";
import Control from "../ui/Control.jsx";

export interface MyIdentitiesProps {
  identities: Array<{
    id: string;
    provider: string;
    providerUserId: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

const MyIdentities = (props: MyIdentitiesProps) => {
  const { identities } = props;
  const [opened, { open, close }] = useDisclosure(false);
  const [localIdentities, setLocalIdentities] = useState(identities);
  const identityApi = useClient<IdentityApi>();

  const hasPasswordIdentity = localIdentities.some(
    (identity) => identity.provider === "usernamePassword",
  );

  const passwordForm = useForm({
    schema: t.object({
      username: t.string({ minLength: 3, maxLength: 50 }),
      password: t.string({ minLength: 6, maxLength: 128 }),
      confirmPassword: t.string({ minLength: 6, maxLength: 128 }),
    }),
    handler: async (data) => {
      if (data.password !== data.confirmPassword) {
        throw new Error("Passwords do not match");
      }

      await identityApi.setPassword({
        body: {
          username: data.username,
          password: data.password,
        },
      });

      // Add the new identity to the local state
      const newIdentity = {
        id: crypto.randomUUID(),
        provider: "usernamePassword",
        providerUserId: data.username,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setLocalIdentities((prev) => [...prev, newIdentity]);

      notifications.show({
        title: "Success",
        message: "Password has been set successfully",
        color: "green",
      });

      close();
    },
    onError: (error) => {
      notifications.show({
        title: "Error",
        message: error.message || "Failed to set password",
        color: "red",
      });
    },
  });

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "google":
        return <IconBrandGoogle size={20} />;
      case "github":
        return <IconBrandGithub size={20} />;
      case "usernamePassword":
        return <IconKey size={20} />;
      default:
        return <IconUser size={20} />;
    }
  };

  const getProviderName = (provider: string) => {
    switch (provider) {
      case "google":
        return "Google";
      case "github":
        return "GitHub";
      case "usernamePassword":
        return "Username & Password";
      default:
        return provider;
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case "google":
        return "red";
      case "github":
        return "dark";
      case "usernamePassword":
        return "blue";
      default:
        return "gray";
    }
  };

  return (
    <Flex bg={"var(--alepha-background)"} flex={1} p="lg">
      <Stack w="100%" maw={800}>
        <Group justify="space-between">
          <Title order={2}>My Identities</Title>
          {!hasPasswordIdentity && (
            <Action
              variant="light"
              leftSection={<IconLock size={16} />}
              onClick={open}
            >
              Set Password
            </Action>
          )}
        </Group>

        <Text c="dimmed" size="sm">
          Manage your account identities and authentication methods.
        </Text>

        <Stack gap="md">
          {localIdentities.map((identity) => (
            <Card
              key={identity.id}
              shadow="sm"
              padding="lg"
              radius="md"
              withBorder
            >
              <Group justify="space-between" align="center">
                <Group gap="md">
                  {getProviderIcon(identity.provider)}
                  <Stack gap={0}>
                    <Group gap="sm">
                      <Text fw={500}>{getProviderName(identity.provider)}</Text>
                      <Badge
                        variant="light"
                        color={getProviderColor(identity.provider)}
                      >
                        {identity.provider}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {identity.provider === "usernamePassword"
                        ? `Username: ${identity.providerUserId}`
                        : `ID: ${identity.providerUserId}`}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Added: {new Date(identity.createdAt).toLocaleDateString()}
                    </Text>
                  </Stack>
                </Group>
              </Group>
            </Card>
          ))}

          {localIdentities.length === 0 && (
            <Card shadow="sm" padding="lg" radius="md" withBorder>
              <Flex align="center" justify="center" py="xl">
                <Stack align="center" gap="md">
                  <IconUser size={48} opacity={0.5} />
                  <Text c="dimmed" size="lg" ta="center">
                    No identities found
                  </Text>
                  <Text c="dimmed" size="sm" ta="center">
                    This shouldn't normally happen. Please contact support if
                    you see this.
                  </Text>
                </Stack>
              </Flex>
            </Card>
          )}
        </Stack>

        <Modal opened={opened} onClose={close} title="Set Password" centered>
          <form {...passwordForm.props}>
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Set up a username and password to sign in without external
                providers.
              </Text>

              <Control
                input={passwordForm.input.username}
                title="Username"
                icon={<IconUser size={16} />}
                text={{
                  placeholder: "Choose a username",
                  autoComplete: "username",
                }}
              />

              <Control
                input={passwordForm.input.password}
                title="Password"
                icon={<IconLock size={16} />}
                password={{
                  placeholder: "Enter password",
                  autoComplete: "new-password",
                }}
              />

              <Control
                input={passwordForm.input.confirmPassword}
                title="Confirm Password"
                icon={<IconLock size={16} />}
                password={{
                  placeholder: "Confirm password",
                  autoComplete: "new-password",
                }}
              />

              <Group justify="flex-end" gap="sm">
                <Action variant="subtle" onClick={close}>
                  Cancel
                </Action>
                <Action form={passwordForm}>Set Password</Action>
              </Group>
            </Stack>
          </form>
        </Modal>
      </Stack>
    </Flex>
  );
};

export default MyIdentities;
