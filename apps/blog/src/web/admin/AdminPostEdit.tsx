import {
  ActionButton,
  Control,
  Flex,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Badge, Divider } from "@mantine/core";
import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconEye,
  IconRocket,
  IconRocketOff,
} from "@tabler/icons-react";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { PostController } from "@/api/controllers/PostController.ts";
import type { Post } from "@/api/entities/posts.ts";
import { postUpdateSchema } from "@/api/schemas/postUpdateSchema.ts";
import type { AppRouter } from "@/web/AppRouter.ts";

export interface AdminPostEditProps {
  slug: string;
}

const AdminPostEdit = (props: AdminPostEditProps) => {
  const client = useClient<PostController>();
  const router = useRouter<AppRouter>();
  const toast = useToast();
  const dialog = useDialog();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);

  const form = useForm(
    {
      schema: postUpdateSchema,
      handler: async (values) => {
        const updated = await client.updatePost({
          params: { slug: props.slug },
          body: values as any,
        });
        setPost(updated as any);
        toast.success({ message: "Post saved" });
      },
    },
    [props.slug],
  );

  useEffect(() => {
    client
      .getBySlug({ params: { slug: props.slug } })
      .catch(() =>
        client
          .listAll({})
          .then((posts: any) => posts.find((p: Post) => p.slug === props.slug)),
      )
      .then((p: any) => {
        if (!p) return;
        setPost(p);
        form.input.title.set(p.title);
        form.input.summary.set(p.summary);
        form.input.content.set(p.content);
        form.input.tags.set(p.tags);
        form.input.coverImage.set(p.coverImage ?? "");
      })
      .finally(() => setLoading(false));
  }, [props.slug]);

  const handleTogglePublish = async () => {
    if (!post) return;
    const action = post.publishedAt ? "unpublish" : "publish";
    const confirmed = await dialog.confirm({
      title: post.publishedAt ? "Unpublish post" : "Publish post",
      message: post.publishedAt
        ? `Unpublish "${post.title}"? It will no longer be visible to readers.`
        : `Publish "${post.title}"? It will be visible to everyone.`,
    });
    if (!confirmed) return;

    try {
      if (action === "unpublish") {
        await client.unpublishPost({ params: { slug: props.slug } });
      } else {
        await client.publishPost({ params: { slug: props.slug } });
      }
      toast.success({
        message: action === "publish" ? "Post published" : "Post unpublished",
      });
      router.push("adminPosts");
    } catch (e: any) {
      toast.danger({ message: e.message ?? "Failed" });
    }
  };

  if (loading) {
    return (
      <Flex p="xl" justify="center">
        <Text c="dimmed">Loading post...</Text>
      </Flex>
    );
  }

  if (!post) {
    return (
      <Flex p="xl" justify="center" direction="column" align="center" gap="md">
        <Text c="red" size="lg">
          Post not found
        </Text>
        <ActionButton
          variant="default"
          icon={IconArrowLeft}
          href="/admin/posts"
        >
          Back to posts
        </ActionButton>
      </Flex>
    );
  }

  return (
    <Flex form={form.props} col gap="lg" p="lg" maw={860} mx="auto" w="100%">
      <Flex justify="space-between" align="center">
        <Flex gap="sm" align="center">
          <ActionButton
            variant="subtle"
            icon={IconArrowLeft}
            href="/admin/posts"
            size="sm"
          />
          <Flex direction="column" gap={2}>
            <Text fw={700} size="xl">
              {post.title}
            </Text>
            <Flex gap="xs" align="center">
              <Text size="xs" c="dimmed" ff="monospace">
                /{post.slug}
              </Text>
              <Badge
                size="xs"
                color={post.publishedAt ? "green" : "yellow"}
                variant="light"
              >
                {post.publishedAt ? "Published" : "Draft"}
              </Badge>
            </Flex>
          </Flex>
        </Flex>
        <Flex gap="xs">
          <ActionButton
            variant="default"
            icon={preview ? IconArrowLeft : IconEye}
            onClick={() => setPreview(!preview)}
            size="sm"
          >
            {preview ? "Edit" : "Preview"}
          </ActionButton>
          <ActionButton
            variant="default"
            icon={post.publishedAt ? IconRocketOff : IconRocket}
            onClick={handleTogglePublish}
            size="sm"
          >
            {post.publishedAt ? "Unpublish" : "Publish"}
          </ActionButton>
          <ActionButton
            intent="primary"
            icon={IconDeviceFloppy}
            form={form}
            size="sm"
          >
            Save
          </ActionButton>
        </Flex>
      </Flex>

      <Divider />

      {preview ? (
        <Flex direction="column" gap="md" p="xl" bordered rounded="lg" surface>
          <Text fw={700} size="xl">
            {post.title}
          </Text>
          <Text size="sm" c="dimmed">
            {post.summary}
          </Text>
          <Divider />
          {/** biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized */}
          <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
        </Flex>
      ) : (
        <Flex direction="column" gap="md">
          <Control
            input={form.input.title}
            text={{ size: "lg", styles: { input: { fontWeight: 600 } } }}
          />

          <Control input={form.input.summary} area={{ minRows: 2 }} />

          <Control
            input={form.input.content}
            area={{
              minRows: 20,
              autosize: true,
              styles: {
                input: {
                  fontFamily: "monospace",
                  fontSize: 14,
                  lineHeight: 1.7,
                },
              },
            }}
          />

          <Divider />

          <Flex gap="md">
            <Flex flex={1}>
              <Control input={form.input.tags} select={{ creatable: true }} />
            </Flex>
            <Flex flex={1}>
              <Control input={form.input.coverImage} />
            </Flex>
          </Flex>
        </Flex>
      )}
    </Flex>
  );
};

export default AdminPostEdit;
