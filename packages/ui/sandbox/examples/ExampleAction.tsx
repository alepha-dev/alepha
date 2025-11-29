import { useRouter } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { ActionButton, Control, DarkModeButton } from "@alepha/ui";
import {
  Badge,
  Box,
  Code,
  Divider,
  Flex,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBrandGithub,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconFile,
  IconFolder,
  IconHome,
  IconLink,
  IconLogout,
  IconMail,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconShare,
  IconTrash,
  IconUpload,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { t } from "alepha";
import { useState } from "react";

const ExampleAction = () => {
  const router = useRouter();
  const [clickCount, setClickCount] = useState(0);
  const [lastAction, setLastAction] = useState<string>("");

  // Sample form for submit action
  const sampleForm = useForm({
    id: "action-form",
    schema: t.object({
      name: t.text({ title: "Name", description: "Your full name" }),
      email: t.text({ format: "email", title: "Email" }),
      message: t.text({ title: "Message" }),
    }),
    handler: async (values) => {
      setLastAction(`Form submitted with: ${JSON.stringify(values)}`);
      // Simulate async processing
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log("Form submitted:", values);
    },
  });

  const handleAsyncClick = async () => {
    setLastAction("Async action started...");
    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setClickCount((prev) => prev + 1);
    setLastAction(`Async action completed! Count: ${clickCount + 1}`);
  };

  return (
    <Stack p="xl" maw={1200} mx="auto">
      {/* Header */}
      <Box>
        <Flex justify="space-between" align="center" mb="md">
          <Title order={1}>Action Component Examples</Title>
          <Flex gap="md" align="center">
            <ActionButton
              href="/"
              variant="light"
              leftSection={<IconHome size={16} />}
            >
              Back to Home
            </ActionButton>
            <DarkModeButton mode="segmented" />
          </Flex>
        </Flex>
        <Text c="dimmed" size="lg">
          Comprehensive examples of the Action component with different
          configurations
        </Text>
        {lastAction && (
          <Badge color="blue" size="lg" mt="md">
            Last Action: {lastAction}
          </Badge>
        )}
      </Box>

      <Divider my="xl" />

      {/* Basic Navigation Actions */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Navigation Actions (href)
        </Title>
        <Text c="dimmed" mb="lg">
          Actions with href prop for navigation with active state support.
          Tooltips can provide additional context.
        </Text>

        <Group gap="md">
          <ActionButton
            href="/"
            icon={<IconHome />}
            tooltip="Navigate to home page"
          >
            Home
          </ActionButton>
          <ActionButton
            href="/playground"
            leftSection={<IconSettings size={16} />}
            tooltip="Open the playground"
          >
            Playground
          </ActionButton>
          <ActionButton
            href="/typeform"
            leftSection={<IconUser size={16} />}
            tooltip={{
              label: "View TypeForm examples",
              position: "bottom",
              withArrow: true,
            }}
          >
            TypeForm
          </ActionButton>
          <ActionButton
            href="https://github.com"
            leftSection={<IconBrandGithub size={16} />}
            rightSection={<IconExternalLink size={14} />}
            tooltip="Opens in new tab"
          >
            GitHub
          </ActionButton>
        </Group>

        <Code block mt="md">
          {`<Action
  href="/path"
  leftSection={<IconHome />}
  tooltip="Navigate to home page"
>
  Home
</Action>`}
        </Code>
      </Paper>

      {/* Click Actions */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Click Actions with Loading State
        </Title>
        <Text c="dimmed" mb="lg">
          Actions with onClick handlers automatically handle async operations
          and loading states
        </Text>

        <Stack gap="md">
          <Group gap="md">
            <ActionButton
              onClick={() => {
                setClickCount((prev) => prev + 1);
                setLastAction(`Clicked! Count: ${clickCount + 1}`);
              }}
              leftSection={<IconPlus size={16} />}
              variant="filled"
            >
              Sync Click (Count: {clickCount})
            </ActionButton>

            <ActionButton
              onClick={handleAsyncClick}
              leftSection={<IconRefresh size={16} />}
              variant="light"
            >
              Async Operation
            </ActionButton>

            <ActionButton
              onClick={async () => {
                setLastAction("Downloading...");
                await new Promise((resolve) => setTimeout(resolve, 2000));
                setLastAction("Download complete!");
              }}
              leftSection={<IconDownload size={16} />}
              variant="outline"
            >
              Download File
            </ActionButton>
          </Group>

          <Code block>
            {`<Action onClick={async () => { await someAsyncOperation(); }}>
  Async Operation
</Action>`}
          </Code>
        </Stack>
      </Paper>

      {/* Form Submit Actions */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Form Submit Actions
        </Title>
        <Text c="dimmed" mb="lg">
          Actions with form prop automatically handle form submission with
          loading states
        </Text>

        <Stack gap="md">
          <Control input={sampleForm.input.name} />
          <Control input={sampleForm.input.email} />
          <Control input={sampleForm.input.message} area />

          <Group gap="md">
            <ActionButton
              form={sampleForm}
              leftSection={<IconCheck size={16} />}
              variant="filled"
              color="green"
            >
              Submit Form
            </ActionButton>

            <ActionButton
              form={sampleForm}
              leftSection={<IconUpload size={16} />}
              variant="light"
            >
              Save Draft
            </ActionButton>
          </Group>

          <Code block>
            {`const form = useForm({ ... });
<Action form={form} variant="filled">Submit</Action>`}
          </Code>
        </Stack>
      </Paper>

      {/* Icon-Only Actions with Tooltips */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Icon-Only Actions with Tooltips
        </Title>
        <Text c="dimmed" mb="lg">
          Actions with leftSection but no children automatically become icon
          buttons. Add tooltips for better UX.
        </Text>

        <Group gap="md">
          <ActionButton
            leftSection={<IconEdit size={16} />}
            onClick={() => setLastAction("Edit clicked")}
            variant="subtle"
            tooltip="Edit item"
          />
          <ActionButton
            leftSection={<IconTrash size={16} />}
            onClick={() => setLastAction("Delete clicked")}
            variant="subtle"
            color="red"
            tooltip={{
              label: "Delete item",
              color: "red",
              position: "top",
              withArrow: true,
            }}
          />
          <ActionButton
            leftSection={<IconSettings size={16} />}
            onClick={() => setLastAction("Settings clicked")}
            variant="filled"
            tooltip="Open settings"
          />
          <ActionButton
            leftSection={<IconPlus size={16} />}
            onClick={() => setLastAction("Add clicked")}
            variant="light"
            color="green"
            tooltip={{
              label: "Add new item",
              color: "green",
              position: "right",
              withArrow: true,
            }}
          />
        </Group>

        <Code block mt="md">
          {`// Simple string tooltip
<Action leftSection={<IconEdit />} tooltip="Edit item" />

// Advanced tooltip with options
<Action
  leftSection={<IconTrash />}
  tooltip={{
    label: "Delete item",
    color: "red",
    position: "top",
    withArrow: true,
  }}
/>`}
        </Code>
      </Paper>

      {/* Responsive Text Actions */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Responsive Text Actions
        </Title>
        <Text c="dimmed" mb="lg">
          Actions with textVisibleFrom prop show text only on specified
          breakpoints
        </Text>

        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Resize the window to see the responsive behavior
          </Text>

          <Group gap="md">
            <ActionButton
              leftSection={<IconHome size={16} />}
              textVisibleFrom="sm"
              onClick={() => setLastAction("Home (responsive)")}
              variant="filled"
            >
              Home
            </ActionButton>

            <ActionButton
              leftSection={<IconUser size={16} />}
              textVisibleFrom="md"
              onClick={() => setLastAction("Profile (responsive)")}
              variant="light"
            >
              Profile
            </ActionButton>

            <ActionButton
              leftSection={<IconSettings size={16} />}
              textVisibleFrom="lg"
              onClick={() => setLastAction("Settings (responsive)")}
              variant="outline"
            >
              Settings
            </ActionButton>
          </Group>

          <Code block>
            {`<Action
  leftSection={<IconHome />}
  textVisibleFrom="sm"
>
  Home
</Action>`}
          </Code>
        </Stack>
      </Paper>

      {/* Button Variants */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Button Variants & Colors
        </Title>
        <Text c="dimmed" mb="lg">
          All Mantine Button props are supported
        </Text>

        <Stack gap="md">
          <Group gap="md">
            <ActionButton
              variant="filled"
              onClick={() => setLastAction("Filled")}
            >
              Filled
            </ActionButton>
            <ActionButton
              variant="light"
              onClick={() => setLastAction("Light")}
            >
              Light
            </ActionButton>
            <ActionButton
              variant="outline"
              onClick={() => setLastAction("Outline")}
            >
              Outline
            </ActionButton>
            <ActionButton
              variant="subtle"
              onClick={() => setLastAction("Subtle")}
            >
              Subtle
            </ActionButton>
            <ActionButton
              variant="transparent"
              onClick={() => setLastAction("Transparent")}
            >
              Transparent
            </ActionButton>
          </Group>

          <Group gap="md">
            <ActionButton
              color="blue"
              variant="filled"
              onClick={() => setLastAction("Blue")}
            >
              Blue
            </ActionButton>
            <ActionButton
              color="green"
              variant="filled"
              onClick={() => setLastAction("Green")}
            >
              Green
            </ActionButton>
            <ActionButton
              color="red"
              variant="filled"
              onClick={() => setLastAction("Red")}
            >
              Red
            </ActionButton>
            <ActionButton
              color="yellow"
              variant="filled"
              onClick={() => setLastAction("Yellow")}
            >
              Yellow
            </ActionButton>
            <ActionButton
              color="grape"
              variant="filled"
              onClick={() => setLastAction("Grape")}
            >
              Grape
            </ActionButton>
          </Group>

          <Group gap="md">
            <ActionButton
              size="xs"
              onClick={() => setLastAction("Extra Small")}
            >
              XS
            </ActionButton>
            <ActionButton size="sm" onClick={() => setLastAction("Small")}>
              SM
            </ActionButton>
            <ActionButton size="md" onClick={() => setLastAction("Medium")}>
              MD
            </ActionButton>
            <ActionButton size="lg" onClick={() => setLastAction("Large")}>
              LG
            </ActionButton>
            <ActionButton
              size="xl"
              onClick={() => setLastAction("Extra Large")}
            >
              XL
            </ActionButton>
          </Group>

          <Code block>
            {`<Action variant="filled" color="green" size="lg">
  Action
</Action>`}
          </Code>
        </Stack>
      </Paper>

      {/* Complex Actions */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Complex Action Examples
        </Title>
        <Text c="dimmed" mb="lg">
          Combining multiple props for rich interactions
        </Text>

        <Stack gap="md">
          <ActionButton
            href="/playground"
            leftSection={<IconArrowRight size={16} />}
            variant="gradient"
            gradient={{ from: "blue", to: "cyan", deg: 90 }}
            size="lg"
            fullWidth
          >
            Go to Playground
          </ActionButton>

          <Group gap="md">
            <ActionButton
              onClick={async () => {
                setLastAction("Processing payment...");
                await new Promise((resolve) => setTimeout(resolve, 3000));
                setLastAction("Payment complete!");
              }}
              leftSection={<IconCheck size={16} />}
              variant="filled"
              color="green"
              size="lg"
              radius="xl"
            >
              Complete Payment
            </ActionButton>

            <ActionButton
              onClick={() => setLastAction("Cancelled")}
              variant="subtle"
              color="gray"
              size="lg"
            >
              Cancel
            </ActionButton>
          </Group>

          <Code block>
            {`<Action
  href="/path"
  leftSection={<Icon />}
  variant="gradient"
  gradient={{ from: "blue", to: "cyan" }}
  size="lg"
  fullWidth
>
  Complex Action
</Action>`}
          </Code>
        </Stack>
      </Paper>

      {/* Tooltip Variations */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Tooltip Variations
        </Title>
        <Text c="dimmed" mb="lg">
          Demonstrate different tooltip configurations with Action buttons
        </Text>

        <Stack gap="md">
          <Group gap="md">
            <ActionButton
              onClick={() => setLastAction("Simple tooltip")}
              tooltip="This is a simple tooltip"
            >
              Simple Tooltip
            </ActionButton>

            <ActionButton
              onClick={() => setLastAction("Colored tooltip")}
              tooltip={{
                label: "This has a custom color",
                color: "grape",
                withArrow: true,
              }}
              color="grape"
            >
              Colored Tooltip
            </ActionButton>

            <ActionButton
              onClick={() => setLastAction("Positioned tooltip")}
              tooltip={{
                label: "Tooltip on the right",
                position: "right",
                withArrow: true,
              }}
            >
              Right Position
            </ActionButton>

            <ActionButton
              onClick={() => setLastAction("Delayed tooltip")}
              tooltip={{
                label: "This tooltip has a delay",
                openDelay: 500,
                closeDelay: 100,
                withArrow: true,
              }}
            >
              Delayed Tooltip
            </ActionButton>
          </Group>

          <Group gap="md">
            <ActionButton
              onClick={() => setLastAction("Multiline tooltip")}
              tooltip={{
                label: (
                  <div>
                    <Text size="sm" fw={600}>
                      Multiline Tooltip
                    </Text>
                    <Text size="xs">This tooltip contains multiple lines</Text>
                    <Text size="xs" c="dimmed">
                      And even different text styles
                    </Text>
                  </div>
                ),
                withArrow: true,
              }}
              variant="filled"
            >
              Rich Content
            </ActionButton>

            <ActionButton
              leftSection={<IconRefresh size={16} />}
              onClick={() => setLastAction("Icon with tooltip")}
              tooltip={{
                label: "Refresh the data",
                position: "top",
                withArrow: true,
              }}
            />

            <ActionButton
              onClick={() => setLastAction("Floating tooltip")}
              tooltip={{
                label: "This tooltip floats",
                position: "top",
                offset: 15,
                withArrow: true,
              }}
              variant="outline"
            >
              Floating Offset
            </ActionButton>
          </Group>

          <Code block>
            {`// Simple string tooltip
<Action tooltip="Simple tooltip">Button</Action>

// Advanced tooltip with rich content
<Action
  tooltip={{
    label: <div>Rich HTML content</div>,
    color: "grape",
    position: "right",
    withArrow: true,
    openDelay: 500,
    width: 250,
  }}
>
  Rich Tooltip
</Action>`}
          </Code>
        </Stack>
      </Paper>

      {/* Menu Actions */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Menu Actions
        </Title>
        <Text c="dimmed" mb="lg">
          Actions can display dropdown menus with items, dividers, labels, and
          nested submenus
        </Text>

        <Stack gap="md">
          <Group gap="md">
            {/* Simple Menu */}
            <ActionButton
              rightSection={<IconChevronDown size={14} />}
              menu={{
                items: [
                  {
                    label: "Profile",
                    icon: <IconUser size={16} />,
                    onClick: () => setLastAction("Profile clicked"),
                  },
                  {
                    label: "Settings",
                    icon: <IconSettings size={16} />,
                    onClick: () => setLastAction("Settings clicked"),
                  },
                  { type: "divider" },
                  {
                    label: "Logout",
                    icon: <IconLogout size={16} />,
                    color: "red",
                    onClick: () => setLastAction("Logout clicked"),
                  },
                ],
              }}
            >
              Simple Menu
            </ActionButton>

            {/* Menu with Labels */}
            <ActionButton
              variant="light"
              rightSection={<IconChevronDown size={14} />}
              menu={{
                items: [
                  { type: "label", label: "Account" },
                  {
                    label: "Profile",
                    icon: <IconUser size={16} />,
                    onClick: () => setLastAction("Profile"),
                  },
                  {
                    label: "Settings",
                    icon: <IconSettings size={16} />,
                    onClick: () => setLastAction("Settings"),
                  },
                  { type: "divider" },
                  { type: "label", label: "Actions" },
                  {
                    label: "Share",
                    icon: <IconShare size={16} />,
                    onClick: () => setLastAction("Share"),
                  },
                  {
                    label: "Copy Link",
                    icon: <IconLink size={16} />,
                    onClick: () => setLastAction("Copy Link"),
                  },
                ],
                width: 220,
              }}
            >
              Menu with Labels
            </ActionButton>

            {/* Icon-only menu (More options) */}
            <ActionButton
              leftSection={<IconDotsVertical size={16} />}
              tooltip="More options"
              menu={{
                items: [
                  {
                    label: "View",
                    icon: <IconEye size={16} />,
                    onClick: () => setLastAction("View"),
                  },
                  {
                    label: "Edit",
                    icon: <IconEdit size={16} />,
                    onClick: () => setLastAction("Edit"),
                  },
                  {
                    label: "Copy",
                    icon: <IconCopy size={16} />,
                    onClick: () => setLastAction("Copy"),
                  },
                  { type: "divider" },
                  {
                    label: "Delete",
                    icon: <IconTrash size={16} />,
                    color: "red",
                    onClick: () => setLastAction("Delete"),
                  },
                ],
              }}
            />
          </Group>

          <Code block>
            {`<Action
  rightSection={<IconChevronDown />}
  menu={{
    items: [
      {
        label: "Profile",
        icon: <IconUser />,
        onClick: () => console.log("Profile"),
      },
      { type: "divider" },
      {
        label: "Logout",
        icon: <IconLogout />,
        color: "red",
        onClick: () => console.log("Logout"),
      },
    ],
  }}
>
  Menu Button
</Action>`}
          </Code>
        </Stack>
      </Paper>

      {/* Nested Submenu Actions */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Nested Submenu Actions
        </Title>
        <Text c="dimmed" mb="lg">
          Menus can have nested submenus for complex navigation structures
        </Text>

        <Stack gap="md">
          <Group gap="md">
            {/* File Menu with Submenus */}
            <ActionButton
              variant="filled"
              rightSection={<IconChevronDown size={14} />}
              menu={{
                items: [
                  {
                    label: "New",
                    icon: <IconPlus size={16} />,
                    children: [
                      {
                        label: "File",
                        icon: <IconFile size={16} />,
                        onClick: () => setLastAction("New File"),
                      },
                      {
                        label: "Folder",
                        icon: <IconFolder size={16} />,
                        onClick: () => setLastAction("New Folder"),
                      },
                    ],
                  },
                  {
                    label: "Open Recent",
                    icon: <IconFolder size={16} />,
                    children: [
                      {
                        label: "project-1.tsx",
                        onClick: () => setLastAction("Open project-1"),
                      },
                      {
                        label: "project-2.tsx",
                        onClick: () => setLastAction("Open project-2"),
                      },
                      { type: "divider" },
                      {
                        label: "Clear Recent",
                        onClick: () => setLastAction("Clear Recent"),
                      },
                    ],
                  },
                  { type: "divider" },
                  {
                    label: "Export",
                    icon: <IconDownload size={16} />,
                    children: [
                      {
                        label: "Export as PDF",
                        onClick: () => setLastAction("Export PDF"),
                      },
                      {
                        label: "Export as JSON",
                        onClick: () => setLastAction("Export JSON"),
                      },
                      {
                        label: "Export as CSV",
                        onClick: () => setLastAction("Export CSV"),
                      },
                    ],
                  },
                ],
                width: 200,
              }}
            >
              File Menu
            </ActionButton>

            {/* Share Menu with Nested Options */}
            <ActionButton
              variant="light"
              color="blue"
              leftSection={<IconShare size={16} />}
              menu={{
                items: [
                  {
                    label: "Share via",
                    icon: <IconShare size={16} />,
                    children: [
                      {
                        label: "Email",
                        icon: <IconMail size={16} />,
                        onClick: () => setLastAction("Share Email"),
                      },
                      {
                        label: "Link",
                        icon: <IconLink size={16} />,
                        onClick: () => setLastAction("Share Link"),
                      },
                    ],
                  },
                  {
                    label: "Permissions",
                    icon: <IconUsers size={16} />,
                    children: [
                      {
                        label: "Public",
                        onClick: () => setLastAction("Set Public"),
                      },
                      {
                        label: "Private",
                        onClick: () => setLastAction("Set Private"),
                      },
                      {
                        label: "Team Only",
                        onClick: () => setLastAction("Set Team Only"),
                      },
                    ],
                  },
                  { type: "divider" },
                  {
                    label: "Copy Link",
                    icon: <IconCopy size={16} />,
                    onClick: () => setLastAction("Copy Link"),
                  },
                ],
                position: "bottom-end",
              }}
            >
              Share
            </ActionButton>
          </Group>

          <Code block>
            {`<Action
  menu={{
    items: [
      {
        label: "New",
        icon: <IconPlus />,
        children: [
          {
            label: "File",
            icon: <IconFile />,
            onClick: () => console.log("New File"),
          },
          {
            label: "Folder",
            icon: <IconFolder />,
            onClick: () => console.log("New Folder"),
          },
        ],
      },
      {
        label: "Export",
        icon: <IconDownload />,
        children: [
          { label: "PDF", onClick: () => {} },
          { label: "JSON", onClick: () => {} },
        ],
      },
    ],
  }}
>
  File Menu
</Action>`}
          </Code>
        </Stack>
      </Paper>

      {/* Disabled and Loading States */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Disabled and Loading States
        </Title>
        <Text c="dimmed" mb="lg">
          Actions can be disabled or show loading state. Tooltips still work on
          disabled buttons.
        </Text>

        <Group gap="md">
          <ActionButton
            disabled
            onClick={() => {}}
            tooltip="This button is disabled"
          >
            Disabled
          </ActionButton>
          <ActionButton
            loading
            onClick={() => {}}
            tooltip="Currently loading..."
          >
            Loading
          </ActionButton>
          <ActionButton
            disabled
            leftSection={<IconEdit size={16} />}
            onClick={() => {}}
            tooltip="Edit is currently disabled"
          />
        </Group>

        <Code block mt="md">
          {`<Action disabled tooltip="This button is disabled">
  Disabled
</Action>
<Action loading tooltip="Currently loading...">
  Loading
</Action>`}
        </Code>
      </Paper>
    </Stack>
  );
};

export default ExampleAction;
