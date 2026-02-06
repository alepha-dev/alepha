import { ActionButton } from "@alepha/ui";
import {
  Avatar,
  Badge,
  Box,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import type { AppRouter } from "../AppRouter.ts";

type Role = "Admin" | "Editor" | "Author" | "Contributor" | "Subscriber";

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string;
  role: Role;
  status: string;
  joinDate: string;
}

const users: User[] = [
  {
    id: 1,
    name: "Nicolas Fournier",
    email: "nicolas@alepha.dev",
    avatar: "NF",
    role: "Admin",
    status: "active",
    joinDate: "Jan 2024",
  },
  {
    id: 2,
    name: "Marie Laurent",
    email: "marie@alepha.dev",
    avatar: "ML",
    role: "Editor",
    status: "active",
    joinDate: "Mar 2024",
  },
  {
    id: 3,
    name: "Alex Kowalski",
    email: "alex.k@example.com",
    avatar: "AK",
    role: "Author",
    status: "active",
    joinDate: "Jun 2024",
  },
  {
    id: 4,
    name: "Sarah Mitchell",
    email: "sarah.m@example.com",
    avatar: "SM",
    role: "Author",
    status: "active",
    joinDate: "Jul 2024",
  },
  {
    id: 5,
    name: "James Chen",
    email: "james.chen@example.com",
    avatar: "JC",
    role: "Contributor",
    status: "inactive",
    joinDate: "Sep 2024",
  },
  {
    id: 6,
    name: "Emily Rodriguez",
    email: "emily.r@example.com",
    avatar: "ER",
    role: "Editor",
    status: "active",
    joinDate: "Oct 2024",
  },
  {
    id: 7,
    name: "David Park",
    email: "david.park@example.com",
    avatar: "DP",
    role: "Subscriber",
    status: "inactive",
    joinDate: "Nov 2024",
  },
  {
    id: 8,
    name: "Lisa Thompson",
    email: "lisa.t@example.com",
    avatar: "LT",
    role: "Contributor",
    status: "suspended",
    joinDate: "Dec 2024",
  },
  {
    id: 9,
    name: "Marcus Webb",
    email: "marcus.w@example.com",
    avatar: "MW",
    role: "Author",
    status: "active",
    joinDate: "Jan 2025",
  },
  {
    id: 10,
    name: "Priya Sharma",
    email: "priya.s@example.com",
    avatar: "PS",
    role: "Subscriber",
    status: "suspended",
    joinDate: "Feb 2025",
  },
];

const roleColor: Record<Role, string> = {
  Admin: "violet",
  Editor: "blue",
  Author: "cyan",
  Contributor: "orange",
  Subscriber: "gray",
};

const UserProfile = () => {
  const router = useRouter<AppRouter>();
  const state = useRouterState();
  const userId = state.params.userId as string;
  const user = users.find((u) => u.id === Number(userId));

  if (!user) {
    return (
      <Stack align="center" justify="center" flex={1} gap="xs">
        <Text c="dimmed" size="lg">
          User not found
        </Text>
      </Stack>
    );
  }

  const currentPath = state.url.pathname;
  const getActiveTab = () => {
    if (currentPath.endsWith("/posts")) return "posts";
    if (currentPath.endsWith("/activity")) return "activity";
    return "overview";
  };

  const handleTabChange = (value: string) => {
    const base = `/users/${userId}`;
    const href = value === "overview" ? base : `${base}/${value}`;
    router.push(href);
  };

  return (
    <Stack gap="lg">
      <Group gap="lg">
        <ActionButton
          variant="subtle"
          color="gray"
          icon={IconArrowLeft}
          href="/users"
        />
        <Avatar size="lg" radius="xl" color={roleColor[user.role]}>
          {user.avatar}
        </Avatar>
        <div>
          <Group gap="sm" align="center">
            <Title order={3} fw={600}>
              {user.name}
            </Title>
            <Badge variant="light" color={roleColor[user.role]} size="sm">
              {user.role}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {user.email}
          </Text>
        </div>
      </Group>

      <Box>
        <SegmentedControl
          value={getActiveTab()}
          onChange={handleTabChange}
          data={[
            { value: "overview", label: "Overview" },
            { value: "posts", label: "Posts" },
            { value: "activity", label: "Activity" },
          ]}
        />
      </Box>

      <NestedView />
    </Stack>
  );
};

export default UserProfile;
