import {
  NestedView,
  useClient,
  useRouter,
  useRouterState,
} from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, Tabs } from "@mantine/core";
import { IconId, IconUser } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { AgentController } from "../../../api/agents/controllers/AgentController.ts";
import type { AgentProfile } from "../../../api/agents/entities/agentProfiles.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  active: "green",
  inactive: "gray",
  suspended: "red",
};

const AdminAgentLayout = () => {
  const router = useRouter<AdmRouter>();
  const state = useRouterState();
  const client = useClient<AgentController>();
  const agentId = state.params.agentId as string;

  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

    loadAgent();
  }, [agentId]);

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

  const currentPath = state.url.pathname;
  const detailsPath = router.path("adminAgentDetails", {
    params: { agentId },
  });

  const getActiveTab = () => {
    return "details";
  };
  const activeTab = getActiveTab();

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Card withBorder p="md">
        <Group justify="space-between">
          <Group>
            <IconId size={32} color="var(--mantine-color-blue-6)" />
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="lg" fw={600}>
                  {agent.employeeId || "No Employee ID"}
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={statusColors[agent.status] || "gray"}
                >
                  {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
                </Badge>
              </Group>
              <Group gap="xs">
                {agent.jobTitle && (
                  <Text size="sm" c="dimmed">
                    {agent.jobTitle}
                  </Text>
                )}
                {agent.department && (
                  <>
                    <Text size="sm" c="dimmed">
                      •
                    </Text>
                    <Text size="sm" c="dimmed">
                      {agent.department}
                    </Text>
                  </>
                )}
              </Group>
            </Stack>
          </Group>
          <Stack gap={4} align="flex-end">
            <Text size="sm" c="dimmed">
              {agent.workEmail}
            </Text>
            {agent.workPhone && (
              <Text size="sm" c="dimmed">
                {agent.workPhone}
              </Text>
            )}
          </Stack>
        </Group>
      </Card>

      <Tabs value={activeTab}>
        <Tabs.List>
          <ActionButton
            href={detailsPath}
            leftSection={<IconUser size={16} />}
            c={activeTab === "details" ? undefined : "dimmed"}
            fw={activeTab === "details" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "details"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Profile
          </ActionButton>
        </Tabs.List>
      </Tabs>

      <Flex flex={1}>
        <NestedView />
      </Flex>
    </Flex>
  );
};

export default AdminAgentLayout;
