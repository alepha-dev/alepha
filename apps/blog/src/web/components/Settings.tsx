import {
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconClock,
  IconDeviceFloppy,
  IconMail,
  IconWorld,
} from "@tabler/icons-react";
import { useState } from "react";

const Settings = () => {
  const [activeSection, setActiveSection] = useState("general");

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Settings
        </Title>
        <Button
          color="orange"
          size="sm"
          leftSection={<IconDeviceFloppy size={14} />}
          onClick={() =>
            notifications.show({
              title: "Settings Saved",
              message: "Your settings have been saved successfully.",
              color: "teal",
            })
          }
        >
          Save Changes
        </Button>
      </Group>

      {/* Settings navigation */}
      <SegmentedControl
        size="xs"
        value={activeSection}
        onChange={setActiveSection}
        mb="xl"
        data={[
          { value: "general", label: "General" },
          { value: "writing", label: "Writing" },
          { value: "reading", label: "Reading" },
          { value: "discussion", label: "Discussion" },
          { value: "media", label: "Media" },
          { value: "permalinks", label: "Permalinks" },
        ]}
      />

      {activeSection === "general" && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Site Identity
            </Text>
            <Stack gap="sm">
              <TextInput
                label="Site Title"
                defaultValue="Alepha Blog"
                size="sm"
              />
              <TextInput
                label="Tagline"
                defaultValue="A modern blog about web development"
                size="sm"
              />
              <TextInput
                label="Site URL"
                defaultValue="https://alepha.blog"
                size="sm"
                leftSection={<IconWorld size={14} />}
              />
              <TextInput
                label="Admin Email"
                defaultValue="admin@alepha.blog"
                size="sm"
                leftSection={<IconMail size={14} />}
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Regional Settings
            </Text>
            <Stack gap="sm">
              <Select
                label="Language"
                defaultValue="en"
                data={[
                  { value: "en", label: "English" },
                  { value: "fr", label: "French" },
                  { value: "de", label: "German" },
                  { value: "es", label: "Spanish" },
                  { value: "ja", label: "Japanese" },
                ]}
                size="sm"
              />
              <Select
                label="Timezone"
                defaultValue="europe-paris"
                data={[
                  { value: "utc", label: "UTC+0" },
                  { value: "europe-london", label: "Europe/London (GMT)" },
                  { value: "europe-paris", label: "Europe/Paris (CET)" },
                  {
                    value: "america-new-york",
                    label: "America/New_York (EST)",
                  },
                  {
                    value: "asia-tokyo",
                    label: "Asia/Tokyo (JST)",
                  },
                ]}
                size="sm"
                leftSection={<IconClock size={14} />}
              />
              <Select
                label="Date Format"
                defaultValue="mdy"
                data={[
                  { value: "mdy", label: "February 5, 2026" },
                  { value: "dmy", label: "5 February 2026" },
                  { value: "ymd", label: "2026-02-05" },
                  { value: "short", label: "02/05/2026" },
                ]}
                size="sm"
              />
              <Select
                label="Time Format"
                defaultValue="12h"
                data={[
                  { value: "12h", label: "12-hour (2:30 PM)" },
                  { value: "24h", label: "24-hour (14:30)" },
                ]}
                size="sm"
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Membership
            </Text>
            <Stack gap="sm">
              <Switch
                label="Anyone can register"
                defaultChecked={false}
                size="sm"
              />
              <Select
                label="New User Default Role"
                defaultValue="subscriber"
                data={[
                  { value: "subscriber", label: "Subscriber" },
                  { value: "contributor", label: "Contributor" },
                  { value: "author", label: "Author" },
                  { value: "editor", label: "Editor" },
                ]}
                size="sm"
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Group justify="space-between" mb="md">
              <Text fw={600} size="sm">
                Features
              </Text>
              <Badge variant="light" color="blue" size="xs">
                Pro
              </Badge>
            </Group>
            <Stack gap="sm">
              <Switch label="Enable comments" defaultChecked size="sm" />
              <Switch label="Enable post revisions" defaultChecked size="sm" />
              <Switch label="Enable RSS feed" defaultChecked size="sm" />
              <Switch label="Enable XML sitemap" defaultChecked size="sm" />
              <Switch label="Enable search indexing" defaultChecked size="sm" />
              <Switch
                label="Maintenance mode"
                defaultChecked={false}
                size="sm"
              />
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {activeSection === "writing" && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Default Post Settings
            </Text>
            <Stack gap="sm">
              <Select
                label="Default Post Category"
                defaultValue="uncategorized"
                data={[
                  { value: "uncategorized", label: "Uncategorized" },
                  { value: "tutorials", label: "Tutorials" },
                  { value: "news", label: "News" },
                  { value: "reviews", label: "Reviews" },
                ]}
                size="sm"
              />
              <Select
                label="Default Post Format"
                defaultValue="standard"
                data={[
                  { value: "standard", label: "Standard" },
                  { value: "aside", label: "Aside" },
                  { value: "gallery", label: "Gallery" },
                  { value: "video", label: "Video" },
                  { value: "quote", label: "Quote" },
                ]}
                size="sm"
              />
              <Select
                label="Default Editor"
                defaultValue="visual"
                data={[
                  { value: "visual", label: "Visual Editor" },
                  { value: "code", label: "Code Editor" },
                  { value: "markdown", label: "Markdown" },
                ]}
                size="sm"
              />
              <Switch label="Auto-save drafts" defaultChecked size="sm" />
              <NumberInput
                label="Auto-save interval (seconds)"
                defaultValue={60}
                min={10}
                max={600}
                size="sm"
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Post via Email
            </Text>
            <Stack gap="sm">
              <Switch
                label="Enable post via email"
                defaultChecked={false}
                size="sm"
              />
              <TextInput
                label="Email Server"
                placeholder="mail.example.com"
                size="sm"
                disabled
              />
              <TextInput
                label="Login Name"
                placeholder="login@example.com"
                size="sm"
                disabled
              />
              <TextInput
                label="Password"
                placeholder="********"
                type="password"
                size="sm"
                disabled
              />
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {activeSection === "reading" && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Homepage Display
            </Text>
            <Stack gap="sm">
              <Select
                label="Your homepage displays"
                defaultValue="posts"
                data={[
                  { value: "posts", label: "Your latest posts" },
                  { value: "page", label: "A static page" },
                ]}
                size="sm"
              />
              <NumberInput
                label="Blog pages show at most"
                defaultValue={10}
                min={1}
                max={100}
                size="sm"
                suffix=" posts"
              />
              <NumberInput
                label="Syndication feeds show most recent"
                defaultValue={10}
                min={1}
                max={100}
                size="sm"
                suffix=" items"
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Feed Settings
            </Text>
            <Stack gap="sm">
              <Select
                label="For each post in a feed, include"
                defaultValue="excerpt"
                data={[
                  { value: "full", label: "Full text" },
                  { value: "excerpt", label: "Excerpt" },
                ]}
                size="sm"
              />
              <Switch
                label="Discourage search engines from indexing this site"
                defaultChecked={false}
                size="sm"
                description="It is up to search engines to honor this request"
              />
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {activeSection === "discussion" && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Default Post Settings
            </Text>
            <Stack gap="sm">
              <Switch
                label="Allow link notifications from other blogs (pingbacks and trackbacks)"
                defaultChecked
                size="sm"
              />
              <Switch
                label="Allow people to submit comments on new posts"
                defaultChecked
                size="sm"
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Comment Moderation
            </Text>
            <Stack gap="sm">
              <Switch
                label="Comment must be manually approved"
                defaultChecked={false}
                size="sm"
              />
              <Switch
                label="Comment author must have a previously approved comment"
                defaultChecked
                size="sm"
              />
              <Switch
                label="Enable threaded (nested) comments"
                defaultChecked
                size="sm"
              />
              <NumberInput
                label="Levels deep"
                defaultValue={5}
                min={1}
                max={10}
                size="sm"
              />
              <Switch
                label="Enable comment pagination"
                defaultChecked={false}
                size="sm"
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Email Notifications
            </Text>
            <Stack gap="sm">
              <Switch
                label="Email me when anyone posts a comment"
                defaultChecked
                size="sm"
              />
              <Switch
                label="Email me when a comment is held for moderation"
                defaultChecked
                size="sm"
              />
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {activeSection === "media" && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Image Sizes
            </Text>
            <Stack gap="sm">
              <Group grow>
                <NumberInput
                  label="Thumbnail width"
                  defaultValue={150}
                  size="sm"
                  suffix="px"
                />
                <NumberInput
                  label="Thumbnail height"
                  defaultValue={150}
                  size="sm"
                  suffix="px"
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Medium width"
                  defaultValue={300}
                  size="sm"
                  suffix="px"
                />
                <NumberInput
                  label="Medium height"
                  defaultValue={300}
                  size="sm"
                  suffix="px"
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Large width"
                  defaultValue={1024}
                  size="sm"
                  suffix="px"
                />
                <NumberInput
                  label="Large height"
                  defaultValue={1024}
                  size="sm"
                  suffix="px"
                />
              </Group>
              <Switch
                label="Crop thumbnail to exact dimensions"
                defaultChecked
                size="sm"
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              File Upload
            </Text>
            <Stack gap="sm">
              <NumberInput
                label="Maximum upload file size"
                defaultValue={64}
                size="sm"
                suffix=" MB"
              />
              <Select
                label="Organize uploads into"
                defaultValue="month"
                data={[
                  { value: "month", label: "Month and year folders" },
                  { value: "year", label: "Year folders" },
                  { value: "flat", label: "Single directory" },
                ]}
                size="sm"
              />
              <Switch
                label="Auto-generate WebP versions"
                defaultChecked
                size="sm"
              />
              <Switch
                label="Strip EXIF data from uploads"
                defaultChecked
                size="sm"
              />
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {activeSection === "permalinks" && (
        <Card withBorder radius="md" p="md" maw={600}>
          <Text fw={600} size="sm" mb="md">
            Permalink Structure
          </Text>
          <Stack gap="sm">
            <Select
              label="Common Settings"
              defaultValue="postname"
              data={[
                {
                  value: "plain",
                  label: "Plain - ?p=123",
                },
                {
                  value: "day-name",
                  label: "Day and name - /2026/02/05/sample-post/",
                },
                {
                  value: "month-name",
                  label: "Month and name - /2026/02/sample-post/",
                },
                {
                  value: "numeric",
                  label: "Numeric - /archives/123",
                },
                {
                  value: "postname",
                  label: "Post name - /sample-post/",
                },
              ]}
              size="sm"
            />
            <TextInput
              label="Custom Structure"
              defaultValue="/%postname%/"
              size="sm"
              description="Available tags: %year%, %monthnum%, %day%, %postname%, %category%, %author%"
            />
            <Divider />
            <TextInput
              label="Category Base"
              defaultValue="category"
              size="sm"
              placeholder="category"
            />
            <TextInput
              label="Tag Base"
              defaultValue="tag"
              size="sm"
              placeholder="tag"
            />
          </Stack>
        </Card>
      )}
    </Box>
  );
};

export default Settings;
