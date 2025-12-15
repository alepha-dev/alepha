import {
  NestedView,
  useClient,
  useRouter,
  useRouterState,
} from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, Tabs } from "@mantine/core";
import {
  IconAlertCircle,
  IconFileText,
  IconListTree,
  IconMessageCircle,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { IssueController } from "../../../api/issues/controllers/IssueController.ts";
import type { Issue } from "../../../api/issues/entities/issues.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  open: "blue",
  pending: "yellow",
  accepted: "green",
  rejected: "red",
  cancelled: "gray",
  archived: "gray",
};

const priorityColors: Record<string, string> = {
  low: "gray",
  medium: "blue",
  high: "orange",
  urgent: "red",
};

const AdminIssueLayout = () => {
  const router = useRouter<AdmRouter>();
  const state = useRouterState();
  const client = useClient<IssueController>();
  const { l } = useI18n();
  const issueId = state.params.issueId as string;

  const [issue, setIssue] = useState<Issue | null>(null);
  const [childCount, setChildCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadIssue = async () => {
      try {
        const [data, children, messages] = await Promise.all([
          client.getIssue({ params: { id: issueId } }),
          client.getChildIssues({ params: { id: issueId } }),
          client.getIssueMessages({
            params: { id: issueId },
            query: { size: 1 },
          }),
        ]);
        setIssue(data);
        setChildCount(children.length);
        setMessageCount(
          messages.page?.totalElements || messages.content.length,
        );
      } finally {
        setLoading(false);
      }
    };

    loadIssue();
  }, [issueId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!issue) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Issue not found</Text>
      </Flex>
    );
  }

  const currentPath = state.url.pathname;
  const detailsPath = router.path("adminIssueDetails", {
    params: { issueId },
  });
  const messagesPath = router.path("adminIssueMessages", {
    params: { issueId },
  });
  const childrenPath = router.path("adminIssueChildren", {
    params: { issueId },
  });

  const getActiveTab = () => {
    if (currentPath.endsWith("/messages")) return "messages";
    if (currentPath.endsWith("/children")) return "children";
    return "details";
  };
  const activeTab = getActiveTab();

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Card withBorder p="md">
        <Group justify="space-between">
          <Group>
            <IconAlertCircle size={32} color="var(--mantine-color-blue-6)" />
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="lg" fw={600} lineClamp={1}>
                  {issue.title}
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={statusColors[issue.status] || "gray"}
                >
                  {issue.status.charAt(0).toUpperCase() + issue.status.slice(1)}
                </Badge>
                <Badge
                  size="sm"
                  variant="outline"
                  color={priorityColors[issue.priority] || "gray"}
                >
                  {issue.priority.charAt(0).toUpperCase() +
                    issue.priority.slice(1)}
                </Badge>
              </Group>
              <Group gap="xs">
                {issue.category && (
                  <Text size="sm" c="dimmed">
                    {issue.category}
                  </Text>
                )}
                {issue.category && issue.createdAt && (
                  <Text size="sm" c="dimmed">
                    •
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  Created {l(issue.createdAt, { date: "fromNow" })}
                </Text>
              </Group>
            </Stack>
          </Group>
          <Stack gap={4} align="flex-end">
            {issue.assignedAgentId && (
              <Text size="sm" c="dimmed">
                Assigned to agent
              </Text>
            )}
            {issue.tags && issue.tags.length > 0 && (
              <Group gap={4}>
                {issue.tags.slice(0, 3).map((tag: string) => (
                  <Badge key={tag} size="xs" variant="light">
                    {tag}
                  </Badge>
                ))}
                {issue.tags.length > 3 && (
                  <Text size="xs" c="dimmed">
                    +{issue.tags.length - 3}
                  </Text>
                )}
              </Group>
            )}
          </Stack>
        </Group>
      </Card>

      <Tabs value={activeTab}>
        <Tabs.List>
          <ActionButton
            href={detailsPath}
            leftSection={<IconFileText size={16} />}
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
            Details
          </ActionButton>
          <ActionButton
            href={messagesPath}
            leftSection={<IconMessageCircle size={16} />}
            c={activeTab === "messages" ? undefined : "dimmed"}
            fw={activeTab === "messages" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "messages"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Messages {messageCount > 0 && `(${messageCount})`}
          </ActionButton>
          <ActionButton
            href={childrenPath}
            leftSection={<IconListTree size={16} />}
            c={activeTab === "children" ? undefined : "dimmed"}
            fw={activeTab === "children" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "children"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Children {childCount > 0 && `(${childCount})`}
          </ActionButton>
        </Tabs.List>
      </Tabs>

      <Flex flex={1}>
        <NestedView />
      </Flex>
    </Flex>
  );
};

export default AdminIssueLayout;
