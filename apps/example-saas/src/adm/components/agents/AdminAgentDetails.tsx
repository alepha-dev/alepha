import { useAction, useClient, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Stack,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBriefcase,
  IconCalendar,
  IconCheck,
  IconClock,
  IconKey,
  IconMail,
  IconPhone,
  IconPlayerPause,
  IconPlayerPlay,
  IconWorld,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { AgentController } from "../../../api/agents/controllers/AgentController.ts";
import type { AgentProfile } from "../../../api/agents/entities/agentProfiles.ts";

const statusColors: Record<string, string> = {
  active: "green",
  inactive: "gray",
  suspended: "red",
};

const AdminAgentDetails = () => {
  const state = useRouterState();
  const client = useClient<AgentController>();
  const { l } = useI18n();
  const agentId = state.params.agentId as string;

  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordOpened, { open: openPassword, close: closePassword }] =
    useDisclosure(false);
  const [newPassword, setNewPassword] = useState("");

  const loadAgent = async () => {
    try {
      const data = await client.getAgent({
        params: { id: agentId },
      });
      setAgent(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgent();
  }, [agentId]);

  const suspendAction = useAction(
    {
      handler: async () => {
        await client.suspendAgent({
          params: { id: agentId },
          body: {},
        });
        loadAgent();
      },
    },
    [agentId],
  );

  const activateAction = useAction(
    {
      handler: async () => {
        await client.activateAgent({
          params: { id: agentId },
        });
        loadAgent();
      },
    },
    [agentId],
  );

  const resetPasswordAction = useAction(
    {
      handler: async () => {
        if (!newPassword || newPassword.length < 8) return;
        await client.resetAgentPassword({
          params: { id: agentId },
          body: { newPassword },
        });
        closePassword();
        setNewPassword("");
      },
    },
    [agentId, newPassword],
  );

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!agent) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Agent not found</Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" gap="md">
      <Grid>
        {/* Employment Info Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Employment</Text>
                <Badge
                  size="lg"
                  variant="light"
                  color={statusColors[agent.status]}
                >
                  {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
                </Badge>
              </Group>

              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconBriefcase size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Employee ID
                  </Text>
                  <Text size="sm" fw={500} ff="monospace">
                    {agent.employeeId || "—"}
                  </Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconBriefcase size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Job Title
                  </Text>
                  <Text size="sm">{agent.jobTitle || "—"}</Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconBriefcase size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Department
                  </Text>
                  <Text size="sm">{agent.department || "—"}</Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconCalendar size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Hired
                  </Text>
                  <Text size="sm">
                    {agent.hiredAt ? l(agent.hiredAt, { date: "long" }) : "—"}
                  </Text>
                </Group>

                {agent.terminatedAt && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="red">
                      <IconCalendar size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Terminated
                    </Text>
                    <Text size="sm" c="red">
                      {l(agent.terminatedAt, { date: "long" })}
                    </Text>
                  </Group>
                )}
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Contact Info Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Contact</Text>

              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconMail size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Work Email
                  </Text>
                  <Text size="sm">{agent.workEmail || "—"}</Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconPhone size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Work Phone
                  </Text>
                  <Text size="sm">{agent.workPhone || "—"}</Text>
                </Group>

                {agent.extension && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconPhone size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Extension
                    </Text>
                    <Text size="sm">{agent.extension}</Text>
                  </Group>
                )}

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconWorld size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Timezone
                  </Text>
                  <Text size="sm">{agent.timezone || "—"}</Text>
                </Group>
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Schedule Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Schedule</Text>

              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconClock size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Working Hours
                  </Text>
                  <Text size="sm">
                    {agent.workingHours
                      ? `${agent.workingHours.start} - ${agent.workingHours.end}`
                      : "—"}
                  </Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconCalendar size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Working Days
                  </Text>
                  <Text size="sm">
                    {agent.workingDays
                      ? agent.workingDays
                          .map(
                            (d) =>
                              ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                                d
                              ],
                          )
                          .join(", ")
                      : "—"}
                  </Text>
                </Group>
              </Stack>

              {agent.skills && agent.skills.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Skills
                  </Text>
                  <Group gap="xs">
                    {agent.skills.map((skill) => (
                      <Badge key={skill} size="sm" variant="light">
                        {skill}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              )}

              {agent.languages && agent.languages.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Languages
                  </Text>
                  <Group gap="xs">
                    {agent.languages.map((lang) => (
                      <Badge key={lang} size="sm" variant="outline">
                        {lang}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Actions Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Actions</Text>

              <Stack gap="sm">
                <ActionButton
                  variant="light"
                  leftSection={<IconKey size={16} />}
                  onClick={openPassword}
                  fullWidth
                >
                  Reset Password
                </ActionButton>

                {agent.status === "active" && (
                  <ActionButton
                    variant="light"
                    color="orange"
                    leftSection={<IconPlayerPause size={16} />}
                    onClick={suspendAction.run}
                    loading={suspendAction.loading}
                    fullWidth
                  >
                    Suspend Agent
                  </ActionButton>
                )}

                {(agent.status === "suspended" ||
                  agent.status === "inactive") && (
                  <ActionButton
                    variant="light"
                    color="green"
                    leftSection={<IconPlayerPlay size={16} />}
                    onClick={activateAction.run}
                    loading={activateAction.loading}
                    fullWidth
                  >
                    Activate Agent
                  </ActionButton>
                )}
              </Stack>

              {agent.notes && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Notes
                  </Text>
                  <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                    {agent.notes}
                  </Text>
                </Stack>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Reset Password Modal */}
      <Modal
        opened={passwordOpened}
        onClose={closePassword}
        title="Reset Password"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Set a new password for this agent. They will be logged out of all
            sessions.
          </Text>
          <PasswordInput
            label="New Password"
            placeholder="Min. 8 characters"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
          />
          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closePassword}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color="blue"
              leftSection={<IconCheck size={16} />}
              onClick={resetPasswordAction.run}
              loading={resetPasswordAction.loading}
              disabled={!newPassword || newPassword.length < 8}
            >
              Reset Password
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminAgentDetails;
