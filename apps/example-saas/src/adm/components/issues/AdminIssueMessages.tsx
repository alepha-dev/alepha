import { useAction, useClient, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Avatar,
  Badge,
  Box,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCheck,
  IconMessageCircle,
  IconRefresh,
  IconRobot,
  IconSend,
  IconUser,
  IconUserCheck,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { IssueController } from "../../../api/issues/controllers/IssueController.ts";
import type { IssueMessage } from "../../../api/issues/entities/issueMessages.ts";

const authorTypeColors: Record<string, string> = {
  customer: "blue",
  agent: "green",
  system: "gray",
};

const authorTypeIcons: Record<string, typeof IconUser> = {
  customer: IconUser,
  agent: IconUserCheck,
  system: IconRobot,
};

const statusIcons: Record<string, typeof IconCheck> = {
  open: IconMessageCircle,
  pending: IconArrowRight,
  accepted: IconCheck,
  rejected: IconX,
  cancelled: IconX,
  archived: IconCheck,
};

const statusColors: Record<string, string> = {
  open: "blue",
  pending: "yellow",
  accepted: "green",
  rejected: "red",
  cancelled: "gray",
  archived: "gray",
};

interface MessageBubbleProps {
  message: IssueMessage;
  l: ReturnType<typeof useI18n>["l"];
}

const MessageBubble = ({ message, l }: MessageBubbleProps) => {
  const isAgent = message.authorType === "agent";
  const AuthorIcon = authorTypeIcons[message.authorType] || IconUser;

  return (
    <Flex
      gap="sm"
      direction={isAgent ? "row-reverse" : "row"}
      align="flex-start"
    >
      <Tooltip label={message.authorName || message.authorType}>
        <Avatar
          size="sm"
          radius="xl"
          color={authorTypeColors[message.authorType]}
        >
          <AuthorIcon size={14} />
        </Avatar>
      </Tooltip>

      <Paper
        p="sm"
        radius="lg"
        withBorder
        maw="70%"
        style={{
          backgroundColor: isAgent
            ? "var(--mantine-color-green-light)"
            : "var(--mantine-color-blue-light)",
          borderColor: isAgent
            ? "var(--mantine-color-green-3)"
            : "var(--mantine-color-blue-3)",
        }}
      >
        <Stack gap={4}>
          <Group gap="xs" justify="space-between">
            <Text size="xs" fw={500} c={authorTypeColors[message.authorType]}>
              {message.authorName || message.authorType}
            </Text>
            <Text size="xs" c="dimmed">
              {l(message.createdAt, { date: "fromNow" })}
            </Text>
          </Group>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {message.content}
          </Text>
          {message.editedAt && (
            <Text size="xs" c="dimmed" fs="italic">
              (edited)
            </Text>
          )}
        </Stack>
      </Paper>
    </Flex>
  );
};

interface SystemEventProps {
  message: IssueMessage;
  l: ReturnType<typeof useI18n>["l"];
}

const SystemEvent = ({ message, l }: SystemEventProps) => {
  const newStatus = message.eventData?.newStatus;
  const StatusIcon = newStatus ? statusIcons[newStatus] : IconMessageCircle;
  const color = newStatus ? statusColors[newStatus] : "gray";

  return (
    <Flex justify="center" py="xs">
      <Paper
        px="md"
        py="xs"
        radius="xl"
        style={{
          backgroundColor: "var(--mantine-color-gray-light)",
          border: "1px dashed var(--mantine-color-gray-4)",
        }}
      >
        <Group gap="xs">
          <ThemeIcon size="xs" variant="transparent" color={color}>
            <StatusIcon size={12} />
          </ThemeIcon>
          <Text size="xs" c="dimmed">
            {message.content}
          </Text>
          {message.eventData?.newStatus && (
            <Badge size="xs" variant="light" color={color}>
              {message.eventData.newStatus}
            </Badge>
          )}
          <Text size="xs" c="dimmed">
            •
          </Text>
          <Text size="xs" c="dimmed">
            {l(message.createdAt, { date: "fromNow" })}
          </Text>
        </Group>
      </Paper>
    </Flex>
  );
};

interface NoteMessageProps {
  message: IssueMessage;
  l: ReturnType<typeof useI18n>["l"];
}

const NoteMessage = ({ message, l }: NoteMessageProps) => {
  return (
    <Paper
      p="sm"
      radius="md"
      withBorder
      style={{
        backgroundColor: "var(--mantine-color-yellow-light)",
        borderColor: "var(--mantine-color-yellow-4)",
        borderStyle: "dashed",
      }}
    >
      <Stack gap={4}>
        <Group gap="xs">
          <Badge size="xs" variant="light" color="yellow">
            Internal Note
          </Badge>
          <Text size="xs" c="dimmed">
            {message.authorName || "Agent"} •{" "}
            {l(message.createdAt, { date: "fromNow" })}
          </Text>
        </Group>
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {message.content}
        </Text>
      </Stack>
    </Paper>
  );
};

const AdminIssueMessages = () => {
  const state = useRouterState();
  const client = useClient<IssueController>();
  const { l } = useI18n();
  const issueId = state.params.issueId as string;

  const [messages, setMessages] = useState<IssueMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [isNote, setIsNote] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const loadMessages = async () => {
    try {
      const response = await client.getIssueMessages({
        params: { id: issueId },
        query: { size: 100 },
      });
      setMessages(response.content);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [issueId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        top: scrollAreaRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  const sendAction = useAction(
    {
      handler: async () => {
        if (!newMessage.trim()) return;

        await client.addIssueMessage({
          params: { id: issueId },
          body: {
            content: newMessage.trim(),
            messageType: isNote ? "note" : "comment",
            authorType: "agent",
            authorName: "Support Agent", // In real app, get from auth context
          },
        });

        setNewMessage("");
        await loadMessages();
      },
    },
    [issueId, newMessage, isNote],
  );

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" h="100%">
      {/* Messages Area */}
      <ScrollArea
        flex={1}
        viewportRef={scrollAreaRef}
        style={{ minHeight: 0 }}
        p="md"
      >
        {messages.length === 0 ? (
          <Flex
            h="100%"
            direction="column"
            align="center"
            justify="center"
            gap="md"
            py="xl"
          >
            <ThemeIcon size="xl" variant="light" color="gray">
              <IconMessageCircle size={24} />
            </ThemeIcon>
            <Text c="dimmed" ta="center">
              No messages yet.
              <br />
              Start the conversation below.
            </Text>
          </Flex>
        ) : (
          <Stack gap="md">
            {messages.map((message) => {
              // System events (status changes, assignments)
              if (
                message.messageType === "system" ||
                message.messageType === "status_change" ||
                message.messageType === "assignment"
              ) {
                return <SystemEvent key={message.id} message={message} l={l} />;
              }

              // Internal notes
              if (message.messageType === "note") {
                return <NoteMessage key={message.id} message={message} l={l} />;
              }

              // Regular comments
              return <MessageBubble key={message.id} message={message} l={l} />;
            })}
          </Stack>
        )}
      </ScrollArea>

      {/* Input Area */}
      <Box
        p="md"
        style={{
          borderTop: "1px solid var(--mantine-color-gray-3)",
          backgroundColor: "var(--alepha-elevated)",
        }}
      >
        <Stack gap="xs">
          <Group gap="xs">
            <ActionButton
              size="xs"
              variant={isNote ? "light" : "subtle"}
              color={isNote ? "yellow" : "gray"}
              onClick={() => setIsNote(!isNote)}
            >
              {isNote ? "Internal Note" : "Public Reply"}
            </ActionButton>
            <ActionButton
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<IconRefresh size={12} />}
              onClick={loadMessages}
            >
              Refresh
            </ActionButton>
          </Group>

          <Group gap="sm" align="flex-end">
            <Textarea
              flex={1}
              placeholder={
                isNote
                  ? "Add an internal note (only visible to agents)..."
                  : "Type your message..."
              }
              value={newMessage}
              onChange={(e) => setNewMessage(e.currentTarget.value)}
              autosize
              minRows={1}
              maxRows={5}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendAction.run();
                }
              }}
              styles={{
                input: {
                  backgroundColor: isNote
                    ? "var(--mantine-color-yellow-light)"
                    : undefined,
                },
              }}
            />
            <ActionButton
              variant="filled"
              color={isNote ? "yellow" : "blue"}
              loading={sendAction.loading}
              disabled={!newMessage.trim()}
              onClick={sendAction.run}
              leftSection={<IconSend size={16} />}
            >
              Send
            </ActionButton>
          </Group>

          {isNote && (
            <Text size="xs" c="yellow">
              Internal notes are only visible to agents, not customers.
            </Text>
          )}
        </Stack>
      </Box>
    </Flex>
  );
};

export default AdminIssueMessages;
