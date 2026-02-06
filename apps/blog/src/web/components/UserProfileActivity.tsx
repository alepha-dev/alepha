import { Box, Card, Group, Text, ThemeIcon, Timeline } from "@mantine/core";
import {
  IconArticle,
  IconMessage,
  IconPencil,
  IconSettings,
  IconUser,
} from "@tabler/icons-react";
import { useRouterState } from "alepha/react/router";
import type { ComponentType } from "react";

interface ActivityEvent {
  id: number;
  action: string;
  detail: string;
  time: string;
  icon: ComponentType<{ size?: number }>;
  color: string;
}

const activityByUser: Record<string, ActivityEvent[]> = {
  "1": [
    {
      id: 1,
      action: "Published a post",
      detail: "Getting Started with Alepha",
      time: "2 hours ago",
      icon: IconArticle,
      color: "orange",
    },
    {
      id: 2,
      action: "Replied to a comment",
      detail: 'on "Type-Safe APIs with $action"',
      time: "5 hours ago",
      icon: IconMessage,
      color: "blue",
    },
    {
      id: 3,
      action: "Updated profile",
      detail: "Changed bio and avatar",
      time: "1 day ago",
      icon: IconUser,
      color: "gray",
    },
    {
      id: 4,
      action: "Edited a post",
      detail: "Convention-Driven Development",
      time: "2 days ago",
      icon: IconPencil,
      color: "teal",
    },
    {
      id: 5,
      action: "Changed settings",
      detail: "Updated notification preferences",
      time: "3 days ago",
      icon: IconSettings,
      color: "violet",
    },
    {
      id: 6,
      action: "Published a post",
      detail: "Convention-Driven Development",
      time: "1 week ago",
      icon: IconArticle,
      color: "orange",
    },
  ],
  "2": [
    {
      id: 1,
      action: "Published a post",
      detail: "Writing Clear Documentation",
      time: "1 day ago",
      icon: IconArticle,
      color: "orange",
    },
    {
      id: 2,
      action: "Replied to a comment",
      detail: 'on "UX Writing Best Practices"',
      time: "2 days ago",
      icon: IconMessage,
      color: "blue",
    },
    {
      id: 3,
      action: "Edited a post",
      detail: "UX Writing Best Practices",
      time: "5 days ago",
      icon: IconPencil,
      color: "teal",
    },
  ],
  "3": [
    {
      id: 1,
      action: "Published a post",
      detail: "TypeScript Generics Deep Dive",
      time: "4 days ago",
      icon: IconArticle,
      color: "orange",
    },
    {
      id: 2,
      action: "Replied to a comment",
      detail: 'on "TypeScript Generics Deep Dive"',
      time: "3 days ago",
      icon: IconMessage,
      color: "blue",
    },
  ],
};

const UserProfileActivity = () => {
  const state = useRouterState();
  const userId = state.params.userId as string;
  const events = activityByUser[userId] ?? [];

  if (events.length === 0) {
    return (
      <Box py="xl">
        <Text c="dimmed" ta="center">
          No recent activity.
        </Text>
      </Box>
    );
  }

  return (
    <Card withBorder padding="lg" radius="md">
      <Timeline active={events.length - 1} bulletSize={28} lineWidth={2}>
        {events.map((event) => (
          <Timeline.Item
            key={event.id}
            bullet={
              <ThemeIcon
                size={28}
                variant="light"
                color={event.color}
                radius="xl"
              >
                <event.icon size={14} />
              </ThemeIcon>
            }
          >
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" fw={500}>
                  {event.action}
                </Text>
                <Text size="xs" c="dimmed">
                  {event.detail}
                </Text>
              </div>
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {event.time}
              </Text>
            </Group>
          </Timeline.Item>
        ))}
      </Timeline>
    </Card>
  );
};

export default UserProfileActivity;
