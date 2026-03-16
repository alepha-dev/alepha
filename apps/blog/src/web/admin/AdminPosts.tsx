import { DataTable, Flex, Text, useDialog, useToast } from "@alepha/ui";
import { Badge } from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { t } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { PostController } from "@/api/controllers/PostController.ts";
import type { Post } from "@/api/entities/posts.ts";

export type AdminPostsProps = {};

const filters = t.object({
  query: t.optional(t.text()),
});

const AdminPosts = (props: AdminPostsProps) => {
  const client = useClient<PostController>();
  const { l } = useI18n();
  const dialog = useDialog();
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleDelete = async (post: Post) => {
    const confirmed = await dialog.confirm({
      title: "Delete post",
      message: `Delete "${post.title}"? This action can be undone (soft delete).`,
    });
    if (!confirmed) return;
    await client.deletePost({ params: { slug: post.slug } });
    toast.success({ message: "Post deleted" });
    refresh();
  };

  const handleTogglePublish = async (post: Post) => {
    if (post.publishedAt) {
      await client.unpublishPost({ params: { slug: post.slug } });
      toast.success({ message: "Post unpublished" });
    } else {
      await client.publishPost({ params: { slug: post.slug } });
      toast.success({ message: "Post published" });
    }
    refresh();
  };

  return (
    <Flex p="md" flex={1} direction="column">
      <DataTable<Post, typeof filters>
        key={refreshKey}
        submitOnInit
        defaultSize={20}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
        }}
        actions={[
          {
            icon: IconPlus,
            children: "New Post",
            href: "/admin/posts/new",
          },
        ]}
        items={async () => {
          const posts = await client.listAll({});
          return { content: posts as any[] };
        }}
        columns={{
          title: {
            label: "Title",
            sortable: true,
            value: (item) => (
              <Flex col>
                <Text size="sm" fw={500}>
                  {item.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {item.slug}
                </Text>
              </Flex>
            ),
            action: (item) => ({
              href: `/admin/posts/${item.slug}/edit`,
              variant: "transparent" as const,
            }),
          },
          status: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                color={item.publishedAt ? "green" : "yellow"}
                variant="light"
              >
                {item.publishedAt ? "Published" : "Draft"}
              </Badge>
            ),
          },
          tags: {
            label: "Tags",
            value: (item) => (
              <Flex gap={4} wrap="wrap">
                {item.tags.map((tag) => (
                  <Badge key={tag} size="xs" variant="outline">
                    {tag}
                  </Badge>
                ))}
              </Flex>
            ),
          },
          publishedAt: {
            label: "Published",
            fit: true,
            sortable: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.publishedAt ? String(l(item.publishedAt)) : "—"}
              </Text>
            ),
          },
          createdAt: {
            label: "Created",
            fit: true,
            sortable: true,
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {String(l(item.createdAt))}
              </Text>
            ),
          },
        }}
        rowActions={(item) => [
          {
            label: "Edit",
            icon: IconPencil,
            href: `/admin/posts/${item.slug}/edit`,
          },
          {
            label: item.publishedAt ? "Unpublish" : "Publish",
            onClick: () => handleTogglePublish(item),
          },
          {
            label: "Delete",
            icon: IconTrash,
            color: "red",
            onClick: () => handleDelete(item),
          },
        ]}
      />
    </Flex>
  );
};

export default AdminPosts;
