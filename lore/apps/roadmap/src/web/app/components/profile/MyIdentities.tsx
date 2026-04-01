import { ActionButton, Control, Flex, Text, useToast } from "@alepha/ui";
import { Badge, Modal } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconKey,
  IconLock,
  IconShield,
  IconUser,
} from "@tabler/icons-react";
import { t } from "alepha";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { IdentityController } from "@/api/controllers/IdentityController.ts";

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
  const { l } = useI18n();

  const hasPasswordIdentity = localIdentities.some(
    (identity) => identity.provider === "usernamePassword",
  );

  const passwordForm = useForm({
    schema: t.object({
      username: t.string({ minLength: 3, maxLength: 30 }),
      password: t.string({ minLength: 6, maxLength: 128 }),
      confirmPassword: t.string({ minLength: 6, maxLength: 128 }),
    }),
    handler: async (data) => {
      if (data.password !== data.confirmPassword) {
        throw new Error("Passwords do not match");
      }

      await identityApi.setPassword({
        body: { username: data.username, password: data.password },
      });

      setLocalIdentities((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          provider: "usernamePassword",
          providerUserId: data.username,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      toast.success({ message: "Password has been set successfully" });
      close();
    },
    onError: (error) => {
      toast.danger({ message: error.message || "Failed to set password" });
    },
  });

  const providerIcon = (provider: string) => {
    const size = 16;
    if (provider === "google") return <IconBrandGoogle size={size} />;
    if (provider === "github") return <IconBrandGithub size={size} />;
    if (provider === "usernamePassword") return <IconKey size={size} />;
    return <IconUser size={size} />;
  };

  const providerLabel = (provider: string) => {
    if (provider === "google") return "Google";
    if (provider === "github") return "GitHub";
    if (provider === "usernamePassword") return "Password";
    return provider;
  };

  const providerColor = (provider: string) => {
    if (provider === "google") return "red";
    if (provider === "github") return "gray";
    if (provider === "usernamePassword") return "blue";
    return "gray";
  };

  return (
    <Flex direction="column" gap="lg" flex={1} py="md">
      <Flex justify="space-between" align="center">
        <Flex align="center" gap="sm">
          <IconShield size={20} />
          <Text size="lg" fw={700}>
            Identities
          </Text>
          <Badge variant="light" size="sm">
            {localIdentities.length}
          </Badge>
        </Flex>
        {!hasPasswordIdentity && (
          <ActionButton
            size="xs"
            variant="light"
            leftSection={<IconLock size={14} />}
            onClick={open}
          >
            Set Password
          </ActionButton>
        )}
      </Flex>

      <Flex direction="column" gap="sm">
        {localIdentities.map((identity) => (
          <Flex
            key={identity.id}
            align="center"
            gap="md"
            p="md"
            bg="var(--alepha-elevated)"
            style={{
              borderRadius: "var(--mantine-radius-md)",
              border: "1px solid var(--alepha-border)",
            }}
          >
            <Flex
              w={36}
              h={36}
              align="center"
              justify="center"
              style={{
                borderRadius: "var(--mantine-radius-sm)",
                background: "var(--alepha-surface)",
              }}
            >
              {providerIcon(identity.provider)}
            </Flex>

            <Flex direction="column" gap={0} flex={1}>
              <Flex align="center" gap="xs">
                <Text size="sm" fw={600}>
                  {providerLabel(identity.provider)}
                </Text>
                <Badge variant="dot" color={providerColor(identity.provider)} size="xs">
                  Active
                </Badge>
              </Flex>
              <Text size="xs" c="dimmed">
                {identity.provider === "usernamePassword"
                  ? identity.providerUserId
                  : `ID: ${identity.providerUserId}`}
              </Text>
            </Flex>

            <Text size="xs" c="dimmed">
              {l(identity.createdAt)}
            </Text>
          </Flex>
        ))}

        {localIdentities.length === 0 && (
          <Flex
            align="center"
            justify="center"
            direction="column"
            gap="sm"
            py="xl"
          >
            <IconUser size={40} opacity={0.3} />
            <Text c="dimmed" ta="center">
              No identities found. This shouldn't happen.
            </Text>
          </Flex>
        )}
      </Flex>

      <Modal opened={opened} onClose={close} title="Set Password" centered>
        <form {...passwordForm.props}>
          <Flex direction="column" gap="md">
            <Text size="sm" c="dimmed">
              Set up a username and password to sign in without external providers.
            </Text>

            <Control
              input={passwordForm.input.username}
              label="Username"
              icon={<IconUser size={16} />}
              text={{ placeholder: "Choose a username", autoComplete: "username" }}
            />

            <Control
              input={passwordForm.input.password}
              label="Password"
              icon={<IconLock size={16} />}
              password={{ placeholder: "Enter password", autoComplete: "new-password" }}
            />

            <Control
              input={passwordForm.input.confirmPassword}
              label="Confirm Password"
              icon={<IconLock size={16} />}
              password={{ placeholder: "Confirm password", autoComplete: "new-password" }}
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
  );
};

export default MyIdentities;
