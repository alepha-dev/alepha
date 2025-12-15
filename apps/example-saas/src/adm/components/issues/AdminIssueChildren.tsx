import { useClient, useRouter, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
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

const AdminIssueChildren = () => {
  const state = useRouterState();
  const router = useRouter<AdmRouter>();
  const client = useClient<IssueController>();
  const { l } = useI18n();
  const issueId = state.params.issueId as string;

  const [children, setChildren] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadChildren = async () => {
      try {
        const data = await client.getChildIssues({
          params: { id: issueId },
        });
        setChildren(data);
      } finally {
        setLoading(false);
      }
    };

    loadChildren();
  }, [issueId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (children.length === 0) {
    return (
      <Flex
        flex={1}
        direction="column"
        align="center"
        justify="center"
        gap="md"
      >
        <Text c="dimmed">No child issues</Text>
        <Text size="sm" c="dimmed">
          Child issues can be used to break down complex issues into smaller
          tasks.
        </Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" gap="md">
      <Stack gap="sm">
        {children.map((child) => (
          <Card
            key={child.id}
            withBorder
            p="sm"
            style={{ cursor: "pointer" }}
            onClick={() =>
              router.go("adminIssueDetails", {
                params: { issueId: child.id },
              })
            }
          >
            <Group justify="space-between">
              <Group>
                <IconAlertCircle
                  size={20}
                  color={`var(--mantine-color-${statusColors[child.status]}-6)`}
                />
                <Stack gap={2}>
                  <Group gap="xs">
                    <Text size="sm" fw={500} lineClamp={1}>
                      {child.title}
                    </Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={statusColors[child.status]}
                    >
                      {child.status}
                    </Badge>
                    <Badge
                      size="xs"
                      variant="outline"
                      color={priorityColors[child.priority]}
                    >
                      {child.priority}
                    </Badge>
                  </Group>
                  {child.category && (
                    <Text size="xs" c="dimmed">
                      {child.category}
                    </Text>
                  )}
                </Stack>
              </Group>
              <Text size="xs" c="dimmed">
                {l(child.createdAt, { date: "fromNow" })}
              </Text>
            </Group>
          </Card>
        ))}
      </Stack>
    </Flex>
  );
};

export default AdminIssueChildren;
