import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Card,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconCheck,
  IconFlag,
  IconMessageReply,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

const comments = [
  {
    id: 1,
    author: "John Doe",
    email: "john@example.com",
    content:
      "This is an excellent guide! The Alepha framework looks really promising. I especially liked the section about dependency injection patterns.",
    post: "Getting Started with Alepha Framework",
    date: "Feb 5, 2026 at 14:23",
    status: "pending",
    avatar: "#3b82f6",
  },
  {
    id: 2,
    author: "Jane Smith",
    email: "jane@dev.io",
    content:
      "Great write-up on decorators. Could you also cover how to create custom decorators for validation?",
    post: "Understanding TypeScript Decorators in Depth",
    date: "Feb 4, 2026 at 09:45",
    status: "pending",
    avatar: "#ec4899",
  },
  {
    id: 3,
    author: "DevMaster99",
    email: "dev@master.com",
    content:
      "I've been using SSR with React 19 in production for 2 months now. This guide covers all the edge cases I encountered. Bookmarked!",
    post: "The Complete Guide to SSR with React 19",
    date: "Feb 3, 2026 at 17:12",
    status: "approved",
    avatar: "#10b981",
  },
  {
    id: 4,
    author: "Sarah Connor",
    email: "sarah@tech.co",
    content:
      "Found a small typo in the WebSocket authentication section. Otherwise, fantastic tutorial!",
    post: "Building Real-time Apps with WebSockets",
    date: "Feb 3, 2026 at 11:30",
    status: "approved",
    avatar: "#f59e0b",
  },
  {
    id: 5,
    author: "SpamBot3000",
    email: "spam@fake.xyz",
    content:
      "Buy cheap viagra online! Best prices guaranteed! Visit our website now!!!",
    post: "Getting Started with Alepha Framework",
    date: "Feb 2, 2026 at 03:14",
    status: "spam",
    avatar: "#ef4444",
  },
  {
    id: 6,
    author: "CloudEnthusiast",
    email: "cloud@fan.dev",
    content:
      "Best Cloudflare Workers tutorial I've seen. The deployment scripts were particularly helpful. Would love to see a follow-up on Durable Objects.",
    post: "Deploying to Cloudflare Workers: Best Practices",
    date: "Feb 1, 2026 at 20:08",
    status: "approved",
    avatar: "#8b5cf6",
  },
  {
    id: 7,
    author: "TypeScriptFan",
    email: "ts@lover.dev",
    content:
      "I disagree with the comparison methodology. You should also consider bundle size and tree-shaking capabilities when comparing Mantine vs Tailwind.",
    post: "Mantine vs Tailwind: A Component Library Comparison",
    date: "Feb 1, 2026 at 15:42",
    status: "pending",
    avatar: "#6366f1",
  },
  {
    id: 8,
    author: "Alice Walker",
    email: "alice@startup.io",
    content:
      "This changed how I think about state management. The examples with Zustand alternatives were particularly enlightening.",
    post: "State Management in 2026: What Actually Works",
    date: "Jan 31, 2026 at 09:15",
    status: "approved",
    avatar: "#14b8a6",
  },
  {
    id: 9,
    author: "CryptoHacker",
    email: "hack@scam.ru",
    content:
      "FREE CRYPTO AIRDROP! Click this link to claim your tokens! Limited time offer!",
    post: "Advanced Dependency Injection Patterns",
    date: "Jan 30, 2026 at 01:22",
    status: "spam",
    avatar: "#ef4444",
  },
  {
    id: 10,
    author: "Bob Builder",
    email: "bob@builds.dev",
    content:
      "The Vite plugin API is so powerful. Thanks for this guide - I built a custom HMR plugin for our monorepo following your patterns.",
    post: "Creating Custom Vite Plugins for Your Build Pipeline",
    date: "Jan 29, 2026 at 16:55",
    status: "approved",
    avatar: "#f97316",
  },
  {
    id: 11,
    author: "NewReader",
    email: "new@reader.com",
    content:
      "Just discovered this blog and I'm hooked. The quality of the technical writing is outstanding. Keep it up!",
    post: "Type-Safe API Routes with End-to-End Validation",
    date: "Jan 28, 2026 at 12:33",
    status: "pending",
    avatar: "#84cc16",
  },
  {
    id: 12,
    author: "SecurityPro",
    email: "sec@pro.dev",
    content:
      "You should add a section about CSRF protection in the API routes article. It's a critical security consideration for form submissions.",
    post: "Type-Safe API Routes with End-to-End Validation",
    date: "Jan 27, 2026 at 08:19",
    status: "approved",
    avatar: "#0ea5e9",
  },
];

const statusColor: Record<string, string> = {
  pending: "orange",
  approved: "teal",
  spam: "red",
};

const Comments = () => {
  const [filter, setFilter] = useState("all");

  const filtered =
    filter === "all" ? comments : comments.filter((c) => c.status === filter);

  const counts = {
    all: comments.length,
    pending: comments.filter((c) => c.status === "pending").length,
    approved: comments.filter((c) => c.status === "approved").length,
    spam: comments.filter((c) => c.status === "spam").length,
  };

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Comments
        </Title>
        <Badge variant="light" color="orange" size="lg">
          {counts.pending} pending
        </Badge>
      </Group>

      {/* Filters */}
      <SegmentedControl
        size="xs"
        value={filter}
        onChange={setFilter}
        mb="md"
        data={[
          { value: "all", label: `All (${counts.all})` },
          { value: "pending", label: `Pending (${counts.pending})` },
          { value: "approved", label: `Approved (${counts.approved})` },
          { value: "spam", label: `Spam (${counts.spam})` },
        ]}
      />

      {/* Comments list */}
      <Stack gap="sm">
        {filtered.map((comment) => (
          <Card key={comment.id} withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start">
              <Group gap="sm" align="flex-start" style={{ flex: 1 }}>
                <Avatar size="md" radius="xl" color={comment.avatar}>
                  {comment.author[0]}
                </Avatar>
                <Box style={{ flex: 1 }}>
                  <Group gap="xs" mb={2}>
                    <Text size="sm" fw={600}>
                      {comment.author}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {comment.email}
                    </Text>
                    <Badge
                      variant="light"
                      color={statusColor[comment.status]}
                      size="xs"
                    >
                      {comment.status}
                    </Badge>
                  </Group>
                  <Text size="sm" mb="xs">
                    {comment.content}
                  </Text>
                  <Group gap="xs">
                    <Text size="xs" c="dimmed">
                      on{" "}
                      <Anchor size="xs" c="blue">
                        {comment.post}
                      </Anchor>
                    </Text>
                    <Text size="xs" c="dimmed">
                      - {comment.date}
                    </Text>
                  </Group>
                </Box>
              </Group>

              {/* Actions */}
              <Group gap={4}>
                {comment.status === "pending" && (
                  <>
                    <Tooltip label="Approve">
                      <ActionIcon
                        variant="subtle"
                        color="teal"
                        size="sm"
                        onClick={() =>
                          notifications.show({
                            title: "Approved",
                            message: "Comment has been approved.",
                            color: "teal",
                          })
                        }
                      >
                        <IconCheck size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Reject">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        onClick={() =>
                          notifications.show({
                            title: "Rejected",
                            message: "Comment has been rejected.",
                            color: "red",
                          })
                        }
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </>
                )}
                <Tooltip label="Reply">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={() =>
                      notifications.show({
                        title: "Reply",
                        message: "Reply editor opened.",
                        color: "blue",
                      })
                    }
                  >
                    <IconMessageReply size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Mark as spam">
                  <ActionIcon
                    variant="subtle"
                    color="orange"
                    size="sm"
                    onClick={() =>
                      modals.openConfirmModal({
                        title: "Flag as spam",
                        children: (
                          <Text size="sm">
                            Mark this comment by {comment.author} as spam?
                          </Text>
                        ),
                        labels: { confirm: "Flag as Spam", cancel: "Cancel" },
                        confirmProps: { color: "orange" },
                        onConfirm: () =>
                          notifications.show({
                            title: "Flagged",
                            message: "Comment flagged as spam.",
                            color: "orange",
                          }),
                      })
                    }
                  >
                    <IconFlag size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={() =>
                      modals.openConfirmModal({
                        title: "Delete comment",
                        children: (
                          <Text size="sm">
                            Are you sure you want to permanently delete this
                            comment by {comment.author}? This action cannot be
                            undone.
                          </Text>
                        ),
                        labels: { confirm: "Delete", cancel: "Cancel" },
                        confirmProps: { color: "red" },
                        onConfirm: () =>
                          notifications.show({
                            title: "Deleted",
                            message: "Comment permanently deleted.",
                            color: "red",
                          }),
                      })
                    }
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Card>
        ))}
      </Stack>

      <Group justify="center" mt="md">
        <Text size="xs" c="dimmed">
          Showing {filtered.length} of {comments.length} comments
        </Text>
      </Group>
    </Box>
  );
};

export default Comments;
