import { Avatar, Burger, Divider, Flex, Group, Text } from "@mantine/core";
import {
  IconChevronDown,
  IconCoin,
  IconHelp,
  IconLogout,
  IconPackage,
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
        </Group>

        <Divider orientation="vertical" mx="sm" />
      </Group>

      {/* Right Section */}
      <Group gap="xl" align={"center"} justify={"center"}>
        {/* Notifications */}

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
          <Group gap="xs" flex={1} justify={"space-between"}>
            <Avatar src={user.avatar} size="sm" radius="xl" />
            <Flex direction={"column"} align={"start"}>
              <Text size="sm" fw={500}>
                {user.name}
              </Text>
              <Text mt={-4} size="xs" c="dimmed">
                {user.role}
              </Text>
            </Flex>
            <IconChevronDown size={14} className="hidden-mobile" />
          </Group>
        </Action>

        {/* Dark Mode Toggle */}
        <DarkModeButton mode="segmented" />
      </Group>
    </Flex>
  );
};

export default Header;
