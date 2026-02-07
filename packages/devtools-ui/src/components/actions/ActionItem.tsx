import {
  Accordion,
  ActionIcon,
  Badge,
  Box,
  Code,
  CopyButton,
  Group,
  Stack,
  Tabs,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconLock,
  IconTerminal,
} from "@tabler/icons-react";
import type { DevActionMetadata } from "alepha/devtools";
import { useMemo } from "react";
import { generateCurl } from "./helpers.ts";
import { MethodBadge } from "./MethodBadge.tsx";
import { SchemaViewer } from "./SchemaViewer.tsx";
import { TryItPanel } from "./TryItPanel.tsx";

interface ActionItemProps {
  action: DevActionMetadata;
}

export const ActionItem = ({ action }: ActionItemProps) => {
  const curl = useMemo(() => generateCurl(action), [action]);

  return (
    <Accordion.Item value={action.fullPath} opacity={action.disabled ? 0.5 : 1}>
      <Accordion.Control>
        <Group gap="sm" wrap="nowrap">
          <MethodBadge method={action.method} />
          <Text size="sm" ff="monospace" style={{ wordBreak: "break-all" }}>
            {action.fullPath}
          </Text>
          {action.secure && (
            <Tooltip label="Requires authentication">
              <IconLock size={14} opacity={0.5} />
            </Tooltip>
          )}
          {action.disabled && (
            <Badge size="xs" variant="light" color="gray">
              disabled
            </Badge>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="md">
          {(action.description || action.summary) && (
            <Text size="sm" c="dimmed">
              {action.description || action.summary}
            </Text>
          )}

          <Tabs defaultValue="schema" variant="outline">
            <Tabs.List>
              <Tabs.Tab value="schema" size="xs">
                Schema
              </Tabs.Tab>
              <Tabs.Tab value="try" size="xs">
                Try It
              </Tabs.Tab>
              <Tabs.Tab
                value="curl"
                size="xs"
                leftSection={<IconTerminal size={12} />}
              >
                cURL
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="schema" pt="md">
              <Stack gap="md">
                <Group gap="xl" align="flex-start">
                  <SchemaViewer
                    schema={action.params}
                    label="Path Parameters"
                  />
                  <SchemaViewer
                    schema={action.query}
                    label="Query Parameters"
                  />
                </Group>
                <SchemaViewer schema={action.body} label="Request Body" />
                <SchemaViewer schema={action.response} label="Response" />
                {!action.params &&
                  !action.query &&
                  !action.body &&
                  !action.response && (
                    <Text size="sm" c="dimmed">
                      No schema defined
                    </Text>
                  )}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="try" pt="md">
              <TryItPanel action={action} />
            </Tabs.Panel>

            <Tabs.Panel value="curl" pt="md">
              <Box pos="relative">
                <CopyButton value={curl}>
                  {({ copied, copy }) => (
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={copy}
                      pos="absolute"
                      top={8}
                      right={8}
                    >
                      {copied ? (
                        <IconCheck size={14} />
                      ) : (
                        <IconCopy size={14} />
                      )}
                    </ActionIcon>
                  )}
                </CopyButton>
                <Code block style={{ fontSize: 11 }}>
                  {curl}
                </Code>
              </Box>
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
};
