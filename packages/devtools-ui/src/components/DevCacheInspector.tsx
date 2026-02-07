import { ui } from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Flex,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconArchive,
  IconClock,
  IconKey,
  IconSearch,
  IconServer,
  IconTrash,
} from "@tabler/icons-react";
import type { DevCacheMetadata } from "alepha/devtools";
import { devMetadataSchema } from "alepha/devtools";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useEffect, useMemo, useState } from "react";

const PROVIDER_COLORS: Record<string, string> = {
  memory: "#69db7c",
  redis: "#ff6b6b",
  default: "#495057",
};

const getProviderColor = (provider: string): string => {
  return PROVIDER_COLORS[provider] ?? PROVIDER_COLORS.default;
};

const formatTtl = (ttl: any): string => {
  if (!ttl) return "No TTL";
  if (typeof ttl === "number") {
    if (ttl < 60) return `${ttl}s`;
    if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
    if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
    return `${Math.floor(ttl / 86400)}d`;
  }
  return String(ttl);
};

const CacheSidebar = ({
  caches,
  selectedCache,
  onSelectCache,
  search,
  onSearchChange,
}: {
  caches: DevCacheMetadata[];
  selectedCache: DevCacheMetadata | null;
  onSelectCache: (cache: DevCacheMetadata) => void;
  search: string;
  onSearchChange: (search: string) => void;
}) => {
  // Group caches by provider
  const grouped = useMemo(() => {
    const groups: Record<string, DevCacheMetadata[]> = {};
    for (const cache of caches) {
      const provider = cache.provider || "default";
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(cache);
    }
    return groups;
  }, [caches]);

  const providers = Object.keys(grouped).sort();

  return (
    <Stack gap={0} h="100%">
      <Box p="sm" style={{ borderBottom: `1px solid ${ui.colors.border}` }}>
        <TextInput
          placeholder="Search caches..."
          leftSection={<IconSearch size={14} />}
          size="xs"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </Box>
      <ScrollArea style={{ flex: 1 }}>
        {providers.map((provider) => (
          <Box key={provider}>
            <Text
              size="xs"
              fw={600}
              c="dimmed"
              px="sm"
              py="xs"
              style={{
                backgroundColor: ui.colors.background,
                borderBottom: `1px solid ${ui.colors.border}`,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {provider}
            </Text>
            {grouped[provider].map((cache) => {
              const isSelected = selectedCache?.name === cache.name;
              const providerColor = getProviderColor(cache.provider);
              return (
                <Flex
                  key={cache.name}
                  align="center"
                  gap="xs"
                  px="sm"
                  py={6}
                  onClick={() => onSelectCache(cache)}
                  style={{
                    cursor: "pointer",
                    backgroundColor: isSelected
                      ? `${providerColor}15`
                      : undefined,
                    borderLeft: isSelected
                      ? `2px solid ${providerColor}`
                      : "2px solid transparent",
                    borderBottom: `1px solid ${ui.colors.border}`,
                    opacity: cache.disabled ? 0.5 : 1,
                  }}
                >
                  <IconArchive size={14} opacity={0.5} />
                  <Text size="sm" style={{ flex: 1 }} truncate>
                    {cache.name}
                  </Text>
                  {cache.disabled && (
                    <Badge size="xs" variant="light" color="gray">
                      off
                    </Badge>
                  )}
                </Flex>
              );
            })}
          </Box>
        ))}
      </ScrollArea>
    </Stack>
  );
};

const ConfigTab = ({ cache }: { cache: DevCacheMetadata }) => {
  return (
    <ScrollArea h="100%" p="md">
      <Stack gap="lg">
        <Box>
          <Text size="sm" fw={600} mb="xs">
            Configuration
          </Text>
          <Table striped highlightOnHover withTableBorder>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td w={150}>
                  <Text size="sm" c="dimmed">
                    Name
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {cache.name}
                  </Text>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    Provider
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge
                    size="xs"
                    variant="light"
                    color={cache.provider === "redis" ? "red" : "green"}
                  >
                    {cache.provider}
                  </Badge>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    TTL
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Flex align="center" gap="xs">
                    <IconClock size={14} opacity={0.5} />
                    <Text size="sm" ff="monospace">
                      {formatTtl(cache.ttl)}
                    </Text>
                  </Flex>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    Status
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge
                    size="xs"
                    variant="light"
                    color={cache.disabled ? "gray" : "green"}
                  >
                    {cache.disabled ? "Disabled" : "Enabled"}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Box>

        <Box>
          <Text size="sm" fw={600} mb="xs">
            Actions
          </Text>
          <Flex gap="sm">
            <Tooltip label="Clear all cached entries (coming soon)">
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconTrash size={14} />}
                disabled
              >
                Clear All
              </Button>
            </Tooltip>
          </Flex>
        </Box>
      </Stack>
    </ScrollArea>
  );
};

const KeysTab = ({ cache }: { cache: DevCacheMetadata }) => {
  const [pattern, setPattern] = useState("");

  return (
    <Flex direction="column" h="100%">
      <Box p="sm" style={{ borderBottom: `1px solid ${ui.colors.border}` }}>
        <Flex gap="sm" align="center">
          <TextInput
            placeholder="Filter by pattern..."
            leftSection={<IconSearch size={14} />}
            size="xs"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            style={{ flex: 1 }}
          />
          <Tooltip label="Invalidate matching keys (coming soon)">
            <ActionIcon size="sm" variant="light" color="orange" disabled>
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </Flex>
      </Box>
      <Flex align="center" justify="center" style={{ flex: 1 }} c="dimmed">
        <Stack align="center" gap="xs">
          <IconKey size={48} opacity={0.3} />
          <Text size="sm">Key browser coming soon</Text>
          <Text size="xs" c="dimmed">
            Browse and manage cached keys for {cache.name}
          </Text>
        </Stack>
      </Flex>
    </Flex>
  );
};

const CachePanel = ({ cache }: { cache: DevCacheMetadata }) => {
  const providerColor = getProviderColor(cache.provider);

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
          <IconArchive size={18} opacity={0.7} />
          <Text size="md" fw={600}>
            {cache.name}
          </Text>
          <Badge
            size="xs"
            variant="light"
            color={cache.provider === "redis" ? "red" : "green"}
          >
            {cache.provider}
          </Badge>
          {cache.disabled && (
            <Badge size="xs" variant="light" color="gray">
              disabled
            </Badge>
          )}
        </Flex>
      </Box>

      {/* Tabs */}
      <Tabs
        defaultValue="config"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
      >
        <Tabs.List px="md">
          <Tabs.Tab value="config">Config</Tabs.Tab>
          <Tabs.Tab value="keys">Keys</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="config" style={{ flex: 1, overflow: "hidden" }}>
          <ConfigTab cache={cache} />
        </Tabs.Panel>

        <Tabs.Panel value="keys" style={{ flex: 1, overflow: "hidden" }}>
          <KeysTab cache={cache} />
        </Tabs.Panel>
      </Tabs>
    </Flex>
  );
};

const EmptyState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconArchive size={48} opacity={0.3} />
      <Text size="sm">Select a cache to view its configuration</Text>
    </Stack>
  </Flex>
);

const NoCachesState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconServer size={48} opacity={0.3} />
      <Text>No caches found</Text>
      <Text size="sm" c="dimmed">
        Add caches using $cache primitive to see them here
      </Text>
    </Stack>
  </Flex>
);

export const DevCacheInspector = () => {
  const http = useInject(HttpClient);
  const [caches, setCaches] = useState<DevCacheMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCache, setSelectedCache] = useState<DevCacheMetadata | null>(
    null,
  );
  const [search, setSearch] = useState("");

  // Fetch caches
  useEffect(() => {
    http
      .fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => {
        setCaches(res.data.caches);
        setLoading(false);
      });
  }, []);

  // Filter caches by search
  const filteredCaches = useMemo(() => {
    if (!search) return caches;
    const searchLower = search.toLowerCase();
    return caches.filter((c) => c.name.toLowerCase().includes(searchLower));
  }, [caches, search]);

  if (loading) {
    return (
      <Flex align="center" justify="center" h="100%">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  if (caches.length === 0) {
    return <NoCachesState />;
  }

  return (
    <Flex h="100%" style={{ overflow: "hidden" }}>
      {/* Sidebar */}
      <Box
        w={240}
        style={{
          borderRight: `1px solid ${ui.colors.border}`,
          backgroundColor: ui.colors.surface,
        }}
      >
        <CacheSidebar
          caches={filteredCaches}
          selectedCache={selectedCache}
          onSelectCache={setSelectedCache}
          search={search}
          onSearchChange={setSearch}
        />
      </Box>

      {/* Main content */}
      <Box style={{ flex: 1, overflow: "hidden" }}>
        {selectedCache ? <CachePanel cache={selectedCache} /> : <EmptyState />}
      </Box>
    </Flex>
  );
};

export default DevCacheInspector;
