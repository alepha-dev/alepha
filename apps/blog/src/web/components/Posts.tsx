import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  Pagination,
  SegmentedControl,
  Select,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconEye,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import { useState } from "react";

const posts = [
  {
    id: 1,
    title: "Getting Started with Alepha Framework",
    author: "Nicolas F.",
    category: "Tutorials",
    tags: ["alepha", "typescript"],
    status: "published",
    date: "Feb 5, 2026",
    views: 1284,
    comments: 8,
  },
  {
    id: 2,
    title: "Understanding TypeScript Decorators in Depth",
    author: "Marie L.",
    category: "TypeScript",
    tags: ["typescript", "decorators"],
    status: "published",
    date: "Feb 4, 2026",
    views: 892,
    comments: 12,
  },
  {
    id: 3,
    title: "Building Real-time Apps with WebSockets",
    author: "Nicolas F.",
    category: "Tutorials",
    tags: ["websockets", "real-time"],
    status: "draft",
    date: "Feb 3, 2026",
    views: 0,
    comments: 0,
  },
  {
    id: 4,
    title: "The Complete Guide to SSR with React 19",
    author: "Alex K.",
    category: "React",
    tags: ["react", "ssr"],
    status: "published",
    date: "Feb 2, 2026",
    views: 2156,
    comments: 24,
  },
  {
    id: 5,
    title: "Mantine vs Tailwind: A Component Library Comparison",
    author: "Sarah M.",
    category: "Reviews",
    tags: ["mantine", "tailwind", "css"],
    status: "review",
    date: "Feb 1, 2026",
    views: 0,
    comments: 3,
  },
  {
    id: 6,
    title: "Deploying to Cloudflare Workers: Best Practices",
    author: "Nicolas F.",
    category: "DevOps",
    tags: ["cloudflare", "deploy"],
    status: "published",
    date: "Jan 31, 2026",
    views: 3421,
    comments: 18,
  },
  {
    id: 7,
    title: "Advanced Dependency Injection Patterns",
    author: "Marie L.",
    category: "Architecture",
    tags: ["di", "patterns"],
    status: "published",
    date: "Jan 29, 2026",
    views: 1567,
    comments: 9,
  },
  {
    id: 8,
    title: "Creating Custom Vite Plugins for Your Build Pipeline",
    author: "Alex K.",
    category: "Tooling",
    tags: ["vite", "plugins"],
    status: "draft",
    date: "Jan 28, 2026",
    views: 0,
    comments: 0,
  },
  {
    id: 9,
    title: "State Management in 2026: What Actually Works",
    author: "Nicolas F.",
    category: "React",
    tags: ["state", "react"],
    status: "published",
    date: "Jan 26, 2026",
    views: 4892,
    comments: 37,
  },
  {
    id: 10,
    title: "Type-Safe API Routes with End-to-End Validation",
    author: "Sarah M.",
    category: "TypeScript",
    tags: ["api", "validation"],
    status: "review",
    date: "Jan 25, 2026",
    views: 0,
    comments: 5,
  },
];

const statusColor: Record<string, string> = {
  published: "teal",
  draft: "gray",
  review: "orange",
};

const Posts = () => {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<number[]>([]);

  const filtered =
    filter === "all" ? posts : posts.filter((p) => p.status === filter);

  const toggleSelect = (id: number) => {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  };

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Posts
        </Title>
        <Button
          component={Link}
          href="/posts/new"
          leftSection={<IconPlus size={14} />}
          color="orange"
          size="sm"
        >
          Add New
        </Button>
      </Group>

      {/* Filters bar */}
      <Group justify="space-between" mb="md">
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={setFilter}
          data={[
            { value: "all", label: `All (${posts.length})` },
            {
              value: "published",
              label: `Published (${posts.filter((p) => p.status === "published").length})`,
            },
            {
              value: "draft",
              label: `Drafts (${posts.filter((p) => p.status === "draft").length})`,
            },
            {
              value: "review",
              label: `In Review (${posts.filter((p) => p.status === "review").length})`,
            },
          ]}
        />
        <Group gap="sm">
          <TextInput
            placeholder="Search posts..."
            leftSection={<IconSearch size={14} />}
            size="xs"
            w={220}
          />
          <Select
            placeholder="Category"
            data={[
              "All Categories",
              "Tutorials",
              "TypeScript",
              "React",
              "DevOps",
              "Reviews",
              "Architecture",
              "Tooling",
            ]}
            size="xs"
            w={160}
            clearable
          />
        </Group>
      </Group>

      {/* Bulk actions */}
      {selected.length > 0 && (
        <Group gap="sm" mb="sm">
          <Text size="xs" c="dimmed">
            {selected.length} selected
          </Text>
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<IconTrash size={12} />}
            onClick={() =>
              modals.openConfirmModal({
                title: "Delete posts",
                children: (
                  <Text size="sm">
                    Are you sure you want to delete {selected.length} selected
                    posts? This action cannot be undone.
                  </Text>
                ),
                labels: { confirm: "Delete", cancel: "Cancel" },
                confirmProps: { color: "red" },
                onConfirm: () => {
                  notifications.show({
                    title: "Posts Deleted",
                    message: `${selected.length} posts moved to trash.`,
                    color: "red",
                  });
                  setSelected([]);
                },
              })
            }
          >
            Delete
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            onClick={() => {
              notifications.show({
                title: "Status Updated",
                message: "Posts moved to draft.",
                color: "blue",
              });
              setSelected([]);
            }}
          >
            Move to Draft
          </Button>
        </Group>
      )}

      {/* Posts table */}
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
              <Table.Th w={36}>
                <Checkbox
                  size="xs"
                  checked={selected.length === filtered.length}
                  onChange={() =>
                    setSelected(
                      selected.length === filtered.length
                        ? []
                        : filtered.map((p) => p.id),
                    )
                  }
                />
              </Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Author</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th ta="right">Views</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((post) => (
              <Table.Tr key={post.id}>
                <Table.Td>
                  <Checkbox
                    size="xs"
                    checked={selected.includes(post.id)}
                    onChange={() => toggleSelect(post.id)}
                  />
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {post.title}
                  </Text>
                  <Group gap={4} mt={2}>
                    {post.tags.map((tag) => (
                      <Badge key={tag} variant="outline" size="xs" color="gray">
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Avatar size="xs" radius="xl" color="blue">
                      {post.author[0]}
                    </Avatar>
                    <Text size="sm" c="dimmed">
                      {post.author}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{post.category}</Text>
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
                <Table.Td>
                  <Menu shadow="md" width={160} position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" size="sm">
                        <IconDotsVertical size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconEdit size={14} />}
                        onClick={() => {
                          notifications.show({
                            title: "Edit",
                            message: "Opening editor...",
                            color: "blue",
                          });
                        }}
                      >
                        Edit
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconEye size={14} />}
                        onClick={() => {
                          notifications.show({
                            title: "Preview",
                            message: "Opening preview...",
                            color: "blue",
                          });
                        }}
                      >
                        Preview
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconCopy size={14} />}
                        onClick={() => {
                          notifications.show({
                            title: "Duplicated",
                            message: "Post duplicated successfully.",
                            color: "green",
                          });
                        }}
                      >
                        Duplicate
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item
                        leftSection={<IconTrash size={14} />}
                        color="red"
                        onClick={() =>
                          modals.openConfirmModal({
                            title: "Delete post",
                            children: (
                              <Text size="sm">
                                Are you sure you want to delete &ldquo;
                                {post.title}&rdquo;? This action cannot be
                                undone.
                              </Text>
                            ),
                            labels: { confirm: "Delete", cancel: "Cancel" },
                            confirmProps: { color: "red" },
                            onConfirm: () =>
                              notifications.show({
                                title: "Deleted",
                                message: "Post moved to trash.",
                                color: "red",
                              }),
                          })
                        }
                      >
                        Delete
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>

      <Group justify="space-between" mt="md">
        <Text size="xs" c="dimmed">
          Showing {filtered.length} of {posts.length} posts
        </Text>
        <Pagination total={3} size="xs" />
      </Group>
    </Box>
  );
};

export default Posts;
