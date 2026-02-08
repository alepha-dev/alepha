import { ActionButton, Flex } from "@alepha/ui";
import {
  Badge,
  Card,
  SimpleGrid,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArticle,
  IconEye,
  IconMessage,
  IconMessageDots,
} from "@tabler/icons-react";
import type { DashboardStats } from "../../api/schemas/postSchemas.ts";

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card withBorder radius="sm" p="lg" className="cf-card">
      <Flex justify="space-between" mb="xs">
        <Text
          fz="sm"
          fw={500}
          c="dimmed"
          tt="uppercase"
          style={{ letterSpacing: "0.03em" }}
        >
          {label}
        </Text>
        <ThemeIcon variant="light" color={color} size="md" radius="sm">
          {icon}
        </ThemeIcon>
      </Flex>
      <Text fw={700} fz="1.75rem" lh={1}>
        {value.toLocaleString()}
      </Text>
    </Card>
  );
}

export interface AdminDashboardProps {
  stats: DashboardStats;
}

const AdminDashboard = ({ stats }: AdminDashboardProps) => {
  return (
    <Flex direction="column" gap="lg" p="lg">
      <Title order={2}>Dashboard</Title>

      {/* Stats */}
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
        <StatCard
          icon={<IconArticle size={18} />}
          label="Total Posts"
          value={stats?.totalPosts || 0}
          color="blue"
        />
        <StatCard
          icon={<IconArticle size={18} />}
          label="Published"
          value={stats?.publishedPosts || 0}
          color="green"
        />
        <StatCard
          icon={<IconMessage size={18} />}
          label="Comments"
          value={stats?.totalComments || 0}
          color="orange"
        />
        <StatCard
          icon={<IconEye size={18} />}
          label="Total Views"
          value={stats?.totalViews || 0}
          color="violet"
        />
      </SimpleGrid>

      {/* Pending comments alert */}
      {(stats?.pendingComments || 0) > 0 && (
        <Card
          withBorder
          radius="sm"
          p="md"
          className="cf-card"
          style={{ borderColor: "#f6821f" }}
        >
          <Flex gap="sm">
            <ThemeIcon variant="light" color="orange" size="md" radius="sm">
              <IconMessageDots size={18} />
            </ThemeIcon>
            <Flex>
              <Text fw={600} fz="sm">
                {stats.pendingComments} comment
                {stats.pendingComments !== 1 ? "s" : ""} awaiting moderation
              </Text>
              <ActionButton
                anchorProps={{ underline: "never" }}
                href="/admin/comments"
                fz="xs"
                c="orange"
                unstyled
              >
                Review now &rarr;
              </ActionButton>
            </Flex>
          </Flex>
        </Card>
      )}

      {/* Recent posts */}
      <Card withBorder radius="sm" p="lg" className="cf-card">
        <Flex justify="space-between" mb="md">
          <Text fw={600}>Recent Posts</Text>
          <ActionButton
            anchorProps={{ underline: "never" }}
            href="/admin/posts"
            fz="sm"
            unstyled
          >
            View all &rarr;
          </ActionButton>
        </Flex>

        {!stats?.recentPosts?.length ? (
          <Text c="dimmed" fz="sm" ta="center" py="xl">
            No posts yet. Create your first post!
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Title</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Views</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {stats.recentPosts.map((post) => (
                <Table.Tr key={post.id}>
                  <Table.Td>
                    <ActionButton
                      anchorProps={{ underline: "never" }}
                      href={`/admin/posts/${post.id}/edit`}
                      fz="sm"
                      fw={500}
                      unstyled
                    >
                      {post.title}
                    </ActionButton>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      radius="sm"
                      variant="light"
                      color={
                        post.status === "published"
                          ? "green"
                          : post.status === "draft"
                            ? "gray"
                            : "orange"
                      }
                    >
                      {post.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm" c="dimmed">
                      {formatDate(post.publishedAt || post.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm">{post.viewCount}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Flex>
  );
};

export default AdminDashboard;
