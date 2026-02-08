import { ActionButton, Flex } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Select,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { RichTextEditor } from "@mantine/tiptap";
import { IconArrowLeft, IconDeviceFloppy, IconSend } from "@tabler/icons-react";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { AdminPostController } from "../../api/controllers/AdminPostController.ts";
import type { CategoryResource } from "../../api/schemas/categorySchemas.ts";
import type { PostResource } from "../../api/schemas/postSchemas.ts";

export interface AdminPostEditorProps {
  categories: CategoryResource[];
  post?: PostResource;
}

const AdminPostEditor = ({
  categories,
  post: initialPost,
}: AdminPostEditorProps) => {
  const router = useRouter();
  const postClient = useClient<AdminPostController>();

  const isEditing = !!initialPost;

  const [title, setTitle] = useState(initialPost?.title || "");
  const [slug, setSlug] = useState(initialPost?.slug || "");
  const [excerpt, setExcerpt] = useState(initialPost?.excerpt || "");
  const [categoryId, setCategoryId] = useState<string | null>(
    initialPost?.categoryId || null,
  );
  const [tags, setTags] = useState<string[]>(initialPost?.tags || []);
  const [featured, setFeatured] = useState(initialPost?.featured || false);
  const [status, setStatus] = useState(initialPost?.status || "draft");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Highlight,
      Placeholder.configure({ placeholder: "Write your story..." }),
    ],
    content: initialPost?.content || "",
  });

  const generateSlug = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

  const save = async (publishNow = false) => {
    const data = {
      title,
      slug: slug || generateSlug(title),
      content: editor?.getHTML() || "",
      excerpt: excerpt || undefined,
      categoryId: categoryId || undefined,
      tags,
      featured,
      status: publishNow ? "published" : status,
    };

    try {
      if (publishNow) setPublishing(true);
      else setSaving(true);

      if (isEditing && initialPost) {
        await postClient.updatePost({
          params: { id: initialPost.id },
          body: data as any,
        });
      } else {
        const result = await postClient.createPost({ body: data as any });
        const created = result as PostResource;
        router.push(`/admin/posts/${created.id}/edit`);
      }
    } catch {
      // handle error
    } finally {
      setSaving(false);
      setPublishing(false);
    }
  };

  return (
    <Flex direction="column" gap="lg" p="lg">
      {/* Header */}
      <Flex justify="space-between">
        <Flex gap="sm">
          <ActionButton
            variant="subtle"
            color="gray"
            size="sm"
            icon={IconArrowLeft}
            href="/admin/posts"
          >
            Back
          </ActionButton>
          <Title order={3}>{isEditing ? "Edit Post" : "New Post"}</Title>
          {isEditing && (
            <Badge
              size="sm"
              variant="light"
              color={status === "published" ? "green" : "gray"}
            >
              {status}
            </Badge>
          )}
        </Flex>
        <Flex gap="sm">
          <ActionButton
            variant="outline"
            color="gray"
            radius="sm"
            loading={saving}
            icon={IconDeviceFloppy}
            onClick={() => save(false)}
          >
            Save Draft
          </ActionButton>
          <ActionButton
            color="dark"
            radius="sm"
            loading={publishing}
            icon={IconSend}
            onClick={() => save(true)}
          >
            Publish
          </ActionButton>
        </Flex>
      </Flex>

      <Grid>
        {/* Editor column */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Flex direction="column" gap="md">
            <TextInput
              placeholder="Post title"
              value={title}
              onChange={(e) => {
                setTitle(e.currentTarget.value);
                if (!isEditing && !slug) {
                  setSlug(generateSlug(e.currentTarget.value));
                }
              }}
              size="lg"
              styles={{
                input: {
                  fontFamily: '"Lora", Georgia, serif',
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  border: "none",
                  borderBottom: "1px solid var(--mantine-color-default-border)",
                  borderRadius: 0,
                  paddingLeft: 0,
                },
              }}
            />

            <TextInput
              placeholder="url-slug"
              value={slug}
              onChange={(e) => setSlug(e.currentTarget.value)}
              size="sm"
              leftSection={
                <Text fz="xs" c="dimmed">
                  /post/
                </Text>
              }
              leftSectionWidth={48}
            />

            {/* Rich text editor */}
            <Card withBorder radius="sm" p={0}>
              <RichTextEditor editor={editor as never}>
                <RichTextEditor.Toolbar>
                  <RichTextEditor.ControlsGroup>
                    <RichTextEditor.Bold />
                    <RichTextEditor.Italic />
                    <RichTextEditor.Underline />
                    <RichTextEditor.Strikethrough />
                  </RichTextEditor.ControlsGroup>
                  <RichTextEditor.ControlsGroup>
                    <RichTextEditor.H1 />
                    <RichTextEditor.H2 />
                    <RichTextEditor.H3 />
                  </RichTextEditor.ControlsGroup>
                  <RichTextEditor.ControlsGroup>
                    <RichTextEditor.BulletList />
                    <RichTextEditor.OrderedList />
                  </RichTextEditor.ControlsGroup>
                  <RichTextEditor.ControlsGroup>
                    <RichTextEditor.Link />
                    <RichTextEditor.Unlink />
                  </RichTextEditor.ControlsGroup>
                  <RichTextEditor.ControlsGroup>
                    <RichTextEditor.Blockquote />
                    <RichTextEditor.Code />
                    <RichTextEditor.Highlight />
                  </RichTextEditor.ControlsGroup>
                </RichTextEditor.Toolbar>
                <RichTextEditor.Content
                  styles={{
                    root: { minHeight: 400 },
                  }}
                />
              </RichTextEditor>
            </Card>

            {/* Excerpt */}
            <TextInput
              label="Excerpt"
              placeholder="A brief summary of the post..."
              value={excerpt}
              onChange={(e) => setExcerpt(e.currentTarget.value)}
            />
          </Flex>
        </Grid.Col>

        {/* Sidebar */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Flex direction="column" gap="md">
            {/* Publish settings */}
            <Card withBorder radius="sm" p="md">
              <Text fw={600} fz="sm" mb="md">
                Publish Settings
              </Text>
              <Flex direction="column" gap="sm">
                <Select
                  label="Status"
                  value={status}
                  onChange={(val) => setStatus((val || "draft") as any)}
                  data={[
                    { value: "draft", label: "Draft" },
                    { value: "published", label: "Published" },
                    { value: "archived", label: "Archived" },
                  ]}
                  size="sm"
                />
                <Select
                  label="Category"
                  value={categoryId}
                  onChange={setCategoryId}
                  data={categories.map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                  placeholder="Select category"
                  clearable
                  size="sm"
                />
                <TagsInput
                  label="Tags"
                  value={tags}
                  onChange={setTags}
                  placeholder="Add tags"
                  size="sm"
                />
                <Switch
                  label="Featured post"
                  checked={featured}
                  onChange={(e) => setFeatured(e.currentTarget.checked)}
                  size="sm"
                />
              </Flex>
            </Card>
          </Flex>
        </Grid.Col>
      </Grid>
    </Flex>
  );
};

export default AdminPostEditor;
