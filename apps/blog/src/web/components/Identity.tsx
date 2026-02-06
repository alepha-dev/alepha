import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconBrandWindows,
  IconCopy,
  IconDeviceFloppy,
  IconKey,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";

const auditLogData = [
  {
    event: "Successful login",
    user: "admin@alepha.blog",
    ip: "192.168.1.42",
    date: "2026-02-05 09:15:23",
  },
  {
    event: "Failed login attempt",
    user: "editor@alepha.blog",
    ip: "10.0.0.87",
    date: "2026-02-05 08:42:11",
  },
  {
    event: "Password change",
    user: "admin@alepha.blog",
    ip: "192.168.1.42",
    date: "2026-02-04 17:33:05",
  },
  {
    event: "2FA enabled",
    user: "sarah.jones@alepha.blog",
    ip: "172.16.0.15",
    date: "2026-02-04 14:20:48",
  },
  {
    event: "Session revoked",
    user: "admin@alepha.blog",
    ip: "192.168.1.42",
    date: "2026-02-03 11:05:32",
  },
  {
    event: "Role changed",
    user: "mark.wilson@alepha.blog",
    ip: "192.168.1.42",
    date: "2026-02-03 10:58:17",
  },
];

const ssoProviders = [
  { name: "Google", icon: IconBrandGoogle, enabled: true },
  { name: "GitHub", icon: IconBrandGithub, enabled: true },
  { name: "Microsoft", icon: IconBrandWindows, enabled: false },
  { name: "SAML", icon: IconKey, enabled: false },
];

const apiKeys = [
  {
    name: "Production API Key",
    value: "ak_live_••••••••••••7f3d",
    created: "2026-01-10",
  },
  {
    name: "Staging API Key",
    value: "ak_test_••••••••••••b2a1",
    created: "2026-01-22",
  },
];

const Identity = () => {
  const [activeSection, setActiveSection] = useState("authentication");

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Login & Identity
        </Title>
        <Button
          color="orange"
          size="sm"
          leftSection={<IconDeviceFloppy size={14} />}
          onClick={() =>
            notifications.show({
              title: "Settings Saved",
              message:
                "Your login and identity settings have been saved successfully.",
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
          { value: "authentication", label: "Authentication" },
          { value: "security", label: "Security" },
          { value: "providers", label: "Providers" },
          { value: "audit", label: "Audit Log" },
        ]}
      />

      {activeSection === "authentication" && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Login Settings
            </Text>
            <Stack gap="sm">
              <Switch
                label="Allow user registration"
                defaultChecked
                size="sm"
              />
              <Select
                label="Default role"
                defaultValue="subscriber"
                data={[
                  { value: "subscriber", label: "Subscriber" },
                  { value: "contributor", label: "Contributor" },
                  { value: "author", label: "Author" },
                  { value: "editor", label: "Editor" },
                  { value: "administrator", label: "Administrator" },
                ]}
                size="sm"
              />
              <TextInput
                label="Login page URL"
                defaultValue="/wp-login"
                size="sm"
              />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Password Policy
            </Text>
            <Stack gap="sm">
              <Select
                label="Minimum password length"
                defaultValue="12"
                data={[
                  { value: "8", label: "8 characters" },
                  { value: "10", label: "10 characters" },
                  { value: "12", label: "12 characters" },
                  { value: "16", label: "16 characters" },
                ]}
                size="sm"
              />
              <Switch
                label="Require uppercase letters"
                defaultChecked
                size="sm"
              />
              <Switch label="Require numbers" defaultChecked size="sm" />
              <Switch
                label="Require special characters"
                defaultChecked
                size="sm"
              />
              <Switch
                label="Force password change every 90 days"
                defaultChecked={false}
                size="sm"
              />
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {activeSection === "security" && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Two-Factor Authentication
            </Text>
            <Stack gap="sm">
              <Switch
                label="Enable two-factor authentication"
                defaultChecked
                size="sm"
              />
              <Switch
                label="Require 2FA for all users"
                defaultChecked={false}
                size="sm"
              />
              <Select
                label="Allowed methods"
                defaultValue="totp"
                data={[
                  { value: "totp", label: "App-based TOTP" },
                  { value: "sms", label: "SMS" },
                  { value: "email", label: "Email" },
                ]}
                size="sm"
              />
              <Switch label="Allow backup codes" defaultChecked size="sm" />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Session Settings
            </Text>
            <Stack gap="sm">
              <NumberInput
                label="Session timeout (minutes)"
                defaultValue={30}
                min={5}
                max={1440}
                size="sm"
              />
              <NumberInput
                label="Max concurrent sessions"
                defaultValue={3}
                min={1}
                max={10}
                size="sm"
              />
              <Switch
                label="Terminate sessions on password change"
                defaultChecked
                size="sm"
              />
              <Switch label="Remember me enabled" defaultChecked size="sm" />
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              Login Protection
            </Text>
            <Stack gap="sm">
              <NumberInput
                label="Max failed login attempts"
                defaultValue={5}
                min={1}
                max={20}
                size="sm"
              />
              <NumberInput
                label="Lockout duration (minutes)"
                defaultValue={15}
                min={1}
                max={1440}
                size="sm"
              />
              <Switch label="Enable CAPTCHA" defaultChecked size="sm" />
              <Switch label="Block suspicious IPs" defaultChecked size="sm" />
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {activeSection === "providers" && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Card withBorder radius="md" p="md">
            <Text fw={600} size="sm" mb="md">
              SSO Providers
            </Text>
            <Stack gap="sm">
              {ssoProviders.map((provider) => (
                <Group key={provider.name} justify="space-between">
                  <Group gap="sm">
                    <provider.icon size={20} />
                    <Text size="sm">{provider.name}</Text>
                  </Group>
                  <Group gap="sm">
                    <Switch defaultChecked={provider.enabled} size="sm" />
                    <Button variant="light" size="xs">
                      Configure
                    </Button>
                  </Group>
                </Group>
              ))}
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Group justify="space-between" mb="md">
              <Text fw={600} size="sm">
                API Keys
              </Text>
              <Badge variant="light" color="orange" size="xs">
                {apiKeys.length} active
              </Badge>
            </Group>
            <Stack gap="sm">
              {apiKeys.map((key) => (
                <Box key={key.name}>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={500}>
                      {key.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Created {key.created}
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <Code style={{ flex: 1 }}>{key.value}</Code>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      onClick={() =>
                        notifications.show({
                          title: "Copied",
                          message: "API key copied to clipboard.",
                          color: "teal",
                        })
                      }
                    >
                      <IconCopy size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={() =>
                        notifications.show({
                          title: "Key Revoked",
                          message: `${key.name} has been revoked.`,
                          color: "red",
                        })
                      }
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                  <Divider my="sm" />
                </Box>
              ))}
              <Button variant="light" color="orange" size="xs" fullWidth>
                Generate New API Key
              </Button>
            </Stack>
          </Card>
        </SimpleGrid>
      )}

      {activeSection === "audit" && (
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" mb="md">
            <Text fw={600} size="sm">
              Audit Log
            </Text>
            <Text size="xs" c="dimmed">
              Showing last 6 events
            </Text>
          </Group>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Event</Table.Th>
                <Table.Th>User</Table.Th>
                <Table.Th>IP</Table.Th>
                <Table.Th>Date</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {auditLogData.map((entry, index) => (
                <Table.Tr key={index}>
                  <Table.Td>
                    <Badge
                      variant="light"
                      size="sm"
                      color={
                        entry.event === "Failed login attempt"
                          ? "red"
                          : entry.event === "Session revoked"
                            ? "orange"
                            : entry.event === "Role changed"
                              ? "blue"
                              : "teal"
                      }
                    >
                      {entry.event}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.user}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Code>{entry.ip}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {entry.date}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Box>
  );
};

export default Identity;
