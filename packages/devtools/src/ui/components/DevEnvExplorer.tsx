import { ui } from "@alepha/ui";
import {
  Badge,
  Box,
  Code,
  CopyButton,
  Flex,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconKey,
  IconSearch,
  IconSettings,
  IconVariable,
} from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useEffect, useMemo, useState } from "react";
import type { DevEnvMetadata } from "../../api/schemas/DevEnvMetadata.ts";
import { devMetadataSchema } from "../../api/schemas/DevMetadata.ts";

interface EnvVariable {
  name: string;
  value: any;
  type: string;
  description?: string;
  format?: string;
}

const parseEnvVariables = (envs: DevEnvMetadata[]): EnvVariable[] => {
  const variableMap = new Map<string, EnvVariable>();

  for (const env of envs) {
    const schema = env.schema;
    if (!schema?.properties) continue;

    for (const [name, propSchema] of Object.entries(schema.properties)) {
      // Skip if already added (deduplication)
      if (variableMap.has(name)) continue;

      const prop = propSchema as any;
      const value = env.values[name];

      // Get the actual type from schema
      let type = prop.type ?? "unknown";
      let format = prop.format;

      // Handle union types (optional)
      if (prop.anyOf) {
        const nonNull = prop.anyOf.find((t: any) => t.type !== "null");
        if (nonNull) {
          type = nonNull.type ?? "unknown";
          format = nonNull.format;
        }
      }

      variableMap.set(name, {
        name,
        value,
        type,
        description: prop.description,
        format,
      });
    }
  }

  return Array.from(variableMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
};

const EnvSidebar = ({
  variables,
  selectedVar,
  onSelectVar,
  search,
  onSearchChange,
}: {
  variables: EnvVariable[];
  selectedVar: EnvVariable | null;
  onSelectVar: (v: EnvVariable) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) => {
  return (
    <Stack gap={0} h="100%">
      <Box p="sm" style={{ borderBottom: `1px solid ${ui.colors.border}` }}>
        <TextInput
          placeholder="Search variables..."
          leftSection={<IconSearch size={14} />}
          size="xs"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </Box>
      <ScrollArea style={{ flex: 1 }}>
        <Box>
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
            Variables ({variables.length})
          </Text>
          {variables.map((v) => {
            const isSelected = selectedVar?.name === v.name;
            return (
              <Flex
                key={v.name}
                align="center"
                gap="xs"
                px="sm"
                py={6}
                onClick={() => onSelectVar(v)}
                style={{
                  cursor: "pointer",
                  backgroundColor: isSelected ? "#228be615" : undefined,
                  borderLeft: isSelected
                    ? "2px solid #228be6"
                    : "2px solid transparent",
                  borderBottom: `1px solid ${ui.colors.border}`,
                }}
              >
                <IconVariable size={14} opacity={0.5} />
                <Text size="sm" style={{ flex: 1 }} truncate ff="monospace">
                  {v.name}
                </Text>
              </Flex>
            );
          })}
        </Box>
      </ScrollArea>
    </Stack>
  );
};

const EnvPanel = ({ variable }: { variable: EnvVariable }) => {
  const hasValue = variable.value !== undefined && variable.value !== "";
  const displayValue = hasValue ? String(variable.value) : "(not set)";
  const isSensitive =
    variable.name.toLowerCase().includes("secret") ||
    variable.name.toLowerCase().includes("password") ||
    variable.name.toLowerCase().includes("key") ||
    variable.name.toLowerCase().includes("token");

  return (
    <Flex direction="column" h="100%">
      {/* Header */}
      <Box
        px="md"
        py="sm"
        style={{
          borderBottom: `1px solid ${ui.colors.border}`,
          backgroundColor: "#228be608",
        }}
      >
        <Flex align="center" gap="sm">
          <IconVariable size={18} opacity={0.7} />
          <Text size="md" fw={600} ff="monospace">
            {variable.name}
          </Text>
          <Badge size="xs" variant="outline" color="blue">
            {variable.format || variable.type}
          </Badge>
        </Flex>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="lg">
          {/* Description */}
          {variable.description && (
            <Box>
              <Text size="sm" fw={600} mb="xs">
                Description
              </Text>
              <Text size="sm" c="dimmed">
                {variable.description}
              </Text>
            </Box>
          )}

          {/* Current Value */}
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Current Value
            </Text>
            <Flex align="center" gap="sm">
              <Code
                block
                style={{
                  flex: 1,
                  filter: isSensitive && hasValue ? "blur(4px)" : undefined,
                  transition: "filter 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (isSensitive) e.currentTarget.style.filter = "none";
                }}
                onMouseLeave={(e) => {
                  if (isSensitive && hasValue)
                    e.currentTarget.style.filter = "blur(4px)";
                }}
              >
                {displayValue}
              </Code>
              {hasValue && (
                <CopyButton value={String(variable.value)}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied!" : "Copy value"}>
                      <Box
                        onClick={copy}
                        style={{ cursor: "pointer" }}
                        c={copied ? "teal" : "dimmed"}
                      >
                        {copied ? (
                          <IconCheck size={16} />
                        ) : (
                          <IconCopy size={16} />
                        )}
                      </Box>
                    </Tooltip>
                  )}
                </CopyButton>
              )}
            </Flex>
            {isSensitive && (
              <Text size="xs" c="dimmed" mt="xs">
                Hover to reveal sensitive value
              </Text>
            )}
          </Box>

          {/* Schema Info */}
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Schema
            </Text>
            <Table striped highlightOnHover withTableBorder>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td w={120}>
                    <Text size="sm" c="dimmed">
                      Type
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {variable.type}
                    </Text>
                  </Table.Td>
                </Table.Tr>
                {variable.format && (
                  <Table.Tr>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        Format
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {variable.format}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Box>

          {/* Usage hint */}
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Usage
            </Text>
            <Code block>
              {`# Set in .env file or environment
${variable.name}=${hasValue ? variable.value : "<value>"}`}
            </Code>
          </Box>
        </Stack>
      </ScrollArea>
    </Flex>
  );
};

const EmptyState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconVariable size={48} opacity={0.3} />
      <Text size="sm">Select a variable to view details</Text>
    </Stack>
  </Flex>
);

const NoEnvsState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconSettings size={48} opacity={0.3} />
      <Text>No environment variables found</Text>
      <Text size="sm" c="dimmed">
        Use $env primitive to define expected environment variables
      </Text>
    </Stack>
  </Flex>
);

const AllEnvsTable = ({ variables }: { variables: EnvVariable[] }) => {
  return (
    <ScrollArea h="100%" p="md">
      <Stack gap="lg">
        <Box>
          <Flex align="center" gap="xs" mb="sm">
            <IconKey size={18} opacity={0.7} />
            <Text size="md" fw={600}>
              All Environment Variables
            </Text>
            <Badge size="sm" variant="light">
              {variables.length} variables
            </Badge>
          </Flex>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Value</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {variables.map((v) => {
                const hasValue = v.value !== undefined && v.value !== "";
                const isSensitive =
                  v.name.toLowerCase().includes("secret") ||
                  v.name.toLowerCase().includes("password") ||
                  v.name.toLowerCase().includes("key") ||
                  v.name.toLowerCase().includes("token");
                return (
                  <Table.Tr key={v.name}>
                    <Table.Td>
                      <Text size="sm" ff="monospace" fw={500}>
                        {v.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="outline" color="blue">
                        {v.format || v.type}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {hasValue ? (
                        <Text
                          size="sm"
                          ff="monospace"
                          c="dimmed"
                          style={{
                            filter: isSensitive ? "blur(4px)" : undefined,
                          }}
                        >
                          {String(v.value).slice(0, 30)}
                          {String(v.value).length > 30 ? "..." : ""}
                        </Text>
                      ) : (
                        <Text size="sm" c="dimmed" fs="italic">
                          (not set)
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Box>
      </Stack>
    </ScrollArea>
  );
};

export const DevEnvExplorer = () => {
  const http = useInject(HttpClient);
  const [envs, setEnvs] = useState<DevEnvMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVar, setSelectedVar] = useState<EnvVariable | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    http
      .fetch("/devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => {
        setEnvs(res.data.envs);
        setLoading(false);
      });
  }, []);

  const variables = useMemo(() => parseEnvVariables(envs), [envs]);

  const filteredVariables = useMemo(() => {
    if (!search) return variables;
    const searchLower = search.toLowerCase();
    return variables.filter((v) => v.name.toLowerCase().includes(searchLower));
  }, [variables, search]);

  if (loading) {
    return (
      <Flex align="center" justify="center" h="100%">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  if (variables.length === 0) {
    return <NoEnvsState />;
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
        <EnvSidebar
          variables={filteredVariables}
          selectedVar={selectedVar}
          onSelectVar={setSelectedVar}
          search={search}
          onSearchChange={setSearch}
        />
      </Box>

      {/* Main content */}
      <Box style={{ flex: 1, overflow: "hidden" }}>
        {selectedVar ? (
          <EnvPanel variable={selectedVar} />
        ) : (
          <AllEnvsTable variables={variables} />
        )}
      </Box>
    </Flex>
  );
};

export default DevEnvExplorer;
