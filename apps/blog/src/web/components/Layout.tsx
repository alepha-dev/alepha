import {
  ActionButton,
  AlephaMantineProvider,
  alephaSidebarAtom,
  Breadcrumb,
  DarkModeButton,
  DashboardShell,
  type SidebarNode,
  ThemeButton,
  ToggleSidebarButton,
} from "@alepha/ui";
import {
  Anchor,
  Badge,
  Box,
  Button,
  createTheme,
  Flex,
  Group,
  Menu,
  Text,
} from "@mantine/core";
import {
  IconArticle,
  IconBrandWordpress,
  IconFile,
  IconHelp,
  IconHome,
  IconMessage,
  IconPalette,
  IconPhoto,
  IconPlus,
  IconSettings,
  IconShield,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useStore } from "alepha/react";
import { Link, NestedView } from "alepha/react/router";

const blogTheme = createTheme({
  primaryColor: "orange",
  colors: {
    orange: [
      "#fff4e6",
      "#ffe8cc",
      "#ffd8a8",
      "#ffc078",
      "#ffa94d",
      "#ff922b",
      "#f6821f",
      "#e8590c",
      "#d9480f",
      "#c92a2a",
    ],
  },
  fontFamily:
    '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  defaultRadius: "md",
  headings: {
    fontWeight: "600",
  },
  components: {
    Button: {
      defaultProps: {
        fw: 400,
      },
    },
  },
});

const sidebarItems: SidebarNode[] = [
  { type: "search", position: "top" },
  { label: "Dashboard", icon: IconHome, href: "/" },
  {
    type: "section",
    label: "Content",
    children: [
      {
        label: "Posts",
        icon: IconArticle,
        children: [
          { label: "All Posts", href: "/posts" },
          { label: "Add New", href: "/posts/new" },
        ],
      },
      { label: "Media", icon: IconPhoto, href: "/media" },
      { label: "Pages", icon: IconFile, href: "/pages" },
      {
        label: "Comments",
        icon: IconMessage,
        href: "/comments",
        rightSection: <Badge variant={"outline"}>NEW</Badge>,
      },
    ],
  },
  {
    type: "section",
    label: "Design",
    children: [
      {
        label: "Appearance",
        icon: IconPalette,
        children: [{ label: "Themes", href: "/themes" }],
      },
    ],
  },
  {
    type: "section",
    label: "Users",
    children: [
      {
        label: "People",
        icon: IconUsers,
        children: [
          { label: "All Users", href: "/users" },
          { label: "Roles", href: "/users/roles" },
        ],
      },
      {
        label: "Security",
        icon: IconShield,
        children: [
          { label: "Sessions", href: "/users/sessions" },
          { label: "Login & Identity", href: "/users/identity" },
        ],
      },
    ],
  },
  {
    type: "section",
    label: "Manage",
    children: [
      {
        label: "Settings",
        icon: IconSettings,
        children: [{ label: "General", href: "/settings" }],
      },
    ],
  },
];

function NavbarLogo() {
  const [sidebar] = useStore(alephaSidebarAtom);
  return (
    <Group
      h={48}
      px="md"
      gap="xs"
      justify={sidebar.collapsed ? "center" : undefined}
      style={{
        borderBottom: "1px solid var(--mantine-color-default-border)",
        flexShrink: 0,
      }}
    >
      <IconBrandWordpress size={28} color="#f6821f" />
      {!sidebar.collapsed && (
        <Text fw={600} size="sm">
          Alepha Blog
        </Text>
      )}
    </Group>
  );
}

function Shell() {
  return (
    <DashboardShell
      layout="alt"
      footerHeight={50}
      headerHeight={48}
      sidebarProps={{ items: sidebarItems }}
      sidebarResizable
      navbarHeader={<NavbarLogo />}
      navbarFooter={
        <Flex flex={1} px={"sm"} align={"center"}>
          <ToggleSidebarButton
            mx={8}
            size={"lg"}
            px={4}
            h={32}
            variant={"outline"}
          />
        </Flex>
      }
      header={
        <Group h="100%" px="md" justify="space-between">
          <Breadcrumb home="Dashboard" />
          <Group gap="sm">
            <Menu shadow="md" width={240} position="bottom-end">
              <Menu.Target>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                >
                  New
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconArticle size={16} />}
                  component={Link}
                  href="/posts/new"
                >
                  New Post
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconFile size={16} />}
                  component={Link}
                  href="/pages"
                >
                  New Page
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconPhoto size={16} />}
                  component={Link}
                  href="/media"
                >
                  Upload Media
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<IconHelp size={14} />}
            >
              Support
            </Button>
            <ThemeButton size="sm" />
            <DarkModeButton size="sm" />
            <ActionButton
              variant="subtle"
              color="gray"
              size="sm"
              icon={IconUser}
            />
          </Group>
        </Group>
      }
      appShellMainProps={{
        style: { display: "flex", flexDirection: "column", minHeight: "100vh" },
      }}
      footer={
        <Group h="100%" px="md" justify="center" gap="xs">
          <Anchor size="xs" c="dimmed">
            Support
          </Anchor>
          <Text size="xs" c="dimmed">
            |
          </Text>
          <Anchor size="xs" c="dimmed">
            System Status
          </Anchor>
          <Text size="xs" c="dimmed">
            |
          </Text>
          <Anchor size="xs" c="dimmed">
            Documentation
          </Anchor>
          <Text size="xs" c="dimmed">
            |
          </Text>
          <Anchor size="xs" c="dimmed">
            Terms of Use
          </Anchor>
          <Text size="xs" c="dimmed">
            |
          </Text>
          <Anchor size="xs" c="dimmed">
            Privacy Policy
          </Anchor>
          <Text size="xs" c="dimmed">
            |
          </Text>
          <Anchor size="xs" c="dimmed">
            Cookie Preferences
          </Anchor>
          <Text size="xs" c="dimmed" ml="xs">
            &copy; 2026 Alepha Blog
          </Text>
        </Group>
      }
    >
      <Box p="lg" style={{ flex: 1 }}>
        <NestedView />
      </Box>
    </DashboardShell>
  );
}

const Layout = () => {
  return (
    <AlephaMantineProvider
      mantine={{ theme: blogTheme, defaultColorScheme: "light" }}
      notifications={{ position: "top-right" }}
    >
      <Shell />
    </AlephaMantineProvider>
  );
};

export default Layout;
