import { Badge, Box, Table, Text } from "@mantine/core";
import { useRouterState } from "alepha/react/router";

interface Post {
  id: number;
  title: string;
  status: "published" | "draft" | "scheduled";
  date: string;
  views: number;
  comments: number;
}

const postsByUser: Record<string, Post[]> = {
  "1": [
    {
      id: 1,
      title: "Getting Started with Alepha",
      status: "published",
      date: "Feb 5, 2026",
      views: 1240,
      comments: 18,
    },
    {
      id: 2,
      title: "Convention-Driven Development",
      status: "published",
      date: "Jan 28, 2026",
      views: 890,
      comments: 12,
    },
    {
      id: 3,
      title: "Type-Safe APIs with $action",
      status: "published",
      date: "Jan 15, 2026",
      views: 2100,
      comments: 34,
    },
    {
      id: 4,
      title: "Building Admin Panels",
      status: "draft",
      date: "Feb 3, 2026",
      views: 0,
      comments: 0,
    },
    {
      id: 5,
      title: "SSR and Code Splitting",
      status: "scheduled",
      date: "Feb 10, 2026",
      views: 0,
      comments: 0,
    },
  ],
  "2": [
    {
      id: 6,
      title: "Writing Clear Documentation",
      status: "published",
      date: "Feb 4, 2026",
      views: 560,
      comments: 8,
    },
    {
      id: 7,
      title: "UX Writing Best Practices",
      status: "published",
      date: "Jan 20, 2026",
      views: 430,
      comments: 5,
    },
  ],
  "3": [
    {
      id: 8,
      title: "TypeScript Generics Deep Dive",
      status: "published",
      date: "Feb 1, 2026",
      views: 1800,
      comments: 22,
    },
    {
      id: 9,
      title: "Advanced Type Inference",
      status: "draft",
      date: "Feb 4, 2026",
      views: 0,
      comments: 0,
    },
  ],
};

const statusColor: Record<string, string> = {
  published: "teal",
  draft: "gray",
  scheduled: "blue",
};

const UserProfilePosts = () => {
  const state = useRouterState();
  const userId = state.params.userId as string;
  const posts = postsByUser[userId] ?? [];

  if (posts.length === 0) {
    return (
      <Box py="xl">
        <Text c="dimmed" ta="center">
          No posts yet.
        </Text>
      </Box>
    );
  }

  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
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
            padding: "10px 16px",
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
            <Table.Th>Status</Table.Th>
            <Table.Th>Date</Table.Th>
            <Table.Th ta="right">Views</Table.Th>
            <Table.Th ta="right">Comments</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {posts.map((post) => (
            <Table.Tr key={post.id}>
              <Table.Td>
                <Text size="sm" fw={500}>
                  {post.title}
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
                <Text size="sm">
                  {post.views > 0 ? post.views.toLocaleString() : "--"}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm">
                  {post.comments > 0 ? post.comments : "--"}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
};

export default UserProfilePosts;
