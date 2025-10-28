import {
  Avatar,
  Badge,
  Burger,
  Divider,
  Flex,
  Group,
  Indicator,
  Input,
  Menu,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBell,
  IconChevronDown,
  IconCoin,
  IconHelp,
  IconLogout,
  IconMessage,
  IconPackage,
  IconSearch,
  IconSettings,
  IconUser,
} from "@tabler/icons-react";
import { useState } from "react";
import { Action, DarkModeButton } from "../../src";

interface HeaderProps {
  opened: boolean;
  toggle: () => void;
}

const Header = ({ opened, toggle }: HeaderProps) => {
  const [searchValue, setSearchValue] = useState("");

  // Fake user data
  const user = {
    name: "John Doe",
    email: "john.doe@company.com",
    avatar:
      "https://raw.githubusercontent.com/mantinedev/mantine/master/.demo/avatars/avatar-1.png",
    role: "Admin",
    credits: 2450,
  };

  // Fake notification data
  const notifications = [
    {
      id: 1,
      title: "New message from Sarah",
      message: "Hey, can you review my latest PR?",
      time: "2 minutes ago",
      read: false,
      type: "message",
    },
    {
      id: 2,
      title: "Deployment successful",
      message: "Your application has been deployed to production",
      time: "1 hour ago",
      read: false,
      type: "success",
    },
    {
      id: 3,
      title: "Weekly report ready",
      message: "Your weekly analytics report is now available",
      time: "3 hours ago",
      read: true,
      type: "info",
    },
  ];

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <Flex h="100%" align="center" px="md" justify="space-between">
      {/* Left Section */}
      <Group>
        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />

        {/* Logo and Brand */}
        <Group gap="xs" w={256}>
          <IconPackage size={28} stroke={2} style={{ color: "#228be6" }} />
          <Text size="xl" fw={700}>
            Alepha UI
          </Text>
          <Badge variant="light" size="sm">
            v2.4.0
          </Badge>
        </Group>

        <Divider orientation="vertical" mx="sm" />

        {/* Search */}
        <Input
          placeholder="Search anything..."
          leftSection={<IconSearch size={16} />}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          w={300}
          visibleFrom="md"
        />
      </Group>

      {/* Right Section */}
      <Group gap="xl" align={"center"} justify={"center"}>
        {/* Notifications */}
        <Menu shadow="md" width={320} position="bottom-end">
          <Menu.Target>
            <UnstyledButton>
              <Indicator
                inline
                label={unreadCount}
                size={16}
                disabled={unreadCount === 0}
              >
                <IconBell size={20} stroke={1.5} />
              </Indicator>
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>
              <Flex justify="space-between" align="center">
                <Text>Notifications</Text>
                {unreadCount > 0 && (
                  <Badge size="sm" variant="filled">
                    {unreadCount} new
                  </Badge>
                )}
              </Flex>
            </Menu.Label>

            {notifications.map((notification) => (
              <Menu.Item
                key={notification.id}
                leftSection={
                  notification.type === "message" ? (
                    <IconMessage size={16} />
                  ) : (
                    <IconBell size={16} />
                  )
                }
              >
                <Text size="sm" fw={!notification.read ? 600 : 400}>
                  {notification.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {notification.message}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  {notification.time}
                </Text>
              </Menu.Item>
            ))}

            <Menu.Divider />
            <Menu.Item>
              <Text size="sm" ta="center" c="blue">
                View all notifications
              </Text>
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        {/* Messages */}
        <Menu shadow="md" width={280} position="bottom-end">
          <Menu.Target>
            <UnstyledButton>
              <Indicator inline label="3" size={16} color="red">
                <IconMessage size={20} stroke={1.5} />
              </Indicator>
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>Messages</Menu.Label>
            <Menu.Item
              leftSection={
                <Avatar
                  size="sm"
                  src="https://raw.githubusercontent.com/mantinedev/mantine/master/.demo/avatars/avatar-2.png"
                />
              }
            >
              <Text size="sm" fw={600}>
                Sarah Chen
              </Text>
              <Text size="xs" c="dimmed">
                Can you review my PR?
              </Text>
            </Menu.Item>
            <Menu.Item
              leftSection={
                <Avatar
                  size="sm"
                  src="https://raw.githubusercontent.com/mantinedev/mantine/master/.demo/avatars/avatar-3.png"
                />
              }
            >
              <Text size="sm" fw={600}>
                Mike Johnson
              </Text>
              <Text size="xs" c="dimmed">
                Meeting at 3pm today
              </Text>
            </Menu.Item>
            <Menu.Item
              leftSection={
                <Avatar
                  size="sm"
                  src="https://raw.githubusercontent.com/mantinedev/mantine/master/.demo/avatars/avatar-4.png"
                />
              }
            >
              <Text size="sm" fw={600}>
                Emma Wilson
              </Text>
              <Text size="xs" c="dimmed">
                Deployment completed!
              </Text>
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item>
              <Text size="sm" ta="center" c="blue">
                View all messages
              </Text>
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        <Divider orientation="vertical" />

        {/* User Menu with Action */}
        <Action
          variant="subtle"
          menu={{
            items: [
              { type: "label", label: "Account" },
              {
                label: "Profile",
                icon: <IconUser size={16} />,
                onClick: () => console.log("Profile clicked"),
              },
              {
                label: "Settings",
                icon: <IconSettings size={16} />,
                onClick: () => console.log("Settings clicked"),
              },
              {
                label: "Billing",
                icon: <IconCoin size={16} />,
                children: [
                  {
                    label: "View Credits",
                    onClick: () => console.log("View Credits"),
                  },
                  {
                    label: "Purchase More",
                    onClick: () => console.log("Purchase More"),
                  },
                  { type: "divider" },
                  {
                    label: "Billing History",
                    onClick: () => console.log("Billing History"),
                  },
                ],
              },
              {
                label: "Help & Support",
                icon: <IconHelp size={16} />,
                children: [
                  {
                    label: "Documentation",
                    onClick: () => console.log("Documentation"),
                  },
                  {
                    label: "Contact Support",
                    onClick: () => console.log("Contact Support"),
                  },
                  {
                    label: "Feature Request",
                    onClick: () => console.log("Feature Request"),
                  },
                ],
              },
              { type: "divider" },
              { type: "label", label: "Danger zone" },
              {
                label: "Sign out",
                icon: <IconLogout size={16} />,
                color: "red",
                onClick: () => console.log("Sign out clicked"),
              },
            ],
            width: 220,
            position: "bottom-end",
          }}
        >
          <Group gap="xs">
            <Avatar src={user.avatar} size="sm" radius="xl" />
            <div style={{ flex: 1 }} className="hidden-mobile">
              <Text size="sm" fw={500}>
                {user.name}
              </Text>
              <Text size="xs" c="dimmed">
                {user.role}
              </Text>
            </div>
            <IconChevronDown size={14} className="hidden-mobile" />
          </Group>
        </Action>

        <Divider orientation="vertical" />

        {/* Dark Mode Toggle */}
        <DarkModeButton mode="segmented" />
      </Group>
    </Flex>
  );
};

export default Header;
