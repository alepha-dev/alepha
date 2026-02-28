import { ActionButton, Control, Flex, Text, useToast } from "@alepha/ui";
import { Badge, Card, Modal, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconKey,
  IconLock,
  IconUser,
} from "@tabler/icons-react";
import { t } from "alepha";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useState } from "react";
import type { IdentityController } from "../../../../api/controllers/IdentityController.ts";

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
  const identityApi = useClient<IdentityController>();
  const toast = useToast();

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

      toast.success({ message: "Password has been set successfully" });

      close();
    },
    onError: (error) => {
      toast.danger({ message: error.message || "Failed to set password" });
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
    <Flex bg={"var(--alepha-ground)"} flex={1} p="lg">
      <Flex direction="column" w="100%" maw={800}>
        <Flex justify="space-between">
          <Title order={2}>My Identities</Title>
          {!hasPasswordIdentity && (
            <ActionButton
              variant="light"
              leftSection={<IconLock size={16} />}
              onClick={open}
            >
              Set Password
            </ActionButton>
          )}
        </Flex>

        <Text c="dimmed" size="sm">
          Manage your account identities and authentication methods.
        </Text>

        <Flex direction="column" gap="md">
          {localIdentities.map((identity) => (
            <Card
              key={identity.id}
              shadow="sm"
              padding="lg"
              radius="md"
              withBorder
            >
              <Flex justify="space-between" align="center">
                <Flex gap="md">
                  {getProviderIcon(identity.provider)}
                  <Flex direction="column" gap={0}>
                    <Flex gap="sm">
                      <Text fw={500}>{getProviderName(identity.provider)}</Text>
                      <Badge
                        variant="light"
                        color={getProviderColor(identity.provider)}
                      >
                        {identity.provider}
                      </Badge>
                    </Flex>
                    <Text size="sm" c="dimmed">
                      {identity.provider === "usernamePassword"
                        ? `Username: ${identity.providerUserId}`
                        : `ID: ${identity.providerUserId}`}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Added: {new Date(identity.createdAt).toLocaleDateString()}
                    </Text>
                  </Flex>
                </Flex>
              </Flex>
            </Card>
          ))}

          {localIdentities.length === 0 && (
            <Card shadow="sm" padding="lg" radius="md" withBorder>
              <Flex align="center" justify="center" py="xl">
                <Flex direction="column" align="center" gap="md">
                  <IconUser size={48} opacity={0.5} />
                  <Text c="dimmed" size="lg" ta="center">
                    No identities found
                  </Text>
                  <Text c="dimmed" size="sm" ta="center">
                    This shouldn't normally happen. Please contact support if
                    you see this.
                  </Text>
                </Flex>
              </Flex>
            </Card>
          )}
        </Flex>

        <Modal opened={opened} onClose={close} title="Set Password" centered>
          <form {...passwordForm.props}>
            <Flex direction="column" gap="md">
              <Text size="sm" c="dimmed">
                Set up a username and password to sign in without external
                providers.
              </Text>

              <Control
                input={passwordForm.input.username}
                label="Username"
                icon={<IconUser size={16} />}
                text={{
                  placeholder: "Choose a username",
                  autoComplete: "username",
                }}
              />

              <Control
                input={passwordForm.input.password}
                label="Password"
                icon={<IconLock size={16} />}
                password={{
                  placeholder: "Enter password",
                  autoComplete: "new-password",
                }}
              />

              <Control
                input={passwordForm.input.confirmPassword}
                label="Confirm Password"
                icon={<IconLock size={16} />}
                password={{
                  placeholder: "Confirm password",
                  autoComplete: "new-password",
                }}
              />

              <Flex justify="flex-end" gap="sm">
                <ActionButton variant="subtle" onClick={close}>
                  Cancel
                </ActionButton>
                <ActionButton form={passwordForm}>Set Password</ActionButton>
              </Flex>
            </Flex>
          </form>
        </Modal>
      </Flex>
    </Flex>
  );
};

export default MyIdentities;
