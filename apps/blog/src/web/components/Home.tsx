import {
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconArticle,
  IconChevronRight,
  IconEye,
  IconFile,
  IconMessage,
  IconPhoto,
  IconPlus,
  IconSettings,
  IconUser,
} from "@tabler/icons-react";
import { Link } from "alepha/react/router";

const stats = [
  {
    label: "Posts",
    value: "156",
    change: "+12",
    trend: "up",
    icon: IconArticle,
    color: "#3b82f6",
  },
  {
    label: "Pages",
    value: "24",
    change: "+3",
    trend: "up",
    icon: IconFile,
    color: "#8b5cf6",
  },
  {
    label: "Comments",
    value: "1,847",
    change: "-23",
    trend: "down",
    icon: IconMessage,
    color: "#f59e0b",
  },
  {
    label: "Media",
    value: "2,412",
    change: "+87",
    trend: "up",
    icon: IconPhoto,
    color: "#10b981",
  },
  {
    label: "Page Views",
    value: "48.2k",
    change: "+18.3%",
    trend: "up",
    icon: IconEye,
    color: "#ec4899",
  },
];

const recentPosts = [
  {
    title: "Getting Started with Alepha Framework",
    author: "Nicolas F.",
    status: "published",
    date: "Feb 5, 2026",
    views: "1,284",
  },
  {
    title: "Understanding TypeScript Decorators in Depth",
    author: "Marie L.",
    status: "published",
    date: "Feb 4, 2026",
    views: "892",
  },
  {
    title: "Building Real-time Apps with WebSockets",
    author: "Nicolas F.",
    status: "draft",
    date: "Feb 3, 2026",
    views: "--",
  },
  {
    title: "The Complete Guide to SSR with React 19",
    author: "Alex K.",
    status: "published",
    date: "Feb 2, 2026",
    views: "2,156",
  },
  {
    title: "Mantine vs Tailwind: A Component Library Comparison",
    author: "Sarah M.",
    status: "review",
    date: "Feb 1, 2026",
    views: "--",
  },
  {
    title: "Deploying to Cloudflare Workers: Best Practices",
    author: "Nicolas F.",
    status: "published",
    date: "Jan 31, 2026",
    views: "3,421",
  },
];

const recentActivity = [
  {
    user: "Nicolas F.",
    action: 'published "Getting Started with Alepha Framework"',
    time: "2 hours ago",
  },
  {
    user: "Marie L.",
    action: 'updated "Understanding TypeScript Decorators"',
    time: "5 hours ago",
  },
  {
    user: "Alex K.",
    action: "uploaded 3 new images to the media library",
    time: "8 hours ago",
  },
  {
    user: "Sarah M.",
    action: 'submitted "Mantine vs Tailwind" for review',
    time: "1 day ago",
  },
  {
    user: "Nicolas F.",
    action: "approved 4 pending comments",
    time: "1 day ago",
  },
  {
    user: "System",
    action: 'Plugin "SEO Toolkit" updated to v3.2.1',
    time: "2 days ago",
  },
];

const statusColor: Record<string, string> = {
  published: "teal",
  draft: "gray",
  review: "orange",
};

const Home = () => {
  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="xl">
        <Title order={2} fw={600}>
          Welcome back, Nicolas
        </Title>
        <Button
          component={Link}
          href="/posts/new"
          leftSection={<IconPlus size={14} />}
          color="orange"
          size="sm"
        >
          New Post
        </Button>
      </Group>

      {/* Stats row */}
      <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="md" mb="xl">
        {stats.map((stat) => (
          <Box key={stat.label} className="cf-card">
            <Group justify="space-between" mb="xs">
              <Text size="xs" c="dimmed">
                {stat.label}
              </Text>
              <ThemeIcon
                variant="light"
                size="sm"
                radius="xl"
                color={stat.color}
              >
                <stat.icon size={14} />
              </ThemeIcon>
            </Group>
            <Text size="xl" fw={700}>
              {stat.value}
            </Text>
            <Group gap={4} mt={4}>
              {stat.trend === "up" ? (
                <IconArrowUpRight size={14} color="#10b981" />
              ) : (
                <IconArrowDownRight size={14} color="#ef4444" />
              )}
              <Text size="xs" c={stat.trend === "up" ? "teal" : "red"} fw={500}>
                {stat.change}
              </Text>
              <Text size="xs" c="dimmed">
                this week
              </Text>
            </Group>
          </Box>
        ))}
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md" mb="xl">
        {/* Recent Posts - takes 2 columns */}
        <Card withBorder radius="md" p={0} style={{ gridColumn: "span 2" }}>
          <Group justify="space-between" p="md" pb="xs">
            <Text fw={600} size="sm">
              Recent Posts
            </Text>
            <Anchor component={Link} href="/posts" size="xs" c="dimmed">
              View all <IconChevronRight size={12} />
            </Anchor>
          </Group>
          <Table
            highlightOnHover
            styles={{
              th: {
                fontSize: 12,
                fontWeight: 600,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                borderBottom: "1px solid var(--mantine-color-default-border)",
                padding: "8px 16px",
              },
              td: {
                padding: "10px 16px",
                borderBottom: "1px solid var(--mantine-color-default-border)",
              },
            }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Title</Table.Th>
                <Table.Th>Author</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th ta="right">Views</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recentPosts.map((post) => (
                <Table.Tr key={post.title}>
                  <Table.Td>
                    <Text size="sm" fw={500} lineClamp={1}>
                      {post.title}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {post.author}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={statusColor[post.status]}
                      size="sm"
                    >
                      {post.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {post.date}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{post.views}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        {/* Activity feed */}
        <Card withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="md">
            Recent Activity
          </Text>
          <Stack gap="sm">
            {recentActivity.map((item, i) => (
              <Box key={i}>
                <Group gap="xs" align="flex-start">
                  <Avatar size="sm" radius="xl" color="gray">
                    {item.user === "System" ? (
                      <IconSettings size={14} />
                    ) : (
                      <IconUser size={14} />
                    )}
                  </Avatar>
                  <Box style={{ flex: 1 }}>
                    <Text size="xs">
                      <Text span fw={600} size="xs">
                        {item.user}
                      </Text>{" "}
                      {item.action}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {item.time}
                    </Text>
                  </Box>
                </Group>
                {i < recentActivity.length - 1 && <Divider mt="sm" />}
              </Box>
            ))}
          </Stack>
        </Card>
      </SimpleGrid>

      {/* Quick Actions + Site Health */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Card withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb="md">
            Quick Draft
          </Text>
          <Stack gap="sm">
            <Box>
              <Text size="xs" fw={500} mb={4}>
                Title
              </Text>
              <Box
                style={{
                  border: "1px solid var(--mantine-color-default-border)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  fontSize: 14,
                  color: "#9ca3af",
                }}
              >
                What&apos;s on your mind?
              </Box>
            </Box>
            <Box>
              <Text size="xs" fw={500} mb={4}>
                Content
              </Text>
              <Box
                style={{
                  border: "1px solid var(--mantine-color-default-border)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  fontSize: 14,
                  color: "#9ca3af",
                  minHeight: 80,
                }}
              >
                Start writing...
              </Box>
            </Box>
            <Group justify="flex-end">
              <Button
                size="xs"
                color="orange"
                onClick={() =>
                  notifications.show({
                    title: "Draft Saved",
                    message: "Your quick draft has been saved successfully.",
                    color: "teal",
                  })
                }
              >
                Save Draft
              </Button>
            </Group>
          </Stack>
        </Card>

        <Card withBorder radius="md" p="md">
          <Group justify="space-between" mb="md">
            <Text fw={600} size="sm">
              Site Health
            </Text>
            <Badge variant="light" color="teal" size="sm">
              Good
            </Badge>
          </Group>
          <Stack gap="md">
            <Box>
              <Group justify="space-between" mb={4}>
                <Text size="xs" c="dimmed">
                  Performance
                </Text>
                <Text size="xs" fw={500}>
                  92%
                </Text>
              </Group>
              <Progress value={92} color="teal" size="sm" radius="xl" />
            </Box>
            <Box>
              <Group justify="space-between" mb={4}>
                <Text size="xs" c="dimmed">
                  Security
                </Text>
                <Text size="xs" fw={500}>
                  88%
                </Text>
              </Group>
              <Progress value={88} color="blue" size="sm" radius="xl" />
            </Box>
            <Box>
              <Group justify="space-between" mb={4}>
                <Text size="xs" c="dimmed">
                  SEO Score
                </Text>
                <Text size="xs" fw={500}>
                  76%
                </Text>
              </Group>
              <Progress value={76} color="orange" size="sm" radius="xl" />
            </Box>
            <Box>
              <Group justify="space-between" mb={4}>
                <Text size="xs" c="dimmed">
                  Storage Used
                </Text>
                <Text size="xs" fw={500}>
                  4.2 GB / 10 GB
                </Text>
              </Group>
              <Progress value={42} color="grape" size="sm" radius="xl" />
            </Box>
            <Divider />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Last checked: 2 minutes ago
              </Text>
              <Anchor
                size="xs"
                onClick={() =>
                  notifications.show({
                    title: "Health Check",
                    message:
                      "Site health check started. Results will be ready in a few minutes.",
                    color: "blue",
                  })
                }
                style={{ cursor: "pointer" }}
              >
                Run check
              </Anchor>
            </Group>
          </Stack>
        </Card>
      </SimpleGrid>
    </Box>
  );
};

export default Home;
