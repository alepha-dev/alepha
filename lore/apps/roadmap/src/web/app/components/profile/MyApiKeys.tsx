import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card, Code, CopyButton, Modal, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCheck,
  IconClipboard,
  IconKey,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { t } from "alepha";
import type { ApiKeyController } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useState } from "react";
import { theme } from "../../constants/theme.ts";
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
  const apiKeyApi = useClient<ApiKeyController>();
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
    await apiKeyApi.revokeMyApiKey({ params: { id } });
    setApiKeys((prev) => prev.filter((key) => key.id !== id));
  };

  return (
    <Flex direction="column" w="100%" p="xs" gap={0}>
      <Flex p="xs" justify="space-between">
        <Flex px={1}>
          <Text size="xs" c="dimmed">
            MCP API keys allow Claude and other LLM clients to access all your
            campaigns.
          </Text>
        </Flex>

        <Flex align="center" justify="center">
          <ActionButton leftSection={<IconPlus size={16} />} onClick={open}>
            Create Key
          </ActionButton>
        </Flex>
      </Flex>

      <Card withBorder bg={theme.colors.panel} w="100%" p="xs" radius="md">
        <Flex direction="column" gap="xs">
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
                <Flex justify="space-between" wrap="nowrap">
                  <Flex align="center" gap="sm">
                    <IconKey size={20} />
                    <Flex direction="column" gap={0}>
                      <Flex gap="xs">
                        <Text size="sm" fw={500}>
                          {key.name}
                        </Text>
                        <Code>...{key.tokenSuffix}</Code>
                      </Flex>
                      <Flex gap="xs">
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
                      </Flex>
                    </Flex>
                  </Flex>
                  <Tooltip label="Revoke key">
                    <ActionButton
                      variant="subtle"
                      color="red"
                      onClick={() => handleRevoke(key.id)}
                    >
                      <IconTrash size={16} />
                    </ActionButton>
                  </Tooltip>
                </Flex>
              </Card>
            ))
          )}
        </Flex>
      </Card>

      <Modal opened={opened} onClose={close} title="Create MCP API Key">
        <form {...form.props}>
          <Flex direction="column" gap="md">
            <Control
              input={form.input.name}
              title="Key Name"
              text={{ placeholder: "e.g., Claude Desktop" }}
            />
            <Flex justify="flex-end">
              <ActionButton variant="subtle" onClick={close}>
                Cancel
              </ActionButton>
              <ActionButton form={form}>Create</ActionButton>
            </Flex>
          </Flex>
        </form>
      </Modal>

      <Modal
        opened={!!newToken}
        onClose={() => setNewToken(null)}
        title="API Key Created"
        closeOnClickOutside={false}
      >
        <Flex direction="column" gap="md">
          <Text size="sm">
            Copy this API key now. You won't be able to see it again.
          </Text>
          <Flex gap="xs">
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
                  <ActionButton
                    variant="subtle"
                    color={copied ? "green" : "gray"}
                    onClick={copy}
                  >
                    {copied ? (
                      <IconCheck size={16} />
                    ) : (
                      <IconClipboard size={16} />
                    )}
                  </ActionButton>
                </Tooltip>
              )}
            </CopyButton>
          </Flex>
          <Card withBorder p="sm" bg={theme.colors.panel}>
            <Text size="xs" fw={500} mb="xs">
              Claude Code
            </Text>
            <Flex gap="xs" wrap="nowrap">
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
                    <ActionButton
                      variant="subtle"
                      color={copied ? "green" : "gray"}
                      onClick={copy}
                    >
                      {copied ? (
                        <IconCheck size={16} />
                      ) : (
                        <IconClipboard size={16} />
                      )}
                    </ActionButton>
                  </Tooltip>
                )}
              </CopyButton>
            </Flex>
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
          <Flex justify="flex-end">
            <ActionButton onClick={() => setNewToken(null)}>Done</ActionButton>
          </Flex>
        </Flex>
      </Modal>
    </Flex>
  );
};

export default MyApiKeys;
