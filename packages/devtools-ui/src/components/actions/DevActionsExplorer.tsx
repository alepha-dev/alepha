import {
  Badge,
  Flex,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconApi, IconSearch } from "@tabler/icons-react";
import type { DevActionMetadata } from "alepha/devtools";
import { devMetadataSchema } from "alepha/devtools";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useEffect, useMemo, useState } from "react";
import { ActionGroup } from "./ActionGroup.tsx";

export const DevActionsExplorer = () => {
  const http = useInject(HttpClient);
  const [actions, setActions] = useState<DevActionMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");

  useEffect(() => {
    http
      .fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => {
        setActions(res.data.actions);
        setLoading(false);
      });
  }, []);

  const filteredActions = useMemo(() => {
    return actions.filter((action) => {
      if (action.hide) return false;
      if (
        methodFilter !== "all" &&
        action.method.toUpperCase() !== methodFilter
      ) {
        return false;
      }
      if (search) {
        const searchLower = search.toLowerCase();
        return (
          action.fullPath.toLowerCase().includes(searchLower) ||
          action.name.toLowerCase().includes(searchLower) ||
          action.group.toLowerCase().includes(searchLower) ||
          action.description?.toLowerCase().includes(searchLower)
        );
      }
      return true;
    });
  }, [actions, search, methodFilter]);

  const groupedActions = useMemo(() => {
    const groups: Record<string, DevActionMetadata[]> = {};
    for (const action of filteredActions) {
      const group = action.group || "Other";
      if (!groups[group]) groups[group] = [];
      groups[group].push(action);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredActions]);

  if (loading) {
    return (
      <Flex align="center" justify="center" h="100%">
        <Loader size="sm" />
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="md" w="100%" h="100%" p={"xl"}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm">
          <IconApi size={24} opacity={0.7} />
          <Text size="lg" fw={500}>
            Actions
          </Text>
          <Badge variant="light" color="gray" size="sm">
            {filteredActions.length}
          </Badge>
        </Group>
      </Group>

      <Group gap="sm">
        <TextInput
          placeholder="Search actions..."
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1 }}
          size="sm"
        />
        <SegmentedControl
          size="xs"
          value={methodFilter}
          onChange={setMethodFilter}
          data={[
            { label: "All", value: "all" },
            { label: "GET", value: "GET" },
            { label: "POST", value: "POST" },
            { label: "PUT", value: "PUT" },
            { label: "DELETE", value: "DELETE" },
          ]}
        />
      </Group>

      <ScrollArea flex={1} offsetScrollbars>
        {groupedActions.length === 0 ? (
          <Flex align="center" justify="center" h={200}>
            <Text c="dimmed">No actions found</Text>
          </Flex>
        ) : (
          <Stack gap="md">
            {groupedActions.map(([group, groupActions]) => (
              <ActionGroup key={group} group={group} actions={groupActions} />
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Flex>
  );
};

export default DevActionsExplorer;
