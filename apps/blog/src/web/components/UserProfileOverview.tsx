import {
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArticle,
  IconCalendar,
  IconClock,
  IconMessage,
  IconThumbUp,
} from "@tabler/icons-react";
import { useRouterState } from "alepha/react/router";

const userStats: Record<
  string,
  {
    posts: number;
    comments: number;
    likes: number;
    bio: string;
    joinDate: string;
    lastActive: string;
  }
> = {
  "1": {
    posts: 24,
    comments: 142,
    likes: 386,
    bio: "Full-stack developer and framework author. Building Alepha.",
    joinDate: "Jan 15, 2024",
    lastActive: "2 hours ago",
  },
  "2": {
    posts: 18,
    comments: 95,
    likes: 210,
    bio: "Content editor and UX writer. Passionate about clear documentation.",
    joinDate: "Mar 8, 2024",
    lastActive: "5 hours ago",
  },
  "3": {
    posts: 12,
    comments: 67,
    likes: 154,
    bio: "Technical writer covering web development and TypeScript.",
    joinDate: "Jun 22, 2024",
    lastActive: "1 day ago",
  },
  "4": {
    posts: 9,
    comments: 43,
    likes: 98,
    bio: "Frontend developer writing about React patterns and best practices.",
    joinDate: "Jul 10, 2024",
    lastActive: "3 hours ago",
  },
  "5": {
    posts: 3,
    comments: 12,
    likes: 21,
    bio: "Occasional contributor interested in DevOps and CI/CD.",
    joinDate: "Sep 5, 2024",
    lastActive: "3 weeks ago",
  },
  "6": {
    posts: 15,
    comments: 88,
    likes: 245,
    bio: "Senior editor with a focus on accessibility and inclusive design.",
    joinDate: "Oct 1, 2024",
    lastActive: "1 hour ago",
  },
  "7": {
    posts: 0,
    comments: 5,
    likes: 8,
    bio: "Reader and subscriber.",
    joinDate: "Nov 14, 2024",
    lastActive: "2 months ago",
  },
  "8": {
    posts: 2,
    comments: 8,
    likes: 15,
    bio: "Contributor writing about testing strategies.",
    joinDate: "Dec 3, 2024",
    lastActive: "1 month ago",
  },
  "9": {
    posts: 7,
    comments: 34,
    likes: 76,
    bio: "Backend developer sharing experiences with Node.js and databases.",
    joinDate: "Jan 20, 2025",
    lastActive: "6 hours ago",
  },
  "10": {
    posts: 0,
    comments: 2,
    likes: 3,
    bio: "New subscriber exploring the blog.",
    joinDate: "Feb 1, 2025",
    lastActive: "2 months ago",
  },
};

const UserProfileOverview = () => {
  const state = useRouterState();
  const userId = state.params.userId as string;
  const stats = userStats[userId] ?? userStats["1"];

  const statCards = [
    { label: "Posts", value: stats.posts, icon: IconArticle, color: "orange" },
    {
      label: "Comments",
      value: stats.comments,
      icon: IconMessage,
      color: "blue",
    },
    {
      label: "Likes Received",
      value: stats.likes,
      icon: IconThumbUp,
      color: "pink",
    },
  ];

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {statCards.map((stat) => (
          <Card key={stat.label} withBorder padding="lg" radius="md">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  {stat.label}
                </Text>
                <Title order={2} fw={700} mt={4}>
                  {stat.value}
                </Title>
              </div>
              <ThemeIcon
                variant="light"
                color={stat.color}
                size="lg"
                radius="md"
              >
                <stat.icon size={18} />
              </ThemeIcon>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      <Card withBorder padding="lg" radius="md">
        <Title order={5} fw={600} mb="md">
          About
        </Title>
        <Text size="sm" c="dimmed">
          {stats.bio}
        </Text>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card withBorder padding="lg" radius="md">
          <Group gap="sm">
            <ThemeIcon variant="light" color="gray" size="md" radius="md">
              <IconCalendar size={16} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">
                Member since
              </Text>
              <Text size="sm" fw={500}>
                {stats.joinDate}
              </Text>
            </div>
          </Group>
        </Card>
        <Card withBorder padding="lg" radius="md">
          <Group gap="sm">
            <ThemeIcon variant="light" color="gray" size="md" radius="md">
              <IconClock size={16} />
            </ThemeIcon>
            <div>
              <Text size="xs" c="dimmed">
                Last active
              </Text>
              <Text size="sm" fw={500}>
                {stats.lastActive}
              </Text>
            </div>
          </Group>
        </Card>
      </SimpleGrid>
    </Stack>
  );
};

export default UserProfileOverview;
