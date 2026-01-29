import { ui } from "@alepha/ui";
import { JsonViewer } from "@alepha/ui/json";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Flex,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconFolder,
  IconFolderOpen,
  IconMessageCircle,
  IconPlayerPlay,
  IconSearch,
  IconSend,
  IconServer,
  IconTrash,
} from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { devMetadataSchema } from "../../api/schemas/DevMetadata.ts";
import type { DevTopicMetadata } from "../../api/schemas/DevTopicMetadata.ts";

const PROVIDER_COLORS: Record<string, string> = {
  memory: "#69db7c",
  redis: "#ff6b6b",
  default: "#495057",
};

const getProviderColor = (provider: string): string => {
  return PROVIDER_COLORS[provider] ?? PROVIDER_COLORS.default;
};

// Build tree structure from topic names
interface TopicTreeNode {
  name: string;
  fullPath: string;
  topic?: DevTopicMetadata;
  children: Map<string, TopicTreeNode>;
}

const buildTopicTree = (topics: DevTopicMetadata[]): TopicTreeNode => {
  const root: TopicTreeNode = { name: "", fullPath: "", children: new Map() };

  for (const topic of topics) {
    const parts = topic.name.split(/[./]/);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = parts.slice(0, i + 1).join("/");

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath,
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }
    current.topic = topic;
  }

  return root;
};

const TopicTreeItem = ({
  node,
  depth,
  selectedTopic,
  onSelectTopic,
  expandedNodes,
  onToggleExpand,
}: {
  node: TopicTreeNode;
  depth: number;
  selectedTopic: DevTopicMetadata | null;
  onSelectTopic: (topic: DevTopicMetadata) => void;
  expandedNodes: Set<string>;
  onToggleExpand: (path: string) => void;
}) => {
  const hasChildren = node.children.size > 0;
  const isExpanded = expandedNodes.has(node.fullPath);
  const isSelected = node.topic && selectedTopic?.name === node.topic.name;
  const providerColor = node.topic
    ? getProviderColor(node.topic.provider)
    : "#495057";

  const handleClick = () => {
    if (node.topic) {
      onSelectTopic(node.topic);
    }
    if (hasChildren) {
      onToggleExpand(node.fullPath);
    }
  };

  return (
    <Box>
      <Flex
        align="center"
        gap={4}
        px="sm"
        py={4}
        onClick={handleClick}
        style={{
          cursor: "pointer",
          paddingLeft: depth * 16 + 8,
          backgroundColor: isSelected ? `${providerColor}15` : undefined,
          borderLeft: isSelected
            ? `2px solid ${providerColor}`
            : "2px solid transparent",
          borderBottom: `1px solid ${ui.colors.border}`,
        }}
      >
        {hasChildren ? (
          isExpanded ? (
            <IconChevronDown size={12} opacity={0.5} />
          ) : (
            <IconChevronRight size={12} opacity={0.5} />
          )
        ) : (
          <Box w={12} />
        )}
        {hasChildren ? (
          isExpanded ? (
            <IconFolderOpen size={14} opacity={0.5} />
          ) : (
            <IconFolder size={14} opacity={0.5} />
          )
        ) : (
          <IconMessageCircle size={14} opacity={0.5} />
        )}
        <Text
          size="sm"
          style={{ flex: 1 }}
          truncate
          fw={node.topic ? 500 : 400}
        >
          {node.name}
        </Text>
        {node.topic && (
          <Badge
            size="xs"
            variant="light"
            color={node.topic.provider === "redis" ? "red" : "green"}
          >
            {node.topic.provider}
          </Badge>
        )}
      </Flex>
      {hasChildren && isExpanded && (
        <Box>
          {Array.from(node.children.values())
            .sort((a, b) => {
              // Folders first, then alphabetical
              const aHasChildren = a.children.size > 0;
              const bHasChildren = b.children.size > 0;
              if (aHasChildren && !bHasChildren) return -1;
              if (!aHasChildren && bHasChildren) return 1;
              return a.name.localeCompare(b.name);
            })
            .map((child) => (
              <TopicTreeItem
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                selectedTopic={selectedTopic}
                onSelectTopic={onSelectTopic}
                expandedNodes={expandedNodes}
                onToggleExpand={onToggleExpand}
              />
            ))}
        </Box>
      )}
    </Box>
  );
};

const TopicSidebar = ({
  topics,
  selectedTopic,
  onSelectTopic,
  search,
  onSearchChange,
}: {
  topics: DevTopicMetadata[];
  selectedTopic: DevTopicMetadata | null;
  onSelectTopic: (topic: DevTopicMetadata) => void;
  search: string;
  onSearchChange: (search: string) => void;
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTopicTree(topics), [topics]);

  // Auto-expand all nodes on first load
  useEffect(() => {
    const allPaths = new Set<string>();
    const collectPaths = (node: TopicTreeNode) => {
      if (node.fullPath) allPaths.add(node.fullPath);
      for (const child of node.children.values()) {
        collectPaths(child);
      }
    };
    collectPaths(tree);
    setExpandedNodes(allPaths);
  }, [tree]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <Stack gap={0} h="100%">
      <Box p="sm" style={{ borderBottom: `1px solid ${ui.colors.border}` }}>
        <TextInput
          placeholder="Search topics..."
          leftSection={<IconSearch size={14} />}
          size="xs"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </Box>
      <ScrollArea style={{ flex: 1 }}>
        {Array.from(tree.children.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((node) => (
            <TopicTreeItem
              key={node.fullPath}
              node={node}
              depth={0}
              selectedTopic={selectedTopic}
              onSelectTopic={onSelectTopic}
              expandedNodes={expandedNodes}
              onToggleExpand={handleToggleExpand}
            />
          ))}
      </ScrollArea>
    </Stack>
  );
};

interface FakeMessage {
  id: string;
  timestamp: Date;
  payload: any;
}

const SchemaTab = ({ topic }: { topic: DevTopicMetadata }) => {
  return (
    <ScrollArea h="100%" p="md">
      <Stack gap="lg">
        <Box>
          <Text size="sm" fw={600} mb="xs">
            Topic Info
          </Text>
          <Stack gap="xs">
            <Flex gap="sm">
              <Text size="sm" c="dimmed" w={100}>
                Name
              </Text>
              <Text size="sm" ff="monospace">
                {topic.name}
              </Text>
            </Flex>
            <Flex gap="sm">
              <Text size="sm" c="dimmed" w={100}>
                Provider
              </Text>
              <Badge
                size="xs"
                variant="light"
                color={topic.provider === "redis" ? "red" : "green"}
              >
                {topic.provider}
              </Badge>
            </Flex>
            {topic.description && (
              <Flex gap="sm">
                <Text size="sm" c="dimmed" w={100}>
                  Description
                </Text>
                <Text size="sm">{topic.description}</Text>
              </Flex>
            )}
          </Stack>
        </Box>

        {topic.schema && (
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Message Schema
            </Text>
            <Box
              p="sm"
              style={{
                border: `1px solid ${ui.colors.border}`,
                borderRadius: 8,
                backgroundColor: ui.colors.surface,
              }}
            >
              <JsonViewer data={topic.schema} maxDepth={5} size="xs" />
            </Box>
          </Box>
        )}
      </Stack>
    </ScrollArea>
  );
};

const MessagesTab = ({ topic }: { topic: DevTopicMetadata }) => {
  const [messages, setMessages] = useState<FakeMessage[]>([]);
  const [isListening, setIsListening] = useState(false);

  // Generate fake message for demo
  const addFakeMessage = useCallback(() => {
    const fakePayload = topic.schema
      ? {
          example: "data",
          topic: topic.name,
          timestamp: new Date().toISOString(),
        }
      : { message: `Hello from ${topic.name}` };

    setMessages((prev) => [
      {
        id: Math.random().toString(36).slice(2),
        timestamp: new Date(),
        payload: fakePayload,
      },
      ...prev.slice(0, 49), // Keep last 50 messages
    ]);
  }, [topic]);

  return (
    <Flex direction="column" h="100%">
      <Box p="sm" style={{ borderBottom: `1px solid ${ui.colors.border}` }}>
        <Flex gap="sm" align="center" justify="space-between">
          <Flex gap="sm" align="center">
            <Tooltip
              label={
                isListening
                  ? "Stop listening (coming soon)"
                  : "Start listening (coming soon)"
              }
            >
              <Button
                size="xs"
                variant="light"
                color={isListening ? "red" : "green"}
                leftSection={<IconPlayerPlay size={14} />}
                onClick={() => setIsListening(!isListening)}
                disabled
              >
                {isListening ? "Stop" : "Listen"}
              </Button>
            </Tooltip>
            <Text size="xs" c="dimmed">
              {messages.length} messages
            </Text>
          </Flex>
          <Flex gap="sm">
            <Tooltip label="Add fake message (for demo)">
              <ActionIcon size="sm" variant="light" onClick={addFakeMessage}>
                <IconSend size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Clear messages">
              <ActionIcon
                size="sm"
                variant="light"
                color="gray"
                onClick={() => setMessages([])}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Flex>
      </Box>

      {messages.length === 0 ? (
        <Flex align="center" justify="center" style={{ flex: 1 }} c="dimmed">
          <Stack align="center" gap="xs">
            <IconMessageCircle size={48} opacity={0.3} />
            <Text size="sm">No messages yet</Text>
            <Text size="xs" c="dimmed">
              Click the send icon to add a fake message for demo
            </Text>
          </Stack>
        </Flex>
      ) : (
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap={0}>
            {messages.map((msg) => (
              <Box
                key={msg.id}
                p="sm"
                style={{
                  borderBottom: `1px solid ${ui.colors.border}`,
                }}
              >
                <Flex align="center" gap="xs" mb="xs">
                  <IconClock size={12} opacity={0.5} />
                  <Text size="xs" c="dimmed">
                    {msg.timestamp.toLocaleTimeString()}
                  </Text>
                </Flex>
                <Box
                  p="xs"
                  style={{
                    backgroundColor: ui.colors.surface,
                    borderRadius: 4,
                  }}
                >
                  <JsonViewer data={msg.payload} maxDepth={3} size="xs" />
                </Box>
              </Box>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Flex>
  );
};

const PublishTab = ({ topic }: { topic: DevTopicMetadata }) => {
  const [payload, setPayload] = useState(
    JSON.stringify(
      { message: "Hello", timestamp: new Date().toISOString() },
      null,
      2,
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const handlePublish = () => {
    try {
      JSON.parse(payload);
      setError(null);
      // Fake publish - would call API in real implementation
      alert(`Message would be published to "${topic.name}" (coming soon)`);
    } catch {
      setError("Invalid JSON");
    }
  };

  return (
    <ScrollArea h="100%" p="md">
      <Stack gap="md">
        <Box>
          <Text size="sm" fw={600} mb="xs">
            Publish Message
          </Text>
          <Text size="xs" c="dimmed" mb="sm">
            Send a test message to this topic (coming soon)
          </Text>
        </Box>

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Payload (JSON)
          </Text>
          <Textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            minRows={8}
            maxRows={15}
            autosize
            ff="monospace"
            size="xs"
            error={error}
            styles={{
              input: {
                backgroundColor: ui.colors.surface,
              },
            }}
          />
        </Box>

        <Tooltip label="Publish message (coming soon)">
          <Button
            size="sm"
            variant="light"
            leftSection={<IconSend size={16} />}
            onClick={handlePublish}
            disabled
          >
            Publish
          </Button>
        </Tooltip>

        {topic.schema && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Expected Schema
            </Text>
            <Box
              p="sm"
              style={{
                border: `1px solid ${ui.colors.border}`,
                borderRadius: 8,
                backgroundColor: ui.colors.surface,
              }}
            >
              <JsonViewer data={topic.schema} maxDepth={3} size="xs" />
            </Box>
          </Box>
        )}
      </Stack>
    </ScrollArea>
  );
};

const TopicPanel = ({ topic }: { topic: DevTopicMetadata }) => {
  const providerColor = getProviderColor(topic.provider);

  return (
    <Flex direction="column" h="100%">
      {/* Header */}
      <Box
        px="md"
        py="sm"
        style={{
          borderBottom: `1px solid ${ui.colors.border}`,
          backgroundColor: `${providerColor}08`,
        }}
      >
        <Flex align="center" gap="sm">
          <IconMessageCircle size={18} opacity={0.7} />
          <Text size="md" fw={600} ff="monospace">
            {topic.name}
          </Text>
          <Badge
            size="xs"
            variant="light"
            color={topic.provider === "redis" ? "red" : "green"}
          >
            {topic.provider}
          </Badge>
        </Flex>
        {topic.description && (
          <Text size="xs" c="dimmed" mt={4}>
            {topic.description}
          </Text>
        )}
      </Box>

      {/* Tabs */}
      <Tabs
        defaultValue="schema"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
      >
        <Tabs.List px="md">
          <Tabs.Tab value="schema">Schema</Tabs.Tab>
          <Tabs.Tab value="messages">Messages</Tabs.Tab>
          <Tabs.Tab value="publish">Publish</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="schema" style={{ flex: 1, overflow: "hidden" }}>
          <SchemaTab topic={topic} />
        </Tabs.Panel>

        <Tabs.Panel value="messages" style={{ flex: 1, overflow: "hidden" }}>
          <MessagesTab topic={topic} />
        </Tabs.Panel>

        <Tabs.Panel value="publish" style={{ flex: 1, overflow: "hidden" }}>
          <PublishTab topic={topic} />
        </Tabs.Panel>
      </Tabs>
    </Flex>
  );
};

const EmptyState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconMessageCircle size={48} opacity={0.3} />
      <Text size="sm">Select a topic to view details</Text>
    </Stack>
  </Flex>
);

const NoTopicsState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconServer size={48} opacity={0.3} />
      <Text>No topics found</Text>
      <Text size="sm" c="dimmed">
        Add topics using $topic primitive to see them here
      </Text>
    </Stack>
  </Flex>
);

export const DevTopicsViewer = () => {
  const http = useInject(HttpClient);
  const [topics, setTopics] = useState<DevTopicMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<DevTopicMetadata | null>(
    null,
  );
  const [search, setSearch] = useState("");

  // Fetch topics
  useEffect(() => {
    http
      .fetch("/devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => {
        setTopics(res.data.topics);
        setLoading(false);
      });
  }, []);

  // Filter topics by search
  const filteredTopics = useMemo(() => {
    if (!search) return topics;
    const searchLower = search.toLowerCase();
    return topics.filter((t) => t.name.toLowerCase().includes(searchLower));
  }, [topics, search]);

  if (loading) {
    return (
      <Flex align="center" justify="center" h="100%">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  if (topics.length === 0) {
    return <NoTopicsState />;
  }

  return (
    <Flex h="100%" style={{ overflow: "hidden" }}>
      {/* Sidebar */}
      <Box
        w={280}
        style={{
          borderRight: `1px solid ${ui.colors.border}`,
          backgroundColor: ui.colors.surface,
        }}
      >
        <TopicSidebar
          topics={filteredTopics}
          selectedTopic={selectedTopic}
          onSelectTopic={setSelectedTopic}
          search={search}
          onSearchChange={setSearch}
        />
      </Box>

      {/* Main content */}
      <Box style={{ flex: 1, overflow: "hidden" }}>
        {selectedTopic ? <TopicPanel topic={selectedTopic} /> : <EmptyState />}
      </Box>
    </Flex>
  );
};

export default DevTopicsViewer;
