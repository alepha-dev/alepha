import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  Pagination,
  SegmentedControl,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconDotsVertical,
  IconEye,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";

interface Session {
  id: number;
  user: string;
  avatar: string;
  browser: string;
  device: "Desktop" | "Mobile" | "Tablet";
  ip: string;
  location: string;
  started: string;
  lastActive: string;
  status: "active" | "expired";
}

const sessions: Session[] = [
  {
    id: 1,
    user: "Nicolas F.",
    avatar: "NF",
    browser: "Chrome 121",
    device: "Desktop",
    ip: "92.184.112.47",
    location: "Paris, France",
    started: "Feb 5, 2026",
    lastActive: "2 minutes ago",
    status: "active",
  },
  {
    id: 2,
    user: "Marie L.",
    avatar: "ML",
    browser: "Firefox 124",
    device: "Desktop",
    ip: "86.247.93.18",
    location: "Lyon, France",
    started: "Feb 5, 2026",
    lastActive: "15 minutes ago",
    status: "active",
  },
  {
    id: 3,
    user: "Alex K.",
    avatar: "AK",
    browser: "Safari 18",
    device: "Mobile",
    ip: "51.15.42.189",
    location: "London, United Kingdom",
    started: "Feb 4, 2026",
    lastActive: "1 hour ago",
    status: "active",
  },
  {
    id: 4,
    user: "Sarah M.",
    avatar: "SM",
    browser: "Chrome 121",
    device: "Tablet",
    ip: "198.51.100.23",
    location: "New York, United States",
    started: "Feb 4, 2026",
    lastActive: "3 hours ago",
    status: "active",
  },
  {
    id: 5,
    user: "Nicolas F.",
    avatar: "NF",
    browser: "Safari 18",
    device: "Mobile",
    ip: "92.184.112.52",
    location: "Paris, France",
    started: "Feb 3, 2026",
    lastActive: "6 hours ago",
    status: "active",
  },
  {
    id: 6,
    user: "Takeshi O.",
    avatar: "TO",
    browser: "Chrome 121",
    device: "Desktop",
    ip: "203.0.113.77",
    location: "Tokyo, Japan",
    started: "Feb 3, 2026",
    lastActive: "8 hours ago",
    status: "active",
  },
  {
    id: 7,
    user: "Marie L.",
    avatar: "ML",
    browser: "Chrome 121",
    device: "Mobile",
    ip: "86.247.93.22",
    location: "Lyon, France",
    started: "Feb 2, 2026",
    lastActive: "1 day ago",
    status: "expired",
  },
  {
    id: 8,
    user: "Alex K.",
    avatar: "AK",
    browser: "Firefox 124",
    device: "Desktop",
    ip: "51.15.42.201",
    location: "London, United Kingdom",
    started: "Feb 1, 2026",
    lastActive: "2 days ago",
    status: "expired",
  },
  {
    id: 9,
    user: "Nicolas F.",
    avatar: "NF",
    browser: "Chrome 120",
    device: "Desktop",
    ip: "92.184.112.47",
    location: "Paris, France",
    started: "Jan 30, 2026",
    lastActive: "4 days ago",
    status: "expired",
  },
  {
    id: 10,
    user: "Sarah M.",
    avatar: "SM",
    browser: "Safari 17",
    device: "Desktop",
    ip: "198.51.100.45",
    location: "New York, United States",
    started: "Jan 28, 2026",
    lastActive: "6 days ago",
    status: "expired",
  },
  {
    id: 11,
    user: "Takeshi O.",
    avatar: "TO",
    browser: "Firefox 123",
    device: "Tablet",
    ip: "203.0.113.89",
    location: "Tokyo, Japan",
    started: "Jan 26, 2026",
    lastActive: "1 week ago",
    status: "expired",
  },
  {
    id: 12,
    user: "Alex K.",
    avatar: "AK",
    browser: "Chrome 119",
    device: "Mobile",
    ip: "51.15.42.210",
    location: "London, United Kingdom",
    started: "Jan 22, 2026",
    lastActive: "2 weeks ago",
    status: "expired",
  },
];

const deviceIcon: Record<string, typeof IconDeviceDesktop> = {
  Desktop: IconDeviceDesktop,
  Mobile: IconDeviceMobile,
  Tablet: IconDeviceTablet,
};

const Sessions = () => {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const activeSessions = sessions.filter((s) => s.status === "active");
  const expiredSessions = sessions.filter((s) => s.status === "expired");

  const filtered = sessions
    .filter((s) => {
      if (filter === "active") return s.status === "active";
      if (filter === "expired") return s.status === "expired";
      return true;
    })
    .filter((s) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.user.toLowerCase().includes(q) ||
        s.browser.toLowerCase().includes(q) ||
        s.ip.includes(q) ||
        s.location.toLowerCase().includes(q)
      );
    });

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Active Sessions
        </Title>
        <Button
          color="red"
          size="sm"
          leftSection={<IconTrash size={14} />}
          onClick={() =>
            modals.openConfirmModal({
              title: "Revoke all sessions",
              children: (
                <Text size="sm">
                  Are you sure you want to revoke all active sessions? All users
                  will be logged out immediately. This action cannot be undone.
                </Text>
              ),
              labels: { confirm: "Revoke All", cancel: "Cancel" },
              confirmProps: { color: "red" },
              onConfirm: () =>
                notifications.show({
                  title: "Sessions Revoked",
                  message: `All ${activeSessions.length} active sessions have been revoked.`,
                  color: "red",
                }),
            })
          }
        >
          Revoke All
        </Button>
      </Group>

      {/* Filters bar */}
      <Group justify="space-between" mb="md">
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={setFilter}
          data={[
            { value: "all", label: `All (${sessions.length})` },
            {
              value: "active",
              label: `Active (${activeSessions.length})`,
            },
            {
              value: "expired",
              label: `Expired (${expiredSessions.length})`,
            },
          ]}
        />
        <TextInput
          placeholder="Search sessions..."
          leftSection={<IconSearch size={14} />}
          size="xs"
          w={260}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </Group>

      {/* Sessions table */}
      <Box
        style={{
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Table
          highlightOnHover
          styles={{
            th: {
              fontSize: 12,
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              borderBottom: "1px solid var(--mantine-color-default-border)",
              padding: "10px 16px",
            },
            td: {
              padding: "10px 16px",
              borderBottom: "1px solid var(--mantine-color-default-border)",
            },
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>User</Table.Th>
              <Table.Th>Device / Browser</Table.Th>
              <Table.Th>IP Address</Table.Th>
              <Table.Th>Location</Table.Th>
              <Table.Th>Started</Table.Th>
              <Table.Th>Last Active</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((session) => {
              const DeviceIcon = deviceIcon[session.device];
              return (
                <Table.Tr key={session.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <Avatar size="sm" radius="xl" color="blue">
                        {session.avatar}
                      </Avatar>
                      <Text size="sm" fw={500}>
                        {session.user}
                      </Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <DeviceIcon size={16} color="#6b7280" />
                      <Box>
                        <Text size="sm">{session.browser}</Text>
                        <Text size="xs" c="dimmed">
                          {session.device}
                        </Text>
                      </Box>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {session.ip}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{session.location}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {session.started}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {session.lastActive}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={session.status === "active" ? "teal" : "gray"}
                      size="sm"
                      leftSection={
                        <Box
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            backgroundColor:
                              session.status === "active"
                                ? "#10b981"
                                : "#9ca3af",
                          }}
                        />
                      }
                    >
                      {session.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Menu shadow="md" width={180} position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" size="sm">
                          <IconDotsVertical size={14} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconEye size={14} />}
                          onClick={() => {
                            notifications.show({
                              title: "Session Details",
                              message: `${session.user} - ${session.browser} on ${session.device} from ${session.location}`,
                              color: "blue",
                            });
                          }}
                        >
                          View Details
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          leftSection={<IconTrash size={14} />}
                          color="red"
                          onClick={() =>
                            modals.openConfirmModal({
                              title: "Revoke session",
                              children: (
                                <Text size="sm">
                                  Are you sure you want to revoke the session
                                  for {session.user} ({session.browser} on{" "}
                                  {session.device})? The user will be logged out
                                  immediately.
                                </Text>
                              ),
                              labels: { confirm: "Revoke", cancel: "Cancel" },
                              confirmProps: { color: "red" },
                              onConfirm: () =>
                                notifications.show({
                                  title: "Session Revoked",
                                  message: `Session for ${session.user} has been revoked.`,
                                  color: "red",
                                }),
                            })
                          }
                        >
                          Revoke Session
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Box>

      <Group justify="space-between" mt="md">
        <Text size="xs" c="dimmed">
          Showing {filtered.length} of {sessions.length} sessions
        </Text>
        <Pagination total={2} size="xs" />
      </Group>
    </Box>
  );
};

export default Sessions;
