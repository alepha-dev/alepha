import { ui } from "@alepha/ui";
import {
  Badge,
  Box,
  Flex,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { IconDatabase, IconSearch, IconTable } from "@tabler/icons-react";
import { devMetadataSchema } from "alepha/devtools";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useEffect, useMemo, useState } from "react";
import { ColumnBadge } from "./ColumnBadge.tsx";
import { getProviderColor } from "./constants.ts";
import type { DevEntityMetadata } from "./types.ts";

const EntitySidebar = ({
  entities,
  selectedEntity,
  onSelectEntity,
  search,
  onSearchChange,
}: {
  entities: DevEntityMetadata[];
  selectedEntity: DevEntityMetadata | null;
  onSelectEntity: (entity: DevEntityMetadata) => void;
  search: string;
  onSearchChange: (search: string) => void;
}) => {
  // Group entities by provider
  const grouped = useMemo(() => {
    const groups: Record<string, DevEntityMetadata[]> = {};
    for (const entity of entities) {
      const provider = entity.provider.replace("Provider", "");
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(entity);
    }
    return groups;
  }, [entities]);

  const providers = Object.keys(grouped).sort();

  return (
    <Stack gap={0} h="100%">
      <Box p="sm" style={{ borderBottom: `1px solid ${ui.colors.border}` }}>
        <TextInput
          placeholder="Search tables..."
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
            {grouped[provider].map((entity) => {
              const isSelected = selectedEntity?.name === entity.name;
              const providerColor = getProviderColor(entity.provider);
              return (
                <Flex
                  key={entity.name}
                  align="center"
                  gap="xs"
                  px="sm"
                  py={6}
                  onClick={() => onSelectEntity(entity)}
                  style={{
                    cursor: "pointer",
                    backgroundColor: isSelected
                      ? `${providerColor}15`
                      : undefined,
                    borderLeft: isSelected
                      ? `2px solid ${providerColor}`
                      : "2px solid transparent",
                    borderBottom: `1px solid ${ui.colors.border}`,
                  }}
                >
                  <IconTable size={14} opacity={0.5} />
                  <Text size="sm" style={{ flex: 1 }} truncate>
                    {entity.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {entity.columns.length}
                  </Text>
                </Flex>
              );
            })}
          </Box>
        ))}
      </ScrollArea>
    </Stack>
  );
};

const StructureTab = ({ entity }: { entity: DevEntityMetadata }) => {
  return (
    <ScrollArea h="100%" p="md">
      <Stack gap="lg">
        {/* Columns */}
        <Box>
          <Text size="sm" fw={600} mb="xs">
            Columns
          </Text>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Attributes</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entity.columns.map((col) => (
                <Table.Tr key={col.name}>
                  <Table.Td>
                    <Text
                      size="sm"
                      ff="monospace"
                      fw={col.primaryKey ? 600 : 400}
                    >
                      {col.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace" c="dimmed">
                      {col.type}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Flex gap={4} wrap="wrap">
                      <ColumnBadge column={col} />
                    </Flex>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>

        {/* Indexes */}
        {entity.indexes.length > 0 && (
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Indexes
            </Text>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Columns</Table.Th>
                  <Table.Th>Unique</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entity.indexes.map((idx, i) => (
                  <Table.Tr key={idx.name || i}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {idx.name || "-"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Flex gap={4}>
                        {idx.columns.map((c) => (
                          <Badge key={c} size="xs" variant="light">
                            {c}
                          </Badge>
                        ))}
                      </Flex>
                    </Table.Td>
                    <Table.Td>
                      {idx.unique && (
                        <Badge size="xs" color="yellow">
                          UNIQUE
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}

        {/* Foreign Keys */}
        {entity.foreignKeys.length > 0 && (
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Foreign Keys
            </Text>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Column</Table.Th>
                  <Table.Th>References</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entity.foreignKeys.map((fk, i) => (
                  <Table.Tr key={fk.name || i}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {fk.name || "-"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {fk.columns.join(", ")}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace" c="pink">
                        {fk.foreignEntity}.{fk.foreignColumns.join(", ")}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}

        {/* Alepha Column References */}
        {entity.columns.some((c) => c.ref) && (
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Column References
            </Text>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Column</Table.Th>
                  <Table.Th>References</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entity.columns
                  .filter((c) => c.ref)
                  .map((col) => (
                    <Table.Tr key={col.name}>
                      <Table.Td>
                        <Text size="sm" ff="monospace">
                          {col.name}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ff="monospace" c="pink">
                          {col.ref?.entity}.{col.ref?.column}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}

        {/* Constraints */}
        {entity.constraints.length > 0 && (
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Constraints
            </Text>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Columns</Table.Th>
                  <Table.Th>Type</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entity.constraints.map((c, i) => (
                  <Table.Tr key={c.name || i}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {c.name || "-"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Flex gap={4}>
                        {c.columns.map((col) => (
                          <Badge key={col} size="xs" variant="outline">
                            {col}
                          </Badge>
                        ))}
                      </Flex>
                    </Table.Td>
                    <Table.Td>
                      <Flex gap={4}>
                        {c.unique && (
                          <Badge size="xs" color="yellow">
                            UNIQUE
                          </Badge>
                        )}
                        {c.hasCheck && (
                          <Badge size="xs" color="blue">
                            CHECK
                          </Badge>
                        )}
                      </Flex>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Stack>
    </ScrollArea>
  );
};

const DataTab = () => {
  return (
    <Flex align="center" justify="center" h="100%" c="dimmed">
      <Stack align="center" gap="xs">
        <IconDatabase size={48} opacity={0.3} />
        <Text size="sm">Data browser coming soon</Text>
      </Stack>
    </Flex>
  );
};

const EntityPanel = ({ entity }: { entity: DevEntityMetadata }) => {
  const providerColor = getProviderColor(entity.provider);

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
          <IconTable size={18} opacity={0.7} />
          <Text size="md" fw={600}>
            {entity.name}
          </Text>
          <Badge size="xs" variant="light" color="gray">
            {entity.columns.length} columns
          </Badge>
        </Flex>
      </Box>

      {/* Tabs */}
      <Tabs
        defaultValue="structure"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
      >
        <Tabs.List px="md">
          <Tabs.Tab value="structure">Structure</Tabs.Tab>
          <Tabs.Tab value="data">Data</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="structure" style={{ flex: 1, overflow: "hidden" }}>
          <StructureTab entity={entity} />
        </Tabs.Panel>

        <Tabs.Panel value="data" style={{ flex: 1, overflow: "hidden" }}>
          <DataTab />
        </Tabs.Panel>
      </Tabs>
    </Flex>
  );
};

const EmptyState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconTable size={48} opacity={0.3} />
      <Text size="sm">Select a table to view its structure</Text>
    </Stack>
  </Flex>
);

const NoEntitiesState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconDatabase size={48} opacity={0.3} />
      <Text>No entities found</Text>
      <Text size="sm" c="dimmed">
        Add entities using $entity primitive to see them here
      </Text>
    </Stack>
  </Flex>
);

export const DevDbStudio = () => {
  const http = useInject(HttpClient);
  const [entities, setEntities] = useState<DevEntityMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] =
    useState<DevEntityMetadata | null>(null);
  const [search, setSearch] = useState("");

  // Fetch entities
  useEffect(() => {
    http
      .fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => {
        setEntities(res.data.entities);
        setLoading(false);
      });
  }, []);

  // Filter entities by search
  const filteredEntities = useMemo(() => {
    if (!search) return entities;
    const searchLower = search.toLowerCase();
    return entities.filter((e) => e.name.toLowerCase().includes(searchLower));
  }, [entities, search]);

  if (loading) {
    return (
      <Flex align="center" justify="center" h="100%">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  if (entities.length === 0) {
    return <NoEntitiesState />;
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
        <EntitySidebar
          entities={filteredEntities}
          selectedEntity={selectedEntity}
          onSelectEntity={setSelectedEntity}
          search={search}
          onSearchChange={setSearch}
        />
      </Box>

      {/* Main content */}
      <Box style={{ flex: 1, overflow: "hidden" }}>
        {selectedEntity ? (
          <EntityPanel entity={selectedEntity} />
        ) : (
          <EmptyState />
        )}
      </Box>
    </Flex>
  );
};

export default DevDbStudio;
