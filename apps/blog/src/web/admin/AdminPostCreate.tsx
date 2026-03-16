import {
  ActionButton,
  Control,
  Flex,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Divider } from "@mantine/core";
import { IconArrowLeft, IconDeviceFloppy } from "@tabler/icons-react";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import type { PostController } from "@/api/controllers/PostController.ts";
import { postCreateSchema } from "@/api/schemas/postCreateSchema.ts";
import type { AppRouter } from "@/web/AppRouter.ts";

export type AdminPostCreateProps = {};

const AdminPostCreate = (props: AdminPostCreateProps) => {
  const client = useClient<PostController>();
  const router = useRouter<AppRouter>();
  const toast = useToast();
  const dialog = useDialog();

  const form = useForm(
    {
      schema: postCreateSchema,
      handler: async (values) => {
        const confirmed = await dialog.confirm({
          title: "Create post",
          message: "Create this post as a draft?",
        });
        console.log("confirmed", confirmed);
        if (!confirmed) return;

        await client.createPost({ body: values as any });
        toast.success({ message: "Post created" });
        await router.push("adminPosts");
      },
    },
    [],
  );

  return (
    <Flex form={form} surface fill overflow col gap="lg" p="lg">
      <Flex justify="space-between" align="center">
        <Flex gap="sm" align="center">
          <ActionButton
            variant="subtle"
            icon={IconArrowLeft}
            href="/admin/posts"
            size="sm"
          />
          <Text fw={700} size="xl">
            New Post
          </Text>
        </Flex>
        <ActionButton
          intent="primary"
          icon={IconDeviceFloppy}
          form={form}
          size="sm"
        >
          Create Draft
        </ActionButton>
      </Flex>

      <Divider />

      <Flex direction="column" gap="md">
        <Control
          input={form.input.title}
          text={{ size: "lg", styles: { input: { fontWeight: 600 } } }}
        />
        <Control
          input={form.input.slug}
          text={{ size: "sm", ff: "monospace" } as any}
        />
      </Flex>

      <Control
        input={form.input.summary}
        area={{
          minRows: 2,
          placeholder: "A brief summary for list pages and RSS",
        }}
      />

      <Control
        input={form.input.content}
        area={{
          minRows: 20,
          autosize: true,
          placeholder: "Write your post in Markdown...",
          styles: {
            input: { fontFamily: "monospace", fontSize: 14, lineHeight: 1.7 },
          },
        }}
      />

      <Divider />

      <Flex gap="md">
        <Flex flex={1}>
          <Control
            input={form.input.tags}
            select={{
              creatable: true,
              tagsInputProps: { placeholder: "Press Enter to add a tag" },
            }}
          />
        </Flex>
        <Flex flex={1}>
          <Control
            input={form.input.coverImage}
            text={{ placeholder: "https://..." }}
          />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default AdminPostCreate;
