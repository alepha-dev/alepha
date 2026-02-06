import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  MultiSelect,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBold,
  IconCode,
  IconDeviceFloppy,
  IconEye,
  IconH1,
  IconH2,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
  IconPhoto,
  IconQuote,
  IconSend,
  IconUnderline,
} from "@tabler/icons-react";
import { useState } from "react";

const PostEditor = () => {
  const [editorMode, setEditorMode] = useState("visual");

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          New Post
        </Title>
        <Group gap="sm">
          <Button
            variant="outline"
            color="gray"
            size="sm"
            leftSection={<IconDeviceFloppy size={14} />}
            onClick={() =>
              notifications.show({
                title: "Draft Saved",
                message: "Your post draft has been saved.",
                color: "teal",
              })
            }
          >
            Save Draft
          </Button>
          <Button
            variant="outline"
            color="gray"
            size="sm"
            leftSection={<IconEye size={14} />}
            onClick={() =>
              notifications.show({
                title: "Preview",
                message: "Opening post preview in a new tab...",
                color: "blue",
              })
            }
          >
            Preview
          </Button>
          <Button
            color="orange"
            size="sm"
            leftSection={<IconSend size={14} />}
            onClick={() =>
              notifications.show({
                title: "Published!",
                message: "Your post has been published successfully.",
                color: "teal",
              })
            }
          >
            Publish
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        {/* Main editor area */}
        <Box style={{ gridColumn: "span 2" }}>
          <Stack gap="md">
            <TextInput
              placeholder="Post title"
              size="lg"
              styles={{
                input: {
                  fontWeight: 600,
                  fontSize: 24,
                  border: "1px solid var(--mantine-color-default-border)",
                },
              }}
            />

            <TextInput
              placeholder="post-url-slug"
              size="xs"
              leftSection={
                <Text size="xs" c="dimmed">
                  alepha.blog/
                </Text>
              }
              leftSectionWidth={80}
              styles={{
                input: {
                  border: "1px solid var(--mantine-color-default-border)",
                },
              }}
            />

            {/* Rich text editor toolbar */}
            <Card withBorder radius="md" p={0}>
              <Group
                justify="space-between"
                px="sm"
                py="xs"
                style={{
                  borderBottom: "1px solid var(--mantine-color-default-border)",
                }}
              >
                <Group gap={2}>
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconH1 size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconH2 size={16} />
                  </ActionIcon>
                  <Divider orientation="vertical" mx={4} />
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconBold size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconItalic size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconUnderline size={16} />
                  </ActionIcon>
                  <Divider orientation="vertical" mx={4} />
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconList size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconListNumbers size={16} />
                  </ActionIcon>
                  <Divider orientation="vertical" mx={4} />
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconLink size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconPhoto size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconCode size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" size="sm">
                    <IconQuote size={16} />
                  </ActionIcon>
                </Group>
                <SegmentedControl
                  size="xs"
                  value={editorMode}
                  onChange={setEditorMode}
                  data={[
                    { value: "visual", label: "Visual" },
                    { value: "code", label: "Code" },
                  ]}
                />
              </Group>

              {/* Editor area */}
              <Box p="md" style={{ minHeight: 400 }}>
                {editorMode === "visual" ? (
                  <Text c="dimmed" size="sm">
                    Start writing your post content here. Use the toolbar above
                    to format your text, add headings, insert images, and
                    more...
                  </Text>
                ) : (
                  <Box
                    style={{
                      fontFamily: "monospace",
                      fontSize: 13,
                      color: "#6b7280",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {`<h2>Your heading here</h2>\n<p>Start writing your post content...</p>\n<p>Use HTML tags to format your content.</p>`}
                  </Box>
                )}
              </Box>
            </Card>

            {/* Excerpt */}
            <Card withBorder radius="md" p="md">
              <Text fw={600} size="sm" mb="sm">
                Excerpt
              </Text>
              <Textarea
                placeholder="Write a short summary of your post..."
                minRows={3}
                styles={{
                  input: {
                    border: "1px solid var(--mantine-color-default-border)",
                  },
                }}
              />
            </Card>
          </Stack>
        </Box>

        {/* Right sidebar */}
        <Stack gap="md">
          {/* Publish settings */}
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="sm">
              Publish
            </Text>
            <Stack gap="sm">
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Status
                </Text>
                <Badge variant="light" color="gray" size="sm">
                  Draft
                </Badge>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Visibility
                </Text>
                <Text size="xs" fw={500}>
                  Public
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Publish date
                </Text>
                <Text size="xs" fw={500}>
                  Immediately
                </Text>
              </Group>
              <Divider />
              <Switch label="Stick to top of blog" size="xs" />
              <Switch label="Allow comments" size="xs" defaultChecked />
            </Stack>
          </Card>

          {/* Category */}
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="sm">
              Category
            </Text>
            <Select
              placeholder="Select category"
              data={[
                "Tutorials",
                "TypeScript",
                "React",
                "DevOps",
                "Reviews",
                "Architecture",
                "Tooling",
                "News",
              ]}
              size="xs"
              searchable
            />
          </Card>

          {/* Tags */}
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="sm">
              Tags
            </Text>
            <MultiSelect
              placeholder="Add tags..."
              data={[
                "alepha",
                "typescript",
                "react",
                "ssr",
                "mantine",
                "tailwind",
                "cloudflare",
                "deploy",
                "websockets",
                "api",
              ]}
              size="xs"
              searchable
            />
          </Card>

          {/* Featured Image */}
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="sm">
              Featured Image
            </Text>
            <Box
              style={{
                border: "2px dashed var(--mantine-color-default-border)",
                borderRadius: 8,
                padding: 24,
                textAlign: "center",
              }}
            >
              <IconPhoto
                size={32}
                color="#9ca3af"
                style={{ margin: "0 auto 8px" }}
              />
              <Text size="xs" c="dimmed" mb="xs">
                Drag and drop or click to upload
              </Text>
              <Button
                variant="outline"
                color="gray"
                size="xs"
                onClick={() =>
                  notifications.show({
                    title: "Media Library",
                    message: "Opening media library...",
                    color: "blue",
                  })
                }
              >
                Choose Image
              </Button>
            </Box>
          </Card>

          {/* SEO Preview */}
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="sm">
              SEO Preview
            </Text>
            <Box
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: 6,
                padding: 12,
              }}
            >
              <Text size="sm" c="blue" fw={500}>
                Post Title - Alepha Blog
              </Text>
              <Text size="xs" c="teal" mb={2}>
                alepha.blog/posts/post-url-slug
              </Text>
              <Text size="xs" c="dimmed" lineClamp={2}>
                Write a short summary of your post to appear in search engine
                results...
              </Text>
            </Box>
          </Card>
        </Stack>
      </SimpleGrid>
    </Box>
  );
};

export default PostEditor;
