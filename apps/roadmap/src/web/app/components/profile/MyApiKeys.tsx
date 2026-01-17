import { useClient, useInject } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import {
  ActionIcon,
  Badge,
  Card,
  Code,
  CopyButton,
  Flex,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCheck,
  IconClipboard,
  IconKey,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useState } from "react";
import type { McpApiKeyController } from "../../../../api/controllers/McpApiKeyController.ts";
import { theme } from "../../constants/theme.ts";
import Action from "../ui/Action.tsx";
import Control from "../ui/Control.tsx";

interface ApiKey {
  id: string;
  name: string;
  tokenSuffix: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface MyApiKeysProps {
  apiKeys: ApiKey[];
}

const MyApiKeys = (props: MyApiKeysProps) => {
  const dt = useInject(DateTimeProvider);
  const apiKeyApi = useClient<McpApiKeyController>();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(props.apiKeys);
  const [opened, { open, close }] = useDisclosure(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const form = useForm({
    id: "create-api-key",
    schema: t.object({
      name: t.string({ minLength: 1, maxLength: 100 }),
    }),
    handler: async (data) => {
      const result = await apiKeyApi.createApiKey({
        body: {
          name: data.name,
        },
      });
      setApiKeys((prev) => [
        {
          id: result.id,
          name: result.name,
          tokenSuffix: result.tokenSuffix,
          createdAt: result.createdAt,
          lastUsedAt: undefined,
          expiresAt: result.expiresAt,
        },
        ...prev,
      ]);
      setNewToken(result.token);
      close();
    },
  });

  const handleRevoke = async (id: string) => {
    await apiKeyApi.revokeApiKey({ params: { id } });
    setApiKeys((prev) => prev.filter((key) => key.id !== id));
  };

  return (
    <Stack w="100%" p="xs" gap={0}>
      <Group p="xs" justify="space-between">
        <Flex px={1}>
          <Text size="xs" c="dimmed">
            MCP API keys allow Claude and other LLM clients to access all your
            campaigns.
          </Text>
        </Flex>

        <Flex align="center" justify="center">
          <Action leftSection={<IconPlus size={16} />} onClick={open}>
            Create Key
          </Action>
        </Flex>
      </Group>

      <Card withBorder bg={theme.colors.panel} w="100%" p="xs" radius="md">
        <Stack gap="xs">
          {apiKeys.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              No API keys yet. Create one to connect Claude or other MCP
              clients.
            </Text>
          ) : (
            apiKeys.map((key) => (
              <Card
                key={key.id}
                withBorder
                bg={theme.colors.card}
                p="sm"
                radius="sm"
              >
                <Group justify="space-between" wrap="nowrap">
                  <Flex align="center" gap="sm">
                    <IconKey size={20} />
                    <Stack gap={0}>
                      <Group gap="xs">
                        <Text size="sm" fw={500}>
                          {key.name}
                        </Text>
                        <Code>...{key.tokenSuffix}</Code>
                      </Group>
                      <Group gap="xs">
                        <Text size="xs" c="dimmed">
                          Created {dt.of(key.createdAt).fromNow()}
                        </Text>
                        {key.lastUsedAt && (
                          <>
                            <Text size="xs" c="dimmed">
                              |
                            </Text>
                            <Text size="xs" c="dimmed">
                              Last used {dt.of(key.lastUsedAt).fromNow()}
                            </Text>
                          </>
                        )}
                        {key.expiresAt && (
                          <Badge size="xs" color="yellow">
                            Expires {dt.of(key.expiresAt).fromNow()}
                          </Badge>
                        )}
                      </Group>
                    </Stack>
                  </Flex>
                  <Tooltip label="Revoke key">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleRevoke(key.id)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Card>
            ))
          )}
        </Stack>
      </Card>

      <Modal opened={opened} onClose={close} title="Create MCP API Key">
        <form {...form.props}>
          <Stack gap="md">
            <Control
              input={form.input.name}
              title="Key Name"
              text={{ placeholder: "e.g., Claude Desktop" }}
            />
            <Group justify="flex-end">
              <Action variant="subtle" onClick={close}>
                Cancel
              </Action>
              <Action form={form}>Create</Action>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={!!newToken}
        onClose={() => setNewToken(null)}
        title="API Key Created"
        closeOnClickOutside={false}
      >
        <Stack gap="md">
          <Text size="sm">
            Copy this API key now. You won't be able to see it again.
          </Text>
          <Group gap="xs">
            <Code
              block
              style={{
                flex: 1,
                wordBreak: "break-all",
              }}
            >
              {newToken}
            </Code>
            <CopyButton value={newToken || ""}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copied!" : "Copy"}>
                  <ActionIcon
                    variant="subtle"
                    color={copied ? "green" : "gray"}
                    onClick={copy}
                  >
                    {copied ? (
                      <IconCheck size={16} />
                    ) : (
                      <IconClipboard size={16} />
                    )}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          <Card withBorder p="sm" bg={theme.colors.panel}>
            <Text size="xs" fw={500} mb="xs">
              Claude Code
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Code
                block
                style={{
                  flex: 1,
                  wordBreak: "break-all",
                  fontSize: "11px",
                }}
              >
                {`claude mcp add roadmap ${typeof window !== "undefined" ? window.location.origin : ""}/mcp -t http -H "Authorization: Bearer ${newToken}"`}
              </Code>
              <CopyButton
                value={`claude mcp add roadmap ${typeof window !== "undefined" ? window.location.origin : ""}/mcp -t http -H "Authorization: Bearer ${newToken}"`}
              >
                {({ copied, copy }) => (
                  <Tooltip label={copied ? "Copied!" : "Copy"}>
                    <ActionIcon
                      variant="subtle"
                      color={copied ? "green" : "gray"}
                      onClick={copy}
                    >
                      {copied ? (
                        <IconCheck size={16} />
                      ) : (
                        <IconClipboard size={16} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          </Card>
          <Card withBorder p="sm" bg={theme.colors.panel}>
            <Text size="xs" fw={500} mb="xs">
              MCP Configuration (JSON)
            </Text>
            <Code block style={{ wordBreak: "break-all" }}>
              {JSON.stringify(
                {
                  type: "sse",
                  url: `${typeof window !== "undefined" ? window.location.origin : ""}/mcp`,
                  headers: {
                    Authorization: `Bearer ${newToken}`,
                  },
                },
                null,
                2,
              )}
            </Code>
          </Card>
          <Text size="xs" c="dimmed">
            This key gives access to all your campaigns. Use the project_list
            tool to see available campaigns, then specify project_name in other
            tools.
          </Text>
          <Group justify="flex-end">
            <Action onClick={() => setNewToken(null)}>Done</Action>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default MyApiKeys;
