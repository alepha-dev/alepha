import { ActionButton, Flex } from "@alepha/ui";
import {
  Badge,
  Pagination,
  SegmentedControl,
  Skeleton,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconDots,
  IconEdit,
  IconEye,
  IconPlus,
  IconSearch,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { AdminPostController } from "../../api/controllers/AdminPostController.ts";
import type { PostResource } from "../../api/schemas/postSchemas.ts";

function formatDate(dateStr?: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const statusColors: Record<string, string> = {
  published: "green",
  draft: "gray",
  archived: "orange",
};

export interface AdminPostsProps {
  initialPosts: PostResource[];
  initialTotal: number;
}

const AdminPosts = ({ initialPosts, initialTotal }: AdminPostsProps) => {
  const client = useClient<AdminPostController>();
  const router = useRouter();

  const [posts, setPosts] = useState<PostResource[]>(initialPosts);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const pageSize = 15;

  const load = async () => {
    setLoading(true);
    try {
      const query: Record<string, unknown> = { page: page - 1, size: pageSize };
      if (statusFilter !== "all") query.status = statusFilter;
      if (search) query.search = search;

      const res = await client.findPosts({ query: query as any });
      const data = res as unknown as {
        content: PostResource[];
        page: { totalElements?: number };
      };
      setPosts(data.content);
      setTotal(data.page.totalElements || 0);
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, statusFilter]);

  const deletePost = async (id: string) => {
    if (!confirm("Delete this post?")) return;
    await client.deletePost({ params: { id } });
    load();
  };

  const publishPost = async (id: string) => {
    await client.publishPost({ params: { id } });
    load();
  };

  return (
    <Flex direction="column" gap="lg" p="lg">
      <Flex justify="space-between">
        <Title order={2}>Posts</Title>
        <ActionButton
          icon={IconPlus}
          color="dark"
          radius="sm"
          href="/admin/posts/new"
        >
          New Post
        </ActionButton>
      </Flex>

      {/* Filters */}
      <Flex gap="md">
        <SegmentedControl
          value={statusFilter}
          onChange={(val) => {
            setStatusFilter(val);
            setPage(1);
          }}
          data={[
            { label: "All", value: "all" },
            { label: "Published", value: "published" },
            { label: "Drafts", value: "draft" },
            { label: "Archived", value: "archived" },
          ]}
          size="sm"
        />
        <TextInput
          placeholder="Search posts..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setPage(1);
              load();
            }
          }}
          size="sm"
          style={{ flex: 1, maxWidth: 300 }}
        />
      </Flex>

      {/* Table */}
      {loading ? (
        <Flex direction="column" gap="xs">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={48} />
          ))}
        </Flex>
      ) : posts.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No posts found.
        </Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Title</Table.Th>
              <Table.Th>Author</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th>Views</Table.Th>
              <Table.Th w={60} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {posts.map((post) => (
              <Table.Tr
                key={post.id}
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/admin/posts/${post.id}/edit`)}
              >
                <Table.Td>
                  <Text fz="sm" fw={500} lineClamp={1}>
                    {post.title}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text fz="sm" c="dimmed">
                    {post.authorName}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text fz="sm" c="dimmed">
                    {post.categoryName || "-"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge
                    size="sm"
                    variant="light"
                    color={statusColors[post.status] || "gray"}
                    radius="sm"
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
                <Table.Td>
                  <ActionButton
                    icon={IconDots}
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    menu={{
                      position: "bottom-end",
                      items: [
                        {
                          label: "Edit",
                          icon: <IconEdit size={14} />,
                          onClick: () =>
                            router.push(`/admin/posts/${post.id}/edit`),
                        },
                        ...(post.status === "published"
                          ? [
                              {
                                label: "View",
                                icon: <IconEye size={14} />,
                                href: `/post/${post.slug}`,
                              },
                            ]
                          : []),
                        ...(post.status === "draft"
                          ? [
                              {
                                label: "Publish",
                                icon: <IconSend size={14} />,
                                onClick: () => publishPost(post.id),
                              },
                            ]
                          : []),
                        { type: "divider" as const },
                        {
                          label: "Delete",
                          icon: <IconTrash size={14} />,
                          color: "red",
                          onClick: () => deletePost(post.id),
                        },
                      ],
                    }}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <Flex justify="center">
          <Pagination
            value={page}
            onChange={setPage}
            total={Math.ceil(total / pageSize)}
            size="sm"
          />
        </Flex>
      )}
    </Flex>
  );
};

export default AdminPosts;
